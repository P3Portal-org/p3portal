# p3portal.org
"""PROJ-80: Cluster-weite SDN-Verwaltung (Zonen / VNets / Subnets).

Manuelles CRUD auf dem Proxmox-SDN über die Datacenter-API (`/cluster/sdn/*`).
Zustand lebt vollständig in Proxmox (keine DB-Tabelle, kein ETag — letzter
Schreiber gewinnt, EC-3). SDN ist **datacenter-weit innerhalb EINER Proxmox-
Installation**: der Apply (`PUT /cluster/sdn`) ist ein globaler Reload auf allen
Member-Nodes dieser Installation. P3 kann mehrere **unabhängige** Installationen
verwalten (z. B. zwei Standalone-Nodes, NICHT in einem Cluster) — jede hat ihr
eigenes `/cluster/sdn`. Der optionale Query-Param `?node=<portal_node_id>` wählt
die Ziel-Installation; ohne ihn die Default-Node (Ein-Installations-Setups
bleiben unverändert).

Auth-Stufen (Lehre PROJ-79/BUG-79-4 — /cluster/sdn/* braucht mehr als Viewer):
  Read:  admin→operator→viewer-Token-Kette der Ziel-Installation
  Write: Admin-Token der Ziel-Installation (SDN.Allocate)

RBAC-Gate (`_assert_sdn_access`): Admin ODER manage_sdn — **kein** Node-Scope
(SDN ist cluster-weit), daher simpler als PROJ-79.

Schreib-Fehler-Mapper `_sdn_write_http_exc`: 403→403 (SDN.Allocate fehlt — der
Admin muss es wissen), 401→502 (Anti-Logout S115), sonst Code. Eigener Mapper,
weil der globale _cluster_http_exc Token-403→502 zieht und Schreib-403 verschleiern
würde.

Pending-Erkennung über das PVE-`state`-Feld (new/changed/deleted) bei `pending=1`
— versions-fragil, #1-Verifikationspunkt gegen echtes PVE (Lehre PROJ-79).
"""
from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from backend.features.api_surface.deps import require_scope_for_upk  # PROJ-97

from backend.core.deps import CurrentUser, get_current_user
from backend.models.sdn import (
    SdnBridgesResponse,
    SdnPendingResponse,
    SdnSubnet,
    SdnSubnetListResponse,
    SdnSubnetWriteRequest,
    SdnUsageEntryVm,
    SdnUsageResponse,
    SdnVnet,
    SdnVnetListResponse,
    SdnVnetWriteRequest,
    SdnWriteResponse,
    SdnZone,
    SdnZoneListResponse,
    SdnZoneWriteRequest,
)
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sdn", tags=["sdn"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). GET → :read, Mutationen → :write.
_SCOPE_READ = Depends(require_scope_for_upk("sdn:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("sdn:write"))

# HTTP codes that signal "SDN feature not available on this cluster" (EC-7).
_SDN_UNAVAILABLE_CODES = (404, 501)


# ── Error mapper ──────────────────────────────────────────────────────────────

def _sdn_write_http_exc(exc: httpx.HTTPStatusError) -> HTTPException:
    """Map Proxmox SDN write-path errors (AC-ERR-1).

    403 → 403 (missing SDN.Allocate / privileges – the admin must know, EC-10)
    401 → 502 (token invalid/deleted – stay logged in, Anti-Logout S115)
    else → pass status code through
    """
    code = exc.response.status_code
    if code == 403:
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient Proxmox privileges for SDN management "
                   "(SDN.Allocate required on /sdn)",
        )
    if code == 401:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox auth error – admin service account token may be invalid or deleted",
        )
    return HTTPException(status_code=code, detail="Proxmox API error")


# ── RBAC gate ─────────────────────────────────────────────────────────────────

def _assert_sdn_access(current_user: CurrentUser) -> None:
    """Allow Admin OR manage_sdn (AC-RBAC-2). Raises 403 otherwise.

    Called first in every endpoint. No node scope — SDN is cluster-wide (AC-RBAC-1).
    """
    if current_user.role == "admin":
        return
    if "manage_sdn" in current_user.portal_permissions:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="sdn_management_not_authorized",
    )


# ── Auth resolvers (per installation: a selected portal node, else the default) ──
#
# SDN is datacenter-wide *within one Proxmox installation*. P3 can manage several
# independent installations (e.g. two standalone nodes not in a cluster), each
# with its OWN /cluster/sdn. The optional ``portal_node_id`` selects which
# installation to target; without it we fall back to the default node (one-
# installation setups stay unchanged).

async def _resolve_sdn_node(portal_node_id: int | None):
    """Resolve the target portal-node row (selected installation, else default)."""
    from backend.services.nodes_service import get_default_node, get_node
    node_row = await get_node(portal_node_id) if portal_node_id is not None else await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured" if portal_node_id is None
            else f"Portal node {portal_node_id} not found",
        )
    return node_row


async def _resolve_sdn_read_auth(current_user: CurrentUser, portal_node_id: int | None = None):
    """Resolve the strongest available read token (admin→operator→viewer) of the target installation.

    Reading ``/cluster/sdn/*`` requires more privilege than a plain viewer token
    often carries (``SDN.Audit``/``Sys.Audit``) — a viewer-only resolver leaves the
    SDN view empty (exactly the BUG-79-4 trap). The SDN view is authorized-only
    anyway (admin / manage_sdn), so we pick the strongest read token. The target
    installation is the selected portal node, else the default (multi-installation).
    """
    if current_user.auth_type == "proxmox":
        from backend.services.proxmox import proxmox_client
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        from backend.services.proxmox import ProxmoxAuth
        return proxmox_client, ProxmoxAuth(
            kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""),
        )

    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
    from backend.services.service_accounts import _extract_token
    node_row = await _resolve_sdn_node(portal_node_id)
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


async def _resolve_sdn_write_auth(current_user: CurrentUser, portal_node_id: int | None = None):
    """Resolve the admin write token (SDN.Allocate) of the target installation.

    Falls back to the cluster session cookie for proxmox-login users. Missing admin
    token → 503 (AC-RBAC-4); missing *privilege* at runtime → 403 via the mapper.
    The target installation is the selected portal node, else the default.
    """
    if current_user.auth_type == "proxmox":
        from backend.services.proxmox import proxmox_client
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        from backend.services.proxmox import ProxmoxAuth
        return proxmox_client, ProxmoxAuth(
            kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""),
        )

    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
    from backend.services.service_accounts import _extract_token
    node_row = await _resolve_sdn_node(portal_node_id)
    token = _extract_token(node_row, "admin")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin service account (SDN.Allocate) not configured for this node",
        )
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


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


def _obj_pending(raw: dict) -> bool:
    """Is this SDN object staged (pending apply)? Primary signal = the PVE 'state' field.

    With ``pending=1`` the SDN list endpoints expose a ``state`` of new/changed/deleted
    on staged objects. Pending detection is version-fragile (verification point); we
    fall back to a truthy ``pending`` field/dict if present.
    """
    if not isinstance(raw, dict):
        return False
    if _s(raw.get("state")):
        return True
    p = raw.get("pending")
    if isinstance(p, dict):
        return len(p) > 0
    return _b(p)


def _parse_zone(raw: dict) -> SdnZone:
    if not isinstance(raw, dict):
        raw = {}
    return SdnZone(
        id=_s(raw.get("zone")) or _s(raw.get("id")) or "",
        type=_s(raw.get("type")) or "unknown",
        mtu=_i(raw.get("mtu")),
        nodes=_s(raw.get("nodes")),
        bridge=_s(raw.get("bridge")),
        dns=_s(raw.get("dns")),
        dnszone=_s(raw.get("dnszone")),
        ipam=_s(raw.get("ipam")),
        pending=_obj_pending(raw),
        state=_s(raw.get("state")),
    )


def _parse_vnet(raw: dict) -> SdnVnet:
    if not isinstance(raw, dict):
        raw = {}
    return SdnVnet(
        id=_s(raw.get("vnet")) or _s(raw.get("id")) or "",
        zone=_s(raw.get("zone")),
        tag=_i(raw.get("tag")),
        alias=_s(raw.get("alias")),
        vlanaware=_b(raw.get("vlanaware")),
        pending=_obj_pending(raw),
        state=_s(raw.get("state")),
    )


def _parse_subnet(raw: dict, vnet: str) -> SdnSubnet:
    if not isinstance(raw, dict):
        raw = {}
    return SdnSubnet(
        id=_s(raw.get("subnet")) or _s(raw.get("id")) or "",
        vnet=_s(raw.get("vnet")) or vnet,
        cidr=_s(raw.get("cidr")),
        gateway=_s(raw.get("gateway")),
        snat=_b(raw.get("snat")),
        pending=_obj_pending(raw),
        state=_s(raw.get("state")),
    )


# ── Zones ─────────────────────────────────────────────────────────────────────

@router.get("/zones", response_model=SdnZoneListResponse, dependencies=[_SCOPE_READ])
async def list_sdn_zones(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnZoneListResponse:
    """List SDN zones with pending flags (AC-LIST-1/2). Never 500 — flags instead (EC-7)."""
    _assert_sdn_access(current_user)
    try:
        client, auth = await _resolve_sdn_read_auth(current_user, node)
    except HTTPException as exc:
        return SdnZoneListResponse(cluster_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("sdn zones: auth resolution failed: %r", exc)
        return SdnZoneListResponse(cluster_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        raw = await client.get_sdn_zones(auth)
        items = [_parse_zone(z) for z in raw]
        return SdnZoneListResponse(items=items, has_pending=any(i.pending for i in items))
    except httpx.HTTPStatusError as exc:
        return _list_status_error("zones", exc, SdnZoneListResponse)
    except httpx.RequestError as exc:
        logger.warning("sdn zones: connection failed: %r", exc)
        return SdnZoneListResponse(cluster_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("sdn zones: processing failed: %r", exc, exc_info=True)
        return SdnZoneListResponse(cluster_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")


@router.post("/zones", status_code=status.HTTP_201_CREATED, response_model=SdnWriteResponse, dependencies=[_SCOPE_WRITE])
async def create_sdn_zone(
    body: SdnZoneWriteRequest,
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnWriteResponse:
    """Create an SDN zone (staged as pending, AC-CZ-5). 409 on id collision (AC-CZ-4)."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)

    # Deterministic 409 pre-check (Lehre BUG-79-2). Best-effort: if the list read
    # itself fails we fall through and let Proxmox reject the duplicate.
    try:
        existing = await client.get_sdn_zones(auth)
        if any(isinstance(z, dict) and _s(z.get("zone")) == body.zone for z in existing):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Zone '{body.zone}' existiert bereits",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("sdn zone create: collision pre-check failed: %r", exc)

    params = body.to_proxmox_params()
    params["zone"] = body.zone
    try:
        await client.create_sdn_zone(auth, params)
        await write_audit_log(
            event_type="sdn_zone_created",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"zone={body.zone} type={body.type}",
        )
        return SdnWriteResponse(id=body.zone, warnings=body.soft_warnings())
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/zones/{zone}", response_model=SdnWriteResponse, dependencies=[_SCOPE_WRITE])
async def update_sdn_zone(
    zone: str = Path(...),
    body: SdnZoneWriteRequest = ...,  # noqa: B008
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnWriteResponse:
    """Fully edit an SDN zone (staged as pending, AC-UP-1/2). 'type' is immutable in PVE."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    params = body.to_proxmox_params(for_update=True)
    try:
        await client.update_sdn_zone(auth, zone, params)
        await write_audit_log(
            event_type="sdn_zone_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"zone={zone} type={body.type}",
        )
        return SdnWriteResponse(id=zone, warnings=body.soft_warnings())
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/zones/{zone}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_sdn_zone(
    zone: str = Path(...),
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Mark an SDN zone for removal (staged as pending, AC-DEL-3).

    Usage warning is the frontend's responsibility via GET /zones/{zone}/usage."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    try:
        await client.delete_sdn_zone(auth, zone)
        await write_audit_log(
            event_type="sdn_zone_deleted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"zone={zone}",
        )
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/zones/{zone}/usage", response_model=SdnUsageResponse, dependencies=[_SCOPE_READ])
async def check_sdn_zone_usage(
    zone: str = Path(...),
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnUsageResponse:
    """Which VNets live in this zone (AC-DEL-1)? Cheap local list filter."""
    _assert_sdn_access(current_user)
    try:
        client, auth = await _resolve_sdn_read_auth(current_user, node)
        vnets = await client.get_sdn_vnets(auth)
    except Exception as exc:
        logger.warning("sdn zone usage: read failed for zone '%s': %r", zone, exc)
        return SdnUsageResponse(id=zone, incomplete=True)
    in_zone = [
        _s(v.get("vnet")) for v in vnets
        if isinstance(v, dict) and _s(v.get("zone")) == zone and _s(v.get("vnet"))
    ]
    in_zone = [x for x in in_zone if x]
    return SdnUsageResponse(id=zone, in_use=bool(in_zone), vnets=in_zone)


# ── VNets ─────────────────────────────────────────────────────────────────────

@router.get("/vnets", response_model=SdnVnetListResponse, dependencies=[_SCOPE_READ])
async def list_sdn_vnets(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnVnetListResponse:
    """List SDN VNets with zone + tag + pending flags (AC-LIST-1/2)."""
    _assert_sdn_access(current_user)
    try:
        client, auth = await _resolve_sdn_read_auth(current_user, node)
    except HTTPException as exc:
        return SdnVnetListResponse(cluster_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("sdn vnets: auth resolution failed: %r", exc)
        return SdnVnetListResponse(cluster_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        raw = await client.get_sdn_vnets(auth)
        items = [_parse_vnet(v) for v in raw]
        return SdnVnetListResponse(items=items, has_pending=any(i.pending for i in items))
    except httpx.HTTPStatusError as exc:
        return _list_status_error("vnets", exc, SdnVnetListResponse)
    except httpx.RequestError as exc:
        logger.warning("sdn vnets: connection failed: %r", exc)
        return SdnVnetListResponse(cluster_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("sdn vnets: processing failed: %r", exc, exc_info=True)
        return SdnVnetListResponse(cluster_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")


@router.post("/vnets", status_code=status.HTTP_201_CREATED, response_model=SdnWriteResponse, dependencies=[_SCOPE_WRITE])
async def create_sdn_vnet(
    body: SdnVnetWriteRequest,
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnWriteResponse:
    """Create a VNet (staged as pending, AC-CV-2).

    Enforces tag-required-in-VLAN-zone (EC-9) and a 409 id-collision pre-check.
    """
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)

    # Zone-type dependent tag requirement (EC-9) + 409 pre-check. Best-effort:
    # if the read fails, Proxmox validates on its own.
    try:
        zones = await client.get_sdn_zones(auth)
        zone_obj = next(
            (z for z in zones if isinstance(z, dict) and _s(z.get("zone")) == body.zone), None
        )
        if zone_obj is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Zone '{body.zone}' existiert nicht",
            )
        if _s(zone_obj.get("type")) == "vlan" and body.tag is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="VNet in einer VLAN-Zone benötigt einen VLAN-Tag",
            )
        existing = await client.get_sdn_vnets(auth)
        if any(isinstance(v, dict) and _s(v.get("vnet")) == body.vnet for v in existing):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"VNet '{body.vnet}' existiert bereits",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("sdn vnet create: pre-check failed: %r", exc)

    params = body.to_proxmox_params()
    params["vnet"] = body.vnet
    try:
        await client.create_sdn_vnet(auth, params)
        await write_audit_log(
            event_type="sdn_vnet_created",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"vnet={body.vnet} zone={body.zone} tag={body.tag}",
        )
        return SdnWriteResponse(id=body.vnet, warnings=[])
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/vnets/{vnet}", response_model=SdnWriteResponse, dependencies=[_SCOPE_WRITE])
async def update_sdn_vnet(
    vnet: str = Path(...),
    body: SdnVnetWriteRequest = ...,  # noqa: B008
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnWriteResponse:
    """Fully edit a VNet (staged as pending, AC-UP-1/2)."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    params = body.to_proxmox_params(for_update=True)
    try:
        await client.update_sdn_vnet(auth, vnet, params)
        await write_audit_log(
            event_type="sdn_vnet_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"vnet={vnet} zone={body.zone}",
        )
        return SdnWriteResponse(id=vnet, warnings=[])
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vnets/{vnet}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_sdn_vnet(
    vnet: str = Path(...),
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Mark a VNet for removal (staged as pending, AC-DEL-3)."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    try:
        await client.delete_sdn_vnet(auth, vnet)
        await write_audit_log(
            event_type="sdn_vnet_deleted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"vnet={vnet}",
        )
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/vnets/{vnet}/usage", response_model=SdnUsageResponse, dependencies=[_SCOPE_READ])
async def check_sdn_vnet_usage(
    vnet: str = Path(...),
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnUsageResponse:
    """Which guests (cluster-wide fan-out) + subnets reference this VNet (AC-DEL-1)."""
    _assert_sdn_access(current_user)
    try:
        client, auth = await _resolve_sdn_read_auth(current_user, node)
    except Exception as exc:
        logger.warning("sdn vnet usage: auth failed for vnet '%s': %r", vnet, exc)
        return SdnUsageResponse(id=vnet, incomplete=True)

    vms, incomplete = await _find_vnet_usage(client, auth, vnet)
    subnets: list[str] = []
    try:
        raw = await client.get_sdn_subnets(auth, vnet)
        subnets = [_s(s.get("subnet")) for s in raw if isinstance(s, dict) and _s(s.get("subnet"))]
        subnets = [x for x in subnets if x]
    except Exception as exc:
        logger.warning("sdn vnet usage: subnet read failed for vnet '%s': %r", vnet, exc)
        incomplete = True

    return SdnUsageResponse(
        id=vnet,
        in_use=bool(vms) or bool(subnets),
        vms=vms,
        subnets=subnets,
        incomplete=incomplete,
    )


# ── Bridges (form helper for the VLAN-zone bridge picker) ─────────────────────

@router.get("/bridges", response_model=SdnBridgesResponse, dependencies=[_SCOPE_READ])
async def list_sdn_bridges(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnBridgesResponse:
    """Union of Linux/OVS bridge names across the online cluster nodes.

    Cluster-wide (SDN has no node context): a VLAN zone's trunk bridge must exist
    on the relevant nodes; this populates the bridge dropdown. Best-effort, never
    500 — empty list + ``incomplete`` flag on error (the field stays free-text)."""
    _assert_sdn_access(current_user)
    try:
        client, auth = await _resolve_sdn_read_auth(current_user, node)
    except Exception as exc:
        logger.warning("sdn bridges: auth resolution failed: %r", exc)
        return SdnBridgesResponse(incomplete=True)

    try:
        nodes = await client.get_cluster_resources_v2(auth, "node")
    except Exception as exc:
        logger.warning("sdn bridges: cluster node list failed: %r", exc)
        return SdnBridgesResponse(incomplete=True)

    node_names = [
        _s(n.get("node")) for n in nodes
        if isinstance(n, dict) and _s(n.get("node"))
        and str(n.get("status", "")).lower() in ("", "online", "unknown")
    ]
    node_names = [n for n in node_names if n]
    if not node_names:
        return SdnBridgesResponse()

    sem = asyncio.Semaphore(10)
    incomplete = False

    async def _fetch(node: str) -> list[str]:
        nonlocal incomplete
        async with sem:
            try:
                return await client.get_node_bridges(auth, node)
            except Exception as exc:
                logger.warning("sdn bridges: read for node '%s' failed: %r", node, exc)
                incomplete = True
                return []

    results = await asyncio.gather(*[_fetch(n) for n in node_names])
    bridges = sorted({b for batch in results for b in batch if b})
    return SdnBridgesResponse(bridges=bridges, incomplete=incomplete)


# ── Subnets ───────────────────────────────────────────────────────────────────

@router.get("/subnets", response_model=SdnSubnetListResponse, dependencies=[_SCOPE_READ])
async def list_sdn_subnets(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnSubnetListResponse:
    """List subnets, fanned out over all VNets (subnets are nested under VNets, AC-LIST-1)."""
    _assert_sdn_access(current_user)
    try:
        client, auth = await _resolve_sdn_read_auth(current_user, node)
    except HTTPException as exc:
        return SdnSubnetListResponse(cluster_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("sdn subnets: auth resolution failed: %r", exc)
        return SdnSubnetListResponse(cluster_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        vnets = await client.get_sdn_vnets(auth)
    except httpx.HTTPStatusError as exc:
        return _list_status_error("subnets", exc, SdnSubnetListResponse)
    except httpx.RequestError as exc:
        logger.warning("sdn subnets: connection failed: %r", exc)
        return SdnSubnetListResponse(cluster_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("sdn subnets: processing failed: %r", exc, exc_info=True)
        return SdnSubnetListResponse(cluster_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")

    vnet_ids = [_s(v.get("vnet")) for v in vnets if isinstance(v, dict) and _s(v.get("vnet"))]
    sem = asyncio.Semaphore(10)

    async def _fetch(vnet_id: str) -> list[SdnSubnet]:
        async with sem:
            try:
                raw = await client.get_sdn_subnets(auth, vnet_id)
            except Exception as exc:
                logger.warning("sdn subnets: read for vnet '%s' failed: %r", vnet_id, exc)
                return []
        return [_parse_subnet(s, vnet_id) for s in raw]

    results = await asyncio.gather(*[_fetch(vid) for vid in vnet_ids if vid])
    items: list[SdnSubnet] = [s for batch in results for s in batch]
    return SdnSubnetListResponse(items=items, has_pending=any(i.pending for i in items))


@router.post("/subnets", status_code=status.HTTP_201_CREATED, response_model=SdnWriteResponse, dependencies=[_SCOPE_WRITE])
async def create_sdn_subnet(
    body: SdnSubnetWriteRequest,
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnWriteResponse:
    """Create a subnet (CIDR + gateway/SNAT) under a VNet (staged as pending, AC-CS-2)."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    params = body.to_proxmox_params()
    try:
        await client.create_sdn_subnet(auth, body.vnet, params)
        await write_audit_log(
            event_type="sdn_subnet_created",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"vnet={body.vnet} cidr={body.cidr}",
        )
        return SdnWriteResponse(id=body.cidr, warnings=body.soft_warnings())
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/subnets/{vnet}/{subnet}", response_model=SdnWriteResponse, dependencies=[_SCOPE_WRITE])
async def update_sdn_subnet(
    vnet: str = Path(...),
    subnet: str = Path(...),
    body: SdnSubnetWriteRequest = ...,  # noqa: B008
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnWriteResponse:
    """Fully edit a subnet (staged as pending, AC-UP-1/2). subnet id = {zone}-{cidr-dash}."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    params = body.to_proxmox_params(for_update=True)
    try:
        await client.update_sdn_subnet(auth, vnet, subnet, params)
        await write_audit_log(
            event_type="sdn_subnet_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"vnet={vnet} subnet={subnet}",
        )
        return SdnWriteResponse(id=subnet, warnings=body.soft_warnings())
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/subnets/{vnet}/{subnet}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_sdn_subnet(
    vnet: str = Path(...),
    subnet: str = Path(...),
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Mark a subnet for removal (staged as pending, AC-DEL-3)."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    try:
        await client.delete_sdn_subnet(auth, vnet, subnet)
        await write_audit_log(
            event_type="sdn_subnet_deleted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"vnet={vnet} subnet={subnet}",
        )
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Aggregate pending + Apply / Revert ────────────────────────────────────────

@router.get("", response_model=SdnPendingResponse, dependencies=[_SCOPE_READ])
async def get_sdn_pending(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> SdnPendingResponse:
    """Aggregate pending counts for the banner (AC-APPLY-1). Never 500 (EC-7)."""
    _assert_sdn_access(current_user)
    try:
        client, auth = await _resolve_sdn_read_auth(current_user, node)
    except HTTPException as exc:
        return SdnPendingResponse(cluster_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("sdn pending: auth resolution failed: %r", exc)
        return SdnPendingResponse(cluster_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        zones = await client.get_sdn_zones(auth)
        vnets = await client.get_sdn_vnets(auth)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code in _SDN_UNAVAILABLE_CODES:
            return SdnPendingResponse(sdn_unavailable=True)
        return SdnPendingResponse(cluster_unreachable=True, detail=f"Proxmox antwortete mit HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.warning("sdn pending: read failed: %r", exc)
        return SdnPendingResponse(cluster_unreachable=True, detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}")

    counts = {
        "zones": sum(1 for z in zones if _obj_pending(z)),
        "vnets": sum(1 for v in vnets if _obj_pending(v)),
        "subnets": 0,
    }

    vnet_ids = [_s(v.get("vnet")) for v in vnets if isinstance(v, dict) and _s(v.get("vnet"))]
    sem = asyncio.Semaphore(10)

    async def _sub(vnet_id: str) -> list[dict]:
        async with sem:
            try:
                return await client.get_sdn_subnets(auth, vnet_id)
            except Exception:
                return []

    sub_results = await asyncio.gather(*[_sub(vid) for vid in vnet_ids if vid])
    counts["subnets"] = sum(1 for batch in sub_results for s in batch if _obj_pending(s))

    return SdnPendingResponse(has_pending=any(counts.values()), counts=counts)


@router.post("/apply", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def apply_sdn_changes(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Apply staged SDN config cluster-wide (PUT /cluster/sdn, AC-APPLY-2).

    WARNING: this reloads SDN on ALL nodes. The frontend warns the user explicitly."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    try:
        await client.apply_sdn(auth)
        await write_audit_log(
            event_type="sdn_applied",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail="cluster-wide SDN apply",
        )
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/revert", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def revert_sdn_changes(
    node: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Discard all staged SDN changes (DELETE /cluster/sdn, AC-APPLY-3)."""
    _assert_sdn_access(current_user)
    client, auth = await _resolve_sdn_write_auth(current_user, node)
    try:
        await client.revert_sdn(auth)
        await write_audit_log(
            event_type="sdn_reverted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail="cluster-wide SDN revert",
        )
    except httpx.HTTPStatusError as exc:
        raise _sdn_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _list_status_error(what: str, exc: httpx.HTTPStatusError, response_cls):
    """Map an HTTP status error on a list read to the right flag (never 500, EC-7)."""
    code = exc.response.status_code
    if code == 403:
        return response_cls(permission_denied=True)
    if code in _SDN_UNAVAILABLE_CODES:
        return response_cls(sdn_unavailable=True)
    logger.warning("sdn %s: Proxmox responded HTTP %s", what, code)
    return response_cls(cluster_unreachable=True, detail=f"Proxmox antwortete mit HTTP {code}")


async def _find_vnet_usage(
    client, auth, vnet: str
) -> tuple[list[SdnUsageEntryVm], bool]:
    """Cluster-wide fan-out: which guests reference VNet *vnet* as a bridge? (Tech Design A.3).

    A VNet is cluster-wide, so — unlike PROJ-79 bridges — we inspect ALL guests
    (no node filter; this also catches Stack VMs, EC-5). Returns (usages, incomplete);
    incomplete=True if any config could not be read. Exact ``bridge=<vnet>`` segment
    match (no substring → vnet1↔vnet10 trap)."""
    try:
        vms = await client.get_cluster_resources_v2(auth, "vm")
    except Exception as exc:
        logger.warning("vnet usage: cluster resources failed: %r", exc)
        return [], True

    targets = [r for r in vms if isinstance(r, dict) and r.get("vmid")]
    if not targets:
        return [], False

    sem = asyncio.Semaphore(10)
    incomplete = False

    async def _check(r: dict):
        nonlocal incomplete
        vmid = _i(r.get("vmid"))
        if vmid is None:
            return None
        node = _s(r.get("node")) or ""
        kind = "lxc" if str(r.get("type", "")).lower() == "lxc" else "qemu"
        async with sem:
            try:
                cfg = await client.get_vm_config(auth, node, vmid, kind)
            except Exception:
                incomplete = True
                return None
        if not isinstance(cfg, dict):
            return None
        for key, val in cfg.items():
            if not (isinstance(key, str) and key.startswith("net") and isinstance(val, str)):
                continue
            for segment in val.split(","):
                if "=" in segment:
                    k, v = segment.split("=", 1)
                    if k.strip() == "bridge" and v.strip() == vnet:
                        return SdnUsageEntryVm(
                            vmid=vmid,
                            name=str(r.get("name") or vmid),
                            node=node,
                            kind=kind,
                        )
        return None

    results = await asyncio.gather(*[_check(r) for r in targets], return_exceptions=True)
    usages = [x for x in results if isinstance(x, SdnUsageEntryVm)]
    return usages, incomplete
