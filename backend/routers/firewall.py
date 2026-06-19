# p3portal.org
"""PROJ-90: Proxmox-Firewall-Verwaltung (Datacenter / Node / Gast).

Imperatives CRUD auf der Proxmox-Firewall über die direkte API
(`/cluster/firewall/*`, `/nodes/{node}/firewall/*`,
`/nodes/{node}/qemu|lxc/{vmid}/firewall/*`). Zustand lebt vollständig in Proxmox
(**keine DB-Tabelle**); Regeln greifen **live** (kein Pending/Apply wie PROJ-79/80).

Drei Auth-Eintrittspunkte (jeder Endpoint prüft zuerst):
  Datacenter : `_assert_dc_firewall_access`   – Admin ODER manage_firewall (kein Node-Scope)
  Node       : `_assert_node_firewall_access` – + node:manage_firewall (PROJ-47)
  VM/LXC     : `_resolve_vm_access` + `_check_rbac(..., "configure")` (PROJ-12/48)

Read-Auth (Lehre BUG-79-4 — Firewall-GET braucht Sys.Audit/VM.Audit, Viewer reicht
nicht): admin→operator→viewer-Kette der Ziel-Installation/-Node. Write-Auth: Admin-
Token (Sys.Modify) für DC/Node; per-VM-Token (VM.Config.Network) für Gäste.

Schreib-Fehler-Mapper `_firewall_write_http_exc`: 403→403 (Privileg-Fehler durch-
reichen), 401→502 (Anti-Logout S115), sonst Code — wie PROJ-78/79/80.

Multi-Installation (Muster SDN PROJ-80): Datacenter-FW ist je Installation getrennt
(`?installation=<portal_node_id>`); ohne Param die Default-Node.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from backend.features.api_surface.deps import require_scope_for_upk  # PROJ-97

from backend.core.deps import CurrentUser, get_current_user
from backend.models.firewall import (
    AliasListResponse,
    AliasWriteRequest,
    DcFirewallOptionsResponse,
    DcFirewallOptionsUpdate,
    FirewallAlias,
    FirewallMacro,
    FirewallRef,
    FirewallRule,
    FirewallRuleMoveRequest,
    FirewallRulesResponse,
    FirewallRuleWriteRequest,
    FirewallUsageEntry,
    FirewallUsageResponse,
    GuestFirewallOptionsResponse,
    GuestFirewallOptionsUpdate,
    IpSet,
    IpSetEntriesResponse,
    IpSetEntry,
    IpSetEntryRequest,
    IpSetCreateRequest,
    IpSetListResponse,
    NodeFirewallOptionsResponse,
    NodeFirewallOptionsUpdate,
    SecurityGroup,
    SecurityGroupCreateRequest,
    SecurityGroupListResponse,
)
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/firewall", tags=["firewall"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). GET → :read, Mutationen → :write.
_SCOPE_READ = Depends(require_scope_for_upk("firewall:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("firewall:write"))

_USAGE_KINDS = {"group", "ipset", "alias"}


def _assert_safe_ipset_cidr(cidr: str) -> None:
    """Reject a malicious IPSet-entry path segment (BUG-90-1, path traversal).

    The ``{cidr:path}`` converter accepts ``/`` so an entry id may legitimately
    look like ``10.0.0.0/24`` — but it would also let an authenticated firewall
    manager smuggle ``../`` segments. ``_firewall_request`` f-string-interpolates
    the value straight into the Proxmox URL, and httpx **collapses** dot-segments,
    so e.g. ``../../../../access/users/victim@pam`` would turn the DELETE into
    ``/api2/json/access/users/victim@pam`` — an arbitrary privileged Proxmox call
    with the admin (Sys.Modify) token, escaping the firewall scope. A real entry is
    an IP or CIDR; validate it strictly before it ever reaches the URL (422)."""
    try:
        ipaddress.ip_network(cidr, strict=False)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid IPSet entry {cidr!r} (expected an IP or CIDR)",
        )


# ── Error mapper ──────────────────────────────────────────────────────────────

def _firewall_write_http_exc(exc: httpx.HTTPStatusError) -> HTTPException:
    """Map Proxmox firewall write-path errors (AC-AUTH-3).

    403 → 403 (missing Sys.Modify / VM.Config.Network – the admin must know)
    401 → 502 (token invalid/deleted – stay logged in, Anti-Logout S115)
    else → pass status code through (the global _cluster_http_exc would mask a
    write-403 by turning a token-403 into 502).
    """
    code = exc.response.status_code
    if code == 403:
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient Proxmox privileges for firewall management "
                   "(Sys.Modify on /cluster|/nodes, or VM.Config.Network on the guest)",
        )
    if code == 401:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox auth error – service account token may be invalid or deleted",
        )
    return HTTPException(status_code=code, detail="Proxmox API error")


# ── RBAC gates ────────────────────────────────────────────────────────────────

def _assert_dc_firewall_access(current_user: CurrentUser) -> None:
    """Allow Admin OR manage_firewall (AC-RBAC-1). No node scope (datacenter is cluster-wide)."""
    if current_user.role == "admin":
        return
    if "manage_firewall" in current_user.portal_permissions:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="firewall_management_not_authorized",
    )


async def _assert_node_firewall_access(current_user: CurrentUser, node: str) -> None:
    """Allow Admin OR manage_firewall OR node:manage_firewall on the target node (AC-RBAC-1).

    Checked first in every node endpoint — require_admin_or cannot see the path
    {node} to evaluate the node scope (Muster PROJ-79 _assert_network_access).
    """
    if current_user.role == "admin":
        return
    if "manage_firewall" in current_user.portal_permissions:
        return
    if current_user.user_id is not None:
        try:
            from backend.services.nodes_service import get_node_for_proxmox_name
            from backend.services.permissions_resolver import resolve_node_action
            portal_node = await get_node_for_proxmox_name(node)
            if portal_node is not None and await resolve_node_action(
                current_user.user_id, portal_node.id, "node:manage_firewall"
            ):
                return
        except Exception as exc:
            logger.warning("firewall RBAC node-scope check failed for node '%s': %r", node, exc)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="firewall_management_not_authorized",
    )


# ── Auth resolvers (DC/Node share the per-node-row helpers) ───────────────────
#
# Datacenter firewall is per Proxmox installation: ``?installation=<portal_node_id>``
# selects which installation, else the default node (Muster SDN PROJ-80 S598).

async def _resolve_install_node(installation: int | None):
    from backend.services.nodes_service import get_default_node, get_node
    node_row = await get_node(installation) if installation is not None else await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured" if installation is None
            else f"Portal node {installation} not found",
        )
    return node_row


def _proxmox_cookie_auth(current_user: CurrentUser):
    """Cluster-wide session cookie for proxmox-login users (deprecated path)."""
    from backend.services.proxmox import ProxmoxAuth, proxmox_client
    session = proxmox_client.get_session(current_user.username)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox session – login via Proxmox tab",
        )
    return proxmox_client, ProxmoxAuth(
        kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""),
    )


async def _read_auth_for_node_row(current_user: CurrentUser, node_row):
    """Strongest available read token (admin→operator→viewer) of an installation/node.

    Firewall GETs need more privilege than a plain viewer token usually carries
    (Sys.Audit / VM.Audit) — a viewer-only resolver would leave the view empty
    (the BUG-79-4 trap). The firewall view is authorized-only anyway."""
    if current_user.auth_type == "proxmox":
        return _proxmox_cookie_auth(current_user)
    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
    from backend.services.service_accounts import _extract_token
    token = (
        _extract_token(node_row, "admin")
        or _extract_token(node_row, "operator")
        or _extract_token(node_row, "viewer")
    )
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No service-account token configured for this node",
        )
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


async def _write_auth_for_node_row(current_user: CurrentUser, node_row):
    """Admin write token (Sys.Modify) of an installation/node. 503 if missing."""
    if current_user.auth_type == "proxmox":
        return _proxmox_cookie_auth(current_user)
    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
    from backend.services.service_accounts import _extract_token
    token = _extract_token(node_row, "admin")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin service account (Sys.Modify) not configured for this node",
        )
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


async def _dc_read_auth(current_user: CurrentUser, installation: int | None):
    return await _read_auth_for_node_row(current_user, await _resolve_install_node(installation))


async def _dc_write_auth(current_user: CurrentUser, installation: int | None):
    return await _write_auth_for_node_row(current_user, await _resolve_install_node(installation))


async def _node_read_auth(current_user: CurrentUser, node: str):
    from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name
    node_row = await get_node_for_proxmox_name(node) or await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured",
        )
    return await _read_auth_for_node_row(current_user, node_row)


async def _node_write_auth(current_user: CurrentUser, node: str):
    from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name
    node_row = await get_node_for_proxmox_name(node) or await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured",
        )
    return await _write_auth_for_node_row(current_user, node_row)


# ── Typesafe parsing (PVE version drift, Lehre PROJ-78/79) ────────────────────

def _s(value) -> str | None:
    if value is None or value == "":
        return None
    return str(value)


def _i(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _b(value, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    try:
        return bool(int(value))
    except (TypeError, ValueError):
        return bool(value)


def _bn(value) -> bool | None:
    """Like _b but returns None when the key is absent (for tri-state options)."""
    if value is None or value == "":
        return None
    return _b(value)


def _parse_rule(raw: dict) -> FirewallRule:
    if not isinstance(raw, dict):
        raw = {}
    return FirewallRule(
        pos=_i(raw.get("pos")) or 0,
        type=_s(raw.get("type")) or "in",
        action=_s(raw.get("action")) or "",
        enable=_b(raw.get("enable"), default=True),
        macro=_s(raw.get("macro")),
        source=_s(raw.get("source")),
        dest=_s(raw.get("dest")),
        proto=_s(raw.get("proto")),
        sport=_s(raw.get("sport")),
        dport=_s(raw.get("dport")),
        iface=_s(raw.get("iface")),
        log=_s(raw.get("log")),
        comment=_s(raw.get("comment")),
        icmp_type=_s(raw.get("icmp-type") or raw.get("icmp_type")),
        ipversion=_i(raw.get("ipversion")),
    )


def _rule_summary(raw: dict) -> str:
    """Short human-readable rule repr for usage listings (no secrets)."""
    parts = [str(raw.get("type", "?")), str(raw.get("action", "?"))]
    if raw.get("source"):
        parts.append(f"src={raw.get('source')}")
    if raw.get("dest"):
        parts.append(f"dst={raw.get('dest')}")
    if raw.get("macro"):
        parts.append(f"macro={raw.get('macro')}")
    return " ".join(parts)


async def _best_effort_global_enabled(client, auth) -> bool | None:
    """Read the datacenter firewall enable flag (EC-1 banner). Best-effort → None on error."""
    try:
        opts = await client.get_dc_firewall_options(auth)
        return _bn(opts.get("enable"))
    except Exception:
        return None


async def _assert_sg_exists_for_group_rule(client, auth, body: FirewallRuleWriteRequest) -> None:
    """For a type=group rule, verify the referenced security group exists (EC-16/AC-RULE-2).

    Best-effort: if the groups read fails we fall through and let Proxmox validate."""
    if body.type != "group":
        return
    try:
        groups = await client.get_firewall_groups(auth)
    except Exception as exc:
        logger.warning("firewall: SG existence pre-check failed: %r", exc)
        return
    names = {_s(g.get("group")) for g in groups if isinstance(g, dict)}
    if body.action not in names:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Security group '{body.action}' does not exist",
        )


# ════════════════════════════════════════════════════════════════════════════
# Datacenter firewall  (/api/firewall/datacenter/...)
# ════════════════════════════════════════════════════════════════════════════

@router.get("/datacenter/options", response_model=DcFirewallOptionsResponse, dependencies=[_SCOPE_READ])
async def get_dc_options(
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> DcFirewallOptionsResponse:
    """Datacenter firewall options. ``enable`` is read-only (AC-OPT-3). Never 500."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        opts = await client.get_dc_firewall_options(auth)
    except HTTPException as exc:
        return DcFirewallOptionsResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return DcFirewallOptionsResponse(permission_denied=True)
        return DcFirewallOptionsResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall dc options: read failed: %r", exc)
        return DcFirewallOptionsResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    return DcFirewallOptionsResponse(
        enable=_bn(opts.get("enable")),
        policy_in=_s(opts.get("policy_in")),
        policy_out=_s(opts.get("policy_out")),
        log_ratelimit=_s(opts.get("log_ratelimit")),
        ebtables=_bn(opts.get("ebtables")),
    )


@router.put("/datacenter/options", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_dc_options(
    body: DcFirewallOptionsUpdate,
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit datacenter options (policy/log_ratelimit/ebtables). ``enable`` rejected (422, extra=forbid)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    params = body.to_proxmox_params()
    try:
        await client.update_dc_firewall_options(auth, params)
        await write_audit_log(
            event_type="firewall_options_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail="level=datacenter",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/datacenter/rules", response_model=FirewallRulesResponse, dependencies=[_SCOPE_READ])
async def list_dc_rules(
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> FirewallRulesResponse:
    """List datacenter rules in evaluation order (AC-LIST-1). Never 500 (flags)."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_dc_firewall_rules(auth)
    except HTTPException as exc:
        return FirewallRulesResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return FirewallRulesResponse(permission_denied=True)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall dc rules: read failed: %r", exc)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    return FirewallRulesResponse(rules=[_parse_rule(r) for r in raw])


@router.post("/datacenter/rules", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_dc_rule(
    body: FirewallRuleWriteRequest,
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a datacenter rule (optional ``pos`` to insert; AC-RULE-3). Live-apply."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    await _assert_sg_exists_for_group_rule(client, auth, body)
    try:
        await client.create_dc_firewall_rule(auth, body.to_proxmox_params(with_pos=True))
        await write_audit_log(
            event_type="firewall_rule_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter type={body.type} action={body.action}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created"}


@router.put("/datacenter/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_dc_rule(
    pos: int = Path(..., ge=0),
    body: FirewallRuleWriteRequest = ...,  # noqa: B008
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Fully edit a datacenter rule at *pos* (AC-RULE-4)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    await _assert_sg_exists_for_group_rule(client, auth, body)
    try:
        await client.update_dc_firewall_rule(auth, pos, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_rule_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/datacenter/rules/{pos}/move", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def move_dc_rule(
    pos: int = Path(..., ge=0),
    body: FirewallRuleMoveRequest = ...,  # noqa: B008
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Move a rule to a new position via Proxmox-native ``moveto`` (AC-ORDER-1)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.update_dc_firewall_rule(auth, pos, {"moveto": body.moveto})
        await write_audit_log(
            event_type="firewall_rule_moved",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter pos={pos} moveto={body.moveto}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/datacenter/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_dc_rule(
    pos: int = Path(..., ge=0),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a datacenter rule (AC-DEL-1)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.delete_dc_firewall_rule(auth, pos)
        await write_audit_log(
            event_type="firewall_rule_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Security Groups ───────────────────────────────────────────────────────────

@router.get("/datacenter/groups", response_model=SecurityGroupListResponse, dependencies=[_SCOPE_READ])
async def list_security_groups(
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SecurityGroupListResponse:
    """List security groups (AC-LIST-3). Never 500."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_firewall_groups(auth)
    except HTTPException as exc:
        return SecurityGroupListResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return SecurityGroupListResponse(permission_denied=True)
        return SecurityGroupListResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall groups: read failed: %r", exc)
        return SecurityGroupListResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    items = [
        SecurityGroup(group=_s(g.get("group")) or "", comment=_s(g.get("comment")), digest=_s(g.get("digest")))
        for g in raw if _s(g.get("group"))
    ]
    return SecurityGroupListResponse(items=items)


@router.post("/datacenter/groups", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_security_group(
    body: SecurityGroupCreateRequest,
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a security group (AC-SG-1). 409 on name collision (deterministic pre-check)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        existing = await client.get_firewall_groups(auth)
        if any(_s(g.get("group")) == body.group for g in existing):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Security group '{body.group}' already exists")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("firewall group create: collision pre-check failed: %r", exc)
    try:
        await client.create_firewall_group(auth, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_security_group_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"group={body.group}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created", "group": body.group}


@router.delete("/datacenter/groups/{group}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_security_group(
    group: str = Path(...),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a security group (AC-SG-4). Usage warning is the FE's job (GET /usage/group/{name})."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.delete_firewall_group(auth, group)
        await write_audit_log(
            event_type="firewall_security_group_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"group={group}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/datacenter/groups/{group}/rules", response_model=FirewallRulesResponse, dependencies=[_SCOPE_READ])
async def list_group_rules(
    group: str = Path(...),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> FirewallRulesResponse:
    """List the rules inside a security group (AC-SG-2). Never 500."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_firewall_group_rules(auth, group)
    except HTTPException as exc:
        return FirewallRulesResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return FirewallRulesResponse(permission_denied=True)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall group rules: read failed: %r", exc)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    return FirewallRulesResponse(rules=[_parse_rule(r) for r in raw])


@router.post("/datacenter/groups/{group}/rules", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_group_rule(
    group: str = Path(...),
    body: FirewallRuleWriteRequest = ...,  # noqa: B008
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Add a rule to a security group (AC-SG-2)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.create_firewall_group_rule(auth, group, body.to_proxmox_params(with_pos=True))
        await write_audit_log(
            event_type="firewall_rule_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter group={group} type={body.type}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created"}


@router.put("/datacenter/groups/{group}/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_group_rule(
    group: str = Path(...),
    pos: int = Path(..., ge=0),
    body: FirewallRuleWriteRequest = ...,  # noqa: B008
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit a rule inside a security group (AC-SG-2)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.update_firewall_group_rule(auth, group, pos, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_rule_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter group={group} pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/datacenter/groups/{group}/rules/{pos}/move", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def move_group_rule(
    group: str = Path(...),
    pos: int = Path(..., ge=0),
    body: FirewallRuleMoveRequest = ...,  # noqa: B008
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Reorder a rule inside a security group (AC-ORDER-1)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.update_firewall_group_rule(auth, group, pos, {"moveto": body.moveto})
        await write_audit_log(
            event_type="firewall_rule_moved",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter group={group} pos={pos} moveto={body.moveto}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/datacenter/groups/{group}/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_group_rule(
    group: str = Path(...),
    pos: int = Path(..., ge=0),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a rule inside a security group (AC-SG-2)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.delete_firewall_group_rule(auth, group, pos)
        await write_audit_log(
            event_type="firewall_rule_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=datacenter group={group} pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── IPSets (datacenter-global) ────────────────────────────────────────────────

@router.get("/datacenter/ipsets", response_model=IpSetListResponse, dependencies=[_SCOPE_READ])
async def list_ipsets(
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> IpSetListResponse:
    """List datacenter IPSets (AC-LIST-3). Never 500."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_firewall_ipsets(auth)
    except HTTPException as exc:
        return IpSetListResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return IpSetListResponse(permission_denied=True)
        return IpSetListResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall ipsets: read failed: %r", exc)
        return IpSetListResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    items = [IpSet(name=_s(i.get("name")) or "", comment=_s(i.get("comment"))) for i in raw if _s(i.get("name"))]
    return IpSetListResponse(items=items)


@router.post("/datacenter/ipsets", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_ipset(
    body: IpSetCreateRequest,
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a datacenter IPSet (AC-IPSET-1). 409 on name collision."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        existing = await client.get_firewall_ipsets(auth)
        if any(_s(i.get("name")) == body.name for i in existing):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"IPSet '{body.name}' already exists")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("firewall ipset create: collision pre-check failed: %r", exc)
    try:
        await client.create_firewall_ipset(auth, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_ipset_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"ipset={body.name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created", "name": body.name}


@router.delete("/datacenter/ipsets/{name}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_ipset(
    name: str = Path(...),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a datacenter IPSet (AC-IPSET-3). Usage warning via GET /usage/ipset/{name}."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.delete_firewall_ipset(auth, name)
        await write_audit_log(
            event_type="firewall_ipset_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"ipset={name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/datacenter/ipsets/{name}/entries", response_model=IpSetEntriesResponse, dependencies=[_SCOPE_READ])
async def list_ipset_entries(
    name: str = Path(...),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> IpSetEntriesResponse:
    """List entries of a datacenter IPSet. Never 500."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_firewall_ipset_entries(auth, name)
    except HTTPException as exc:
        return IpSetEntriesResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return IpSetEntriesResponse(permission_denied=True)
        return IpSetEntriesResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall ipset entries: read failed: %r", exc)
        return IpSetEntriesResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    entries = [
        IpSetEntry(cidr=_s(e.get("cidr")) or "", nomatch=_b(e.get("nomatch")), comment=_s(e.get("comment")))
        for e in raw if _s(e.get("cidr"))
    ]
    return IpSetEntriesResponse(entries=entries)


@router.post("/datacenter/ipsets/{name}/entries", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def add_ipset_entry(
    body: IpSetEntryRequest,
    name: str = Path(...),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Add an IP/CIDR entry to a datacenter IPSet (AC-IPSET-1)."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.add_firewall_ipset_entry(auth, name, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_ipset_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"ipset={name} +{body.cidr}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created"}


@router.delete("/datacenter/ipsets/{name}/entries/{cidr:path}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_ipset_entry(
    name: str = Path(...),
    cidr: str = Path(..., description="IP/CIDR entry (may contain '/')"),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Remove an entry from a datacenter IPSet."""
    _assert_dc_firewall_access(current_user)
    _assert_safe_ipset_cidr(cidr)  # BUG-90-1: block path traversal via {cidr:path}
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.delete_firewall_ipset_entry(auth, name, cidr)
        await write_audit_log(
            event_type="firewall_ipset_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"ipset={name} -{cidr}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Aliases (datacenter-global) ───────────────────────────────────────────────

@router.get("/datacenter/aliases", response_model=AliasListResponse, dependencies=[_SCOPE_READ])
async def list_aliases(
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> AliasListResponse:
    """List datacenter aliases (AC-LIST-3). Never 500."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_firewall_aliases(auth)
    except HTTPException as exc:
        return AliasListResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return AliasListResponse(permission_denied=True)
        return AliasListResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall aliases: read failed: %r", exc)
        return AliasListResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    items = [
        FirewallAlias(
            name=_s(a.get("name")) or "", cidr=_s(a.get("cidr")),
            comment=_s(a.get("comment")), ipversion=_i(a.get("ipversion")),
        )
        for a in raw if _s(a.get("name"))
    ]
    return AliasListResponse(items=items)


@router.post("/datacenter/aliases", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_alias(
    body: AliasWriteRequest,
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a datacenter alias (AC-ALIAS-1). 409 on name collision."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        existing = await client.get_firewall_aliases(auth)
        if any(_s(a.get("name")) == body.name for a in existing):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Alias '{body.name}' already exists")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("firewall alias create: collision pre-check failed: %r", exc)
    try:
        await client.create_firewall_alias(auth, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_alias_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"alias={body.name} cidr={body.cidr}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created", "name": body.name}


@router.put("/datacenter/aliases/{name}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_alias(
    name: str = Path(...),
    body: AliasWriteRequest = ...,  # noqa: B008
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit a datacenter alias's IP/CIDR/comment."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.update_firewall_alias(auth, name, body.to_proxmox_params(for_update=True))
        await write_audit_log(
            event_type="firewall_alias_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"alias={name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/datacenter/aliases/{name}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_alias(
    name: str = Path(...),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a datacenter alias (AC-ALIAS-3). Usage warning via GET /usage/alias/{name}."""
    _assert_dc_firewall_access(current_user)
    client, auth = await _dc_write_auth(current_user, installation)
    try:
        await client.delete_firewall_alias(auth, name)
        await write_audit_log(
            event_type="firewall_alias_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"alias={name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Macros / Refs (read-only, rule-editor dropdowns, OP7) ─────────────────────

@router.get("/datacenter/macros", response_model=list[FirewallMacro], dependencies=[_SCOPE_READ])
async def list_macros(
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[FirewallMacro]:
    """Built-in Proxmox macros for the rule editor (read-only, AC-RULE-1). Best-effort."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_firewall_macros(auth)
    except Exception as exc:
        logger.warning("firewall macros: read failed: %r", exc)
        return []
    return [FirewallMacro(macro=_s(m.get("macro")) or "", descr=_s(m.get("descr"))) for m in raw if _s(m.get("macro"))]


@router.get("/datacenter/refs", response_model=list[FirewallRef], dependencies=[_SCOPE_READ])
async def list_refs(
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[FirewallRef]:
    """Aliases + IPSets references for the rule editor's src/dest suggestions. Best-effort."""
    _assert_dc_firewall_access(current_user)
    try:
        client, auth = await _dc_read_auth(current_user, installation)
        raw = await client.get_firewall_refs(auth)
    except Exception as exc:
        logger.warning("firewall refs: read failed: %r", exc)
        return []
    return [
        FirewallRef(
            type=_s(r.get("type")) or "", name=_s(r.get("name")) or "",
            ref=_s(r.get("ref")), comment=_s(r.get("comment")),
        )
        for r in raw if _s(r.get("name"))
    ]


# ── Usage (SG / IPSet / Alias deletion check, cluster-wide fan-out, OP5) ──────

@router.get("/datacenter/usage/{kind}/{name}", response_model=FirewallUsageResponse, dependencies=[_SCOPE_READ])
async def check_firewall_object_usage(
    kind: str = Path(...),
    name: str = Path(...),
    installation: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> FirewallUsageResponse:
    """Which rules reference this security-group / ipset / alias (AC-SG-4/IPSET-3/ALIAS-3)?

    Cluster-wide fan-out over datacenter rules + security-group rules + all node
    rules + all guest rules. Best-effort, ``incomplete`` if any config is unread."""
    _assert_dc_firewall_access(current_user)
    if kind not in _USAGE_KINDS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid usage kind '{kind}'")
    try:
        client, auth = await _dc_read_auth(current_user, installation)
    except Exception as exc:
        logger.warning("firewall usage: auth failed for %s '%s': %r", kind, name, exc)
        return FirewallUsageResponse(kind=kind, name=name, incomplete=True)
    usages, incomplete = await _find_firewall_object_usage(client, auth, kind, name)
    return FirewallUsageResponse(kind=kind, name=name, in_use=bool(usages), usages=usages, incomplete=incomplete)


# ════════════════════════════════════════════════════════════════════════════
# Node firewall  (/api/firewall/nodes/{node}/...)
# ════════════════════════════════════════════════════════════════════════════

@router.get("/nodes/{node}/options", response_model=NodeFirewallOptionsResponse, dependencies=[_SCOPE_READ])
async def get_node_options(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> NodeFirewallOptionsResponse:
    """Node firewall options + global-enable banner flag (AC-LIST-2/HINT-1). Never 500."""
    await _assert_node_firewall_access(current_user, node)
    try:
        client, auth = await _node_read_auth(current_user, node)
        opts = await client.get_node_firewall_options(auth, node)
    except HTTPException as exc:
        return NodeFirewallOptionsResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return NodeFirewallOptionsResponse(permission_denied=True)
        return NodeFirewallOptionsResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall node options: read failed for '%s': %r", node, exc)
        return NodeFirewallOptionsResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    return NodeFirewallOptionsResponse(
        enable=_bn(opts.get("enable")),
        log_level_in=_s(opts.get("log_level_in")),
        log_level_out=_s(opts.get("log_level_out")),
        smurf_log_level=_s(opts.get("smurf_log_level")),
        tcp_flags_log_level=_s(opts.get("tcp_flags_log_level")),
        nf_conntrack_max=_i(opts.get("nf_conntrack_max")),
        nf_conntrack_tcp_timeout_established=_i(opts.get("nf_conntrack_tcp_timeout_established")),
        ndp=_bn(opts.get("ndp")),
        nosmurfs=_bn(opts.get("nosmurfs")),
        global_firewall_enabled=await _best_effort_global_enabled(client, auth),
    )


@router.put("/nodes/{node}/options", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_node_options(
    node: str = Path(...),
    body: NodeFirewallOptionsUpdate = ...,  # noqa: B008
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit node firewall options (enable/log levels/conntrack/ndp/nosmurfs, AC-OPT-1)."""
    await _assert_node_firewall_access(current_user, node)
    client, auth = await _node_write_auth(current_user, node)
    try:
        await client.update_node_firewall_options(auth, node, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_options_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=node node={node}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/nodes/{node}/rules", response_model=FirewallRulesResponse, dependencies=[_SCOPE_READ])
async def list_node_rules(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> FirewallRulesResponse:
    """List node firewall rules in evaluation order (AC-LIST-1). Never 500."""
    await _assert_node_firewall_access(current_user, node)
    try:
        client, auth = await _node_read_auth(current_user, node)
        raw = await client.get_node_firewall_rules(auth, node)
    except HTTPException as exc:
        return FirewallRulesResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return FirewallRulesResponse(permission_denied=True)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall node rules: read failed for '%s': %r", node, exc)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    return FirewallRulesResponse(rules=[_parse_rule(r) for r in raw])


@router.post("/nodes/{node}/rules", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_node_rule(
    node: str = Path(...),
    body: FirewallRuleWriteRequest = ...,  # noqa: B008
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a node firewall rule (AC-RULE-3)."""
    await _assert_node_firewall_access(current_user, node)
    client, auth = await _node_write_auth(current_user, node)
    await _assert_sg_exists_for_group_rule(client, auth, body)
    try:
        await client.create_node_firewall_rule(auth, node, body.to_proxmox_params(with_pos=True))
        await write_audit_log(
            event_type="firewall_rule_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=node node={node} type={body.type} action={body.action}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created"}


@router.put("/nodes/{node}/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_node_rule(
    node: str = Path(...),
    pos: int = Path(..., ge=0),
    body: FirewallRuleWriteRequest = ...,  # noqa: B008
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit a node firewall rule (AC-RULE-4)."""
    await _assert_node_firewall_access(current_user, node)
    client, auth = await _node_write_auth(current_user, node)
    await _assert_sg_exists_for_group_rule(client, auth, body)
    try:
        await client.update_node_firewall_rule(auth, node, pos, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_rule_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=node node={node} pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/nodes/{node}/rules/{pos}/move", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def move_node_rule(
    node: str = Path(...),
    pos: int = Path(..., ge=0),
    body: FirewallRuleMoveRequest = ...,  # noqa: B008
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Reorder a node firewall rule (AC-ORDER-1)."""
    await _assert_node_firewall_access(current_user, node)
    client, auth = await _node_write_auth(current_user, node)
    try:
        await client.update_node_firewall_rule(auth, node, pos, {"moveto": body.moveto})
        await write_audit_log(
            event_type="firewall_rule_moved",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=node node={node} pos={pos} moveto={body.moveto}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/nodes/{node}/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_node_rule(
    node: str = Path(...),
    pos: int = Path(..., ge=0),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a node firewall rule (AC-DEL-1)."""
    await _assert_node_firewall_access(current_user, node)
    client, auth = await _node_write_auth(current_user, node)
    try:
        await client.delete_node_firewall_rule(auth, node, pos)
        await write_audit_log(
            event_type="firewall_rule_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=node node={node} pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ════════════════════════════════════════════════════════════════════════════
# VM/LXC firewall  (/api/firewall/vms/{vmid}/...)
# ════════════════════════════════════════════════════════════════════════════
#
# VM-level access reuses vms.py: _resolve_vm_access locates the guest (returns the
# per-node client + per-VM auth + proxmox_node + vm_type) and _check_rbac enforces
# PROJ-12/48 ownership ("configure"). Stack-managed VMs are intentionally NOT
# blocked (Entscheidung #6) — the FE shows a banner instead (AC-STACK-1).

async def _resolve_guest_fw(current_user: CurrentUser, vmid: int, node: str | None):
    """Return (client, auth, pve_node, kind) for guest firewall ops, RBAC-checked."""
    from backend.routers.vms import _check_rbac, _resolve_vm_access
    client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
    await _check_rbac(current_user, vmid, vm_type, "configure")
    kind = "lxc" if vm_type == "lxc" else "qemu"
    return client, auth, pve_node, kind


async def _assert_guest_firewall_not_stack_managed(
    pve_node: str, vmid: int, username: str, auth_type: str
) -> None:
    """PROJ-91 (AC-MUT-1): block manual firewall mutations on a stack-managed guest.

    A guest whose stack resource carries an active ``firewall:`` block has its
    firewall owned by the stack definition → its PROJ-90 firewall mutations
    (rules/options/ipsets/aliases) return HTTP 409 "edit via the stack definition".
    A stack guest WITHOUT a firewall block keeps its editable firewall (AC-MUT-2);
    GET endpoints are never gated (AC-MUT-3). Core-mode is a no-op (Plus-Hook →
    None). Reuses the get_stack_for_vm / _assert_not_stack_managed pattern, but the
    grenze is finer (per-firewall, not the whole VM).
    """
    from backend.core.plus_protocol import plus_behavior
    from backend.services.nodes_service import get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(pve_node)
    if node_row is None:
        return
    try:
        managed = await plus_behavior.get_stack_firewall_for_vm(node_row.id, vmid)
    except Exception:
        managed = None
    if managed:
        await write_audit_log(
            event_type="stack_guest_firewall_mutation_blocked",
            username=username,
            auth_type=auth_type,
            detail=f"vmid={vmid} node={pve_node} stack_id={managed['stack_id']}",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "guest_firewall_managed_by_stack",
                "stack_id": managed["stack_id"],
                "stack_name": managed["stack_name"],
            },
        )


@router.get("/vms/{vmid}/options", response_model=GuestFirewallOptionsResponse, dependencies=[_SCOPE_READ])
async def get_guest_options(
    vmid: int,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> GuestFirewallOptionsResponse:
    """Guest firewall options + global-enable banner flag (AC-OPT-2/HINT-1)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    try:
        opts = await client.get_guest_firewall_options(auth, pve_node, vmid, kind)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return GuestFirewallOptionsResponse(permission_denied=True)
        return GuestFirewallOptionsResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except httpx.RequestError as exc:
        return GuestFirewallOptionsResponse(node_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("firewall guest options: read failed for %s/%s: %r", pve_node, vmid, exc)
        return GuestFirewallOptionsResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    return GuestFirewallOptionsResponse(
        enable=_bn(opts.get("enable")),
        dhcp=_bn(opts.get("dhcp")),
        macfilter=_bn(opts.get("macfilter")),
        ndp=_bn(opts.get("ndp")),
        radv=_bn(opts.get("radv")),
        ipfilter=_bn(opts.get("ipfilter")),
        policy_in=_s(opts.get("policy_in")),
        policy_out=_s(opts.get("policy_out")),
        log_level_in=_s(opts.get("log_level_in")),
        log_level_out=_s(opts.get("log_level_out")),
        global_firewall_enabled=await _best_effort_global_enabled(client, auth),
    )


@router.put("/vms/{vmid}/options", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_guest_options(
    vmid: int,
    body: GuestFirewallOptionsUpdate,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit guest firewall options (AC-OPT-2)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.update_guest_firewall_options(auth, pve_node, vmid, kind, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_options_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} node={pve_node}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/vms/{vmid}/rules", response_model=FirewallRulesResponse, dependencies=[_SCOPE_READ])
async def list_guest_rules(
    vmid: int,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> FirewallRulesResponse:
    """List guest firewall rules in evaluation order (AC-LIST-1). Never 500."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    try:
        raw = await client.get_guest_firewall_rules(auth, pve_node, vmid, kind)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return FirewallRulesResponse(permission_denied=True)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall guest rules: read failed for %s/%s: %r", pve_node, vmid, exc)
        return FirewallRulesResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    return FirewallRulesResponse(rules=[_parse_rule(r) for r in raw])


@router.post("/vms/{vmid}/rules", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_guest_rule(
    vmid: int,
    body: FirewallRuleWriteRequest,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a guest firewall rule (AC-RULE-3)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    await _assert_sg_exists_for_group_rule(client, auth, body)
    try:
        await client.create_guest_firewall_rule(auth, pve_node, vmid, kind, body.to_proxmox_params(with_pos=True))
        await write_audit_log(
            event_type="firewall_rule_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} node={pve_node} type={body.type}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created"}


@router.put("/vms/{vmid}/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_guest_rule(
    vmid: int,
    pos: int = Path(..., ge=0),
    body: FirewallRuleWriteRequest = ...,  # noqa: B008
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit a guest firewall rule (AC-RULE-4)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    await _assert_sg_exists_for_group_rule(client, auth, body)
    try:
        await client.update_guest_firewall_rule(auth, pve_node, vmid, kind, pos, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_rule_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} node={pve_node} pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/rules/{pos}/move", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def move_guest_rule(
    vmid: int,
    pos: int = Path(..., ge=0),
    body: FirewallRuleMoveRequest = ...,  # noqa: B008
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Reorder a guest firewall rule (AC-ORDER-1)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.update_guest_firewall_rule(auth, pve_node, vmid, kind, pos, {"moveto": body.moveto})
        await write_audit_log(
            event_type="firewall_rule_moved",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} node={pve_node} pos={pos} moveto={body.moveto}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vms/{vmid}/rules/{pos}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_guest_rule(
    vmid: int,
    pos: int = Path(..., ge=0),
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a guest firewall rule (AC-DEL-1)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.delete_guest_firewall_rule(auth, pve_node, vmid, kind, pos)
        await write_audit_log(
            event_type="firewall_rule_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} node={pve_node} pos={pos}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Guest IPSets (local to the VM/LXC) ────────────────────────────────────────

@router.get("/vms/{vmid}/ipsets", response_model=IpSetListResponse, dependencies=[_SCOPE_READ])
async def list_guest_ipsets(
    vmid: int,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> IpSetListResponse:
    """List per-guest IPSets (AC-IPSET-1). Never 500."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    try:
        raw = await client.get_guest_firewall_ipsets(auth, pve_node, vmid, kind)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return IpSetListResponse(permission_denied=True)
        return IpSetListResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall guest ipsets: read failed for %s/%s: %r", pve_node, vmid, exc)
        return IpSetListResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    items = [IpSet(name=_s(i.get("name")) or "", comment=_s(i.get("comment"))) for i in raw if _s(i.get("name"))]
    return IpSetListResponse(items=items)


@router.post("/vms/{vmid}/ipsets", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_guest_ipset(
    vmid: int,
    body: IpSetCreateRequest,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a per-guest IPSet (AC-IPSET-1)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.create_guest_firewall_ipset(auth, pve_node, vmid, kind, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_ipset_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} ipset={body.name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created", "name": body.name}


@router.delete("/vms/{vmid}/ipsets/{name}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_guest_ipset(
    vmid: int,
    name: str = Path(...),
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a per-guest IPSet (AC-IPSET-3)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.delete_guest_firewall_ipset(auth, pve_node, vmid, kind, name)
        await write_audit_log(
            event_type="firewall_ipset_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} ipset={name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/vms/{vmid}/ipsets/{name}/entries", response_model=IpSetEntriesResponse, dependencies=[_SCOPE_READ])
async def list_guest_ipset_entries(
    vmid: int,
    name: str = Path(...),
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> IpSetEntriesResponse:
    """List entries of a per-guest IPSet. Never 500."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    try:
        raw = await client.get_guest_firewall_ipset_entries(auth, pve_node, vmid, kind, name)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return IpSetEntriesResponse(permission_denied=True)
        return IpSetEntriesResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall guest ipset entries: read failed for %s/%s: %r", pve_node, vmid, exc)
        return IpSetEntriesResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    entries = [
        IpSetEntry(cidr=_s(e.get("cidr")) or "", nomatch=_b(e.get("nomatch")), comment=_s(e.get("comment")))
        for e in raw if _s(e.get("cidr"))
    ]
    return IpSetEntriesResponse(entries=entries)


@router.post("/vms/{vmid}/ipsets/{name}/entries", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def add_guest_ipset_entry(
    vmid: int,
    body: IpSetEntryRequest,
    name: str = Path(...),
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Add an IP/CIDR entry to a per-guest IPSet (AC-IPSET-1)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.add_guest_firewall_ipset_entry(auth, pve_node, vmid, kind, name, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_ipset_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} ipset={name} +{body.cidr}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created"}


@router.delete("/vms/{vmid}/ipsets/{name}/entries/{cidr:path}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_guest_ipset_entry(
    vmid: int,
    name: str = Path(...),
    cidr: str = Path(..., description="IP/CIDR entry (may contain '/')"),
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Remove an entry from a per-guest IPSet."""
    _assert_safe_ipset_cidr(cidr)  # BUG-90-1: block path traversal via {cidr:path}
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.delete_guest_firewall_ipset_entry(auth, pve_node, vmid, kind, name, cidr)
        await write_audit_log(
            event_type="firewall_ipset_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} ipset={name} -{cidr}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Guest Aliases (local to the VM/LXC) ───────────────────────────────────────

@router.get("/vms/{vmid}/aliases", response_model=AliasListResponse, dependencies=[_SCOPE_READ])
async def list_guest_aliases(
    vmid: int,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> AliasListResponse:
    """List per-guest aliases (AC-ALIAS-1). Never 500."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    try:
        raw = await client.get_guest_firewall_aliases(auth, pve_node, vmid, kind)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            return AliasListResponse(permission_denied=True)
        return AliasListResponse(node_unreachable=True, detail=f"Proxmox HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("firewall guest aliases: read failed for %s/%s: %r", pve_node, vmid, exc)
        return AliasListResponse(node_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")
    items = [
        FirewallAlias(
            name=_s(a.get("name")) or "", cidr=_s(a.get("cidr")),
            comment=_s(a.get("comment")), ipversion=_i(a.get("ipversion")),
        )
        for a in raw if _s(a.get("name"))
    ]
    return AliasListResponse(items=items)


@router.post("/vms/{vmid}/aliases", status_code=status.HTTP_201_CREATED, dependencies=[_SCOPE_WRITE])
async def create_guest_alias(
    vmid: int,
    body: AliasWriteRequest,
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Create a per-guest alias (AC-ALIAS-1)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.create_guest_firewall_alias(auth, pve_node, vmid, kind, body.to_proxmox_params())
        await write_audit_log(
            event_type="firewall_alias_created",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} alias={body.name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return {"status": "created", "name": body.name}


@router.put("/vms/{vmid}/aliases/{name}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_guest_alias(
    vmid: int,
    name: str = Path(...),
    body: AliasWriteRequest = ...,  # noqa: B008
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Edit a per-guest alias."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.update_guest_firewall_alias(auth, pve_node, vmid, kind, name, body.to_proxmox_params(for_update=True))
        await write_audit_log(
            event_type="firewall_alias_updated",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} alias={name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vms/{vmid}/aliases/{name}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_guest_alias(
    vmid: int,
    name: str = Path(...),
    node: str | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Delete a per-guest alias (AC-ALIAS-3)."""
    client, auth, pve_node, kind = await _resolve_guest_fw(current_user, vmid, node)
    await _assert_guest_firewall_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
    try:
        await client.delete_guest_firewall_alias(auth, pve_node, vmid, kind, name)
        await write_audit_log(
            event_type="firewall_alias_deleted",
            username=current_user.username, auth_type=current_user.auth_type,
            detail=f"level=guest {kind}={vmid} alias={name}",
        )
    except httpx.HTTPStatusError as exc:
        raise _firewall_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Usage fan-out helper (OP5, cluster-wide, best-effort) ─────────────────────

def _rule_matches(raw: dict, kind: str, name: str) -> bool:
    """Does a raw rule reference the security-group / ipset / alias *name*?

    Exact segment match against source/dest (the ``+ipset``/alias token) — no
    substring (avoids the vmbr1↔vmbr10 trap, Lehre PROJ-79)."""
    if not isinstance(raw, dict):
        return False
    if kind == "group":
        return str(raw.get("type", "")).lower() == "group" and _s(raw.get("action")) == name
    target = f"+{name}" if kind == "ipset" else name
    for field in ("source", "dest"):
        val = _s(raw.get(field))
        if val and any(tok.strip() == target for tok in val.split(",")):
            return True
    return False


async def _find_firewall_object_usage(
    client, auth, kind: str, name: str
) -> tuple[list[FirewallUsageEntry], bool]:
    """Cluster-wide fan-out (Tech Design H): datacenter rules + security-group rules
    + all node rules + all guest rules. Returns (usages, incomplete)."""
    usages: list[FirewallUsageEntry] = []
    incomplete = False

    # 1) Datacenter rules
    try:
        for r in await client.get_dc_firewall_rules(auth):
            if _rule_matches(r, kind, name):
                usages.append(FirewallUsageEntry(level="datacenter", pos=_i(r.get("pos")) or 0, rule=_rule_summary(r)))
    except Exception as exc:
        logger.warning("firewall usage: dc rules read failed: %r", exc)
        incomplete = True

    # 2) Security-group member rules (a group rule can reference an ipset/alias)
    try:
        groups = await client.get_firewall_groups(auth)
    except Exception as exc:
        logger.warning("firewall usage: groups read failed: %r", exc)
        groups = []
        incomplete = True
    sem = asyncio.Semaphore(10)

    async def _group_rules(group_name: str):
        nonlocal incomplete
        async with sem:
            try:
                return group_name, await client.get_firewall_group_rules(auth, group_name)
            except Exception:
                incomplete = True
                return group_name, []

    group_names = [_s(g.get("group")) for g in groups if isinstance(g, dict) and _s(g.get("group"))]
    for gname, grules in await asyncio.gather(*[_group_rules(g) for g in group_names]):
        for r in grules:
            if _rule_matches(r, kind, name):
                usages.append(FirewallUsageEntry(
                    level="datacenter", group=gname, pos=_i(r.get("pos")) or 0, rule=_rule_summary(r),
                ))

    # 3) Node rules (cluster-wide)
    try:
        nodes = await client.get_cluster_resources_v2(auth, "node")
    except Exception as exc:
        logger.warning("firewall usage: node list failed: %r", exc)
        nodes = []
        incomplete = True
    node_names = [
        _s(n.get("node")) for n in nodes
        if isinstance(n, dict) and _s(n.get("node"))
        and str(n.get("status", "")).lower() in ("", "online", "unknown")
    ]

    async def _node_rules(node_name: str):
        nonlocal incomplete
        async with sem:
            try:
                return node_name, await client.get_node_firewall_rules(auth, node_name)
            except Exception:
                incomplete = True
                return node_name, []

    for nname, nrules in await asyncio.gather(*[_node_rules(n) for n in node_names if n]):
        for r in nrules:
            if _rule_matches(r, kind, name):
                usages.append(FirewallUsageEntry(level="node", node=nname, pos=_i(r.get("pos")) or 0, rule=_rule_summary(r)))

    # 4) Guest rules (cluster-wide)
    try:
        vms = await client.get_cluster_resources_v2(auth, "vm")
    except Exception as exc:
        logger.warning("firewall usage: vm list failed: %r", exc)
        vms = []
        incomplete = True

    async def _guest_rules(r: dict):
        nonlocal incomplete
        vmid = _i(r.get("vmid"))
        node = _s(r.get("node"))
        if vmid is None or not node:
            return None
        gk = "lxc" if str(r.get("type", "")).lower() == "lxc" else "qemu"
        async with sem:
            try:
                rules = await client.get_guest_firewall_rules(auth, node, vmid, gk)
            except Exception:
                incomplete = True
                return None
        hits = []
        for rule in rules:
            if _rule_matches(rule, kind, name):
                hits.append(FirewallUsageEntry(
                    level="guest", node=node, vmid=vmid, kind=gk,
                    pos=_i(rule.get("pos")) or 0, rule=_rule_summary(rule),
                ))
        return hits

    guest_targets = [r for r in vms if isinstance(r, dict) and r.get("vmid")]
    for hits in await asyncio.gather(*[_guest_rules(r) for r in guest_targets]):
        if hits:
            usages.extend(hits)

    return usages, incomplete
