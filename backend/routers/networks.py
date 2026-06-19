# p3portal.org
"""PROJ-79: Node-Netzwerk-Verwaltung (Linux-Bridges & VLAN-Interfaces).

Manuelles CRUD auf Node-Level-Netzwerk-Interfaces über die Proxmox-API
(`/nodes/{node}/network`). Zustand lebt vollständig in Proxmox (keine DB-Tabelle).

Auth-Stufen (analog PROJ-78):
  Read:  Viewer-Token  (cluster._get_client_auth_for_node)
  Write: Admin-Token   (cluster._get_portal_node_write_auth(..., "admin"), Sys.Modify)

RBAC-Gate (`_assert_network_access`): Admin ODER manage_networks ODER
node:manage_network (PROJ-47) auf dem Ziel-Node — geprüft in jedem Endpoint,
weil require_admin_or den ?node=-Parameter nicht kennt.

Schreib-Fehler-Mapper `_network_write_http_exc`: 403→403 (echte Proxmox-Privileg-
Fehler durchreichen), 401→502 (Anti-Logout), sonst Code — wie PROJ-78. Der globale
_cluster_http_exc würde Token-403 auf 502 ziehen und damit Schreib-403 verschleiern.
"""
from __future__ import annotations

import asyncio
import ipaddress
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from backend.features.api_surface.deps import require_scope_for_upk  # PROJ-97

from backend.core.deps import CurrentUser, get_current_user
from backend.models.networks import (
    NetworkIfaceWriteRequest,
    NetworkInterface,
    NetworkListResponse,
    NetworkUsageEntry,
    NetworkUsageResponse,
    NetworkWriteResponse,
)
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/networks", tags=["networks"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). GET → :read, Mutationen → :write.
_SCOPE_READ = Depends(require_scope_for_upk("networks:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("networks:write"))


# ── Error mapper ──────────────────────────────────────────────────────────────

def _network_write_http_exc(exc: httpx.HTTPStatusError) -> HTTPException:
    """Map Proxmox write-path errors (AC-ERR-1).

    403 → 403 (missing Sys.Modify / privileges – the admin must know)
    401 → 502 (token invalid/deleted – stay logged in, Anti-Logout S115)
    else → pass status code through
    """
    code = exc.response.status_code
    if code == 403:
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient Proxmox privileges for network management "
                   "(Sys.Modify required on /nodes/{node})",
        )
    if code == 401:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox auth error – admin service account token may be invalid or deleted",
        )
    return HTTPException(status_code=code, detail="Proxmox API error")


# ── RBAC gate ─────────────────────────────────────────────────────────────────

async def _assert_network_access(current_user: CurrentUser, node: str) -> None:
    """Allow Admin OR manage_networks OR node:manage_network on the target node (AC-RBAC-3).

    Raises HTTP 403 otherwise. Called first in every endpoint — require_admin_or
    alone cannot see the ?node= param to evaluate the node scope (Tech Design B).
    """
    if current_user.role == "admin":
        return
    if "manage_networks" in current_user.portal_permissions:
        return
    if current_user.user_id is not None:
        try:
            from backend.services.nodes_service import get_node_for_proxmox_name
            from backend.services.permissions_resolver import resolve_node_action
            portal_node = await get_node_for_proxmox_name(node)
            if portal_node is not None and await resolve_node_action(
                current_user.user_id, portal_node.id, "node:manage_network"
            ):
                return
        except Exception as exc:
            logger.warning("network RBAC node-scope check failed for node '%s': %r", node, exc)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="network_management_not_authorized",
    )


# ── Auth resolvers ────────────────────────────────────────────────────────────

async def _resolve_read_auth(current_user: CurrentUser, node: str):
    """Resolve the strongest available read token (admin→operator→viewer).

    Reading ``GET /nodes/{node}/network`` requires more privilege than e.g.
    ``/status`` and the plain viewer token often lacks it (``Sys.Audit`` on
    ``/nodes/{node}``) — a viewer-only resolver leaves the tab empty. The network
    tab is authorized-only anyway (admin / manage_networks / node-scope), so we
    pick the strongest read token, mirroring the proven ``get_node_vm_options``
    path (S579) and ``iso_service``/lxc-template-storages (S289/S290/S540).
    """
    from backend.routers.cluster import _get_client_auth_for_node
    # Proxmox-login users carry a cluster-wide session cookie.
    if current_user.auth_type == "proxmox":
        return await _get_client_auth_for_node(current_user, node)

    from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name
    from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
    from backend.services.service_accounts import _extract_token
    node_row = await get_node_for_proxmox_name(node) or await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured",
        )
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


async def _resolve_write_auth(current_user: CurrentUser, node: str):
    from backend.routers.cluster import _get_portal_node_write_auth
    return await _get_portal_node_write_auth(current_user, node, "admin")


# ── Typesafe parsing (PVE version drift, Lehre PROJ-78/S576) ──────────────────

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


# Candidate keys a PVE version may use to flag a staged (pending) interface change.
# Pending detection is version-fragile (verification point); we read whatever PVE
# exposes and fall back conservatively.
_PENDING_KEYS = ("pending",)


def _iface_pending(raw: dict) -> bool:
    return any(_b(raw.get(k)) for k in _PENDING_KEYS)


def _is_manageable_iface(raw: dict) -> bool:
    """Is this a bridge or VLAN we manage? Lenient against PVE type drift.

    Catches type 'bridge'/'vlan' exactly, plus bridge-typical names (vmbrN /
    ovsbrN) and dotted VLAN names (<dev>.<vid>) even if the reported type differs
    — so a real bridge is never dropped, which would leave the tab empty."""
    if not isinstance(raw, dict):
        return False
    typ = str(raw.get("type", "")).lower()
    iface = str(raw.get("iface", ""))
    if typ in ("bridge", "vlan"):
        return True
    if "bridge" in typ or iface.startswith("vmbr") or iface.startswith("ovsbr"):
        return True
    # dotted VLAN sub-interface, e.g. vmbr0.100 / eth0.100
    if "." in iface and iface.rsplit(".", 1)[-1].isdigit():
        return True
    return False


def _cidr_from_raw(raw: dict) -> str | None:
    """Prefer the cidr field; otherwise build it from address + netmask (older PVE)."""
    cidr = _s(raw.get("cidr"))
    if cidr:
        return cidr
    address = _s(raw.get("address"))
    netmask = _s(raw.get("netmask"))
    if address and netmask:
        try:
            return str(ipaddress.ip_interface(f"{address}/{netmask}").with_prefixlen)
        except ValueError:
            return None
    return None


def _parse_network_iface(raw: dict) -> NetworkInterface:
    """Convert a raw Proxmox /nodes/{node}/network entry to a NetworkInterface.

    Defensive against PVE-version field-type drift: never raises (a bad value on a
    second node would otherwise surface as an opaque HTTP 500)."""
    if not isinstance(raw, dict):
        raw = {}
    ports_raw = raw.get("bridge_ports")
    bridge_ports: list[str] = []
    if isinstance(ports_raw, str):
        bridge_ports = [p for p in ports_raw.split() if p and p != "none"]
    elif isinstance(ports_raw, (list, tuple)):
        bridge_ports = [str(p) for p in ports_raw if p and str(p) != "none"]

    return NetworkInterface(
        iface=_s(raw.get("iface")) or "",
        type=_s(raw.get("type")) or "unknown",
        method=_s(raw.get("method")),
        cidr=_cidr_from_raw(raw),
        gateway=_s(raw.get("gateway")),
        cidr6=_s(raw.get("cidr6")),
        gateway6=_s(raw.get("gateway6")),
        mtu=_i(raw.get("mtu")),
        autostart=_b(raw.get("autostart")),
        comments=_s(raw.get("comments")),
        active=(_b(raw.get("active")) if raw.get("active") not in (None, "") else None),
        pending=_iface_pending(raw),
        bridge_ports=bridge_ports,
        bridge_vlan_aware=_b(raw.get("bridge_vlan_aware")),
        bridge_vids=_s(raw.get("bridge_vids")),
        vlan_raw_device=_s(raw.get("vlan-raw-device") or raw.get("vlan_raw_device")),
        vlan_id=_i(raw.get("vlan-id") or raw.get("vlan_id")),
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=NetworkListResponse, dependencies=[_SCOPE_READ])
async def list_network_interfaces(
    node: str = Query(..., description="Proxmox node name"),
    current_user: CurrentUser = Depends(get_current_user),
) -> NetworkListResponse:
    """List bridges + VLAN interfaces of a node, with pending flags (AC-LIST-1/2)."""
    await _assert_network_access(current_user, node)

    try:
        client, auth = await _resolve_read_auth(current_user, node)
    except HTTPException as exc:
        logger.warning("networks: auth resolution for node '%s' failed: %s", node, exc.detail)
        return NetworkListResponse(node_unreachable=True, detail=str(exc.detail) if exc.detail else None)
    except Exception as exc:
        logger.warning("networks: auth resolution for node '%s' failed: %r", node, exc)
        return NetworkListResponse(node_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    try:
        raw = await client.get_node_network_interfaces(auth, node)
        # MVP scope: only bridges + VLANs are manageable. Be lenient about the
        # PVE-reported type (it drifts across versions and OVS) so real bridges
        # never silently disappear — mirror get_node_bridges' name/type heuristic.
        interfaces = [
            _parse_network_iface(r) for r in raw if _is_manageable_iface(r)
        ]
        has_pending = any(i.pending for i in interfaces)
        return NetworkListResponse(interfaces=interfaces, has_pending=has_pending)
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code == 403:
            return NetworkListResponse(permission_denied=True)
        logger.warning("networks: Proxmox API responded HTTP %s for node '%s'", code, node)
        return NetworkListResponse(node_unreachable=True, detail=f"Proxmox antwortete mit HTTP {code}")
    except httpx.RequestError as exc:
        logger.warning("networks: connection to node '%s' failed: %r", node, exc)
        return NetworkListResponse(node_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        logger.warning("networks: processing response for node '%s' failed: %r", node, exc, exc_info=True)
        return NetworkListResponse(
            node_unreachable=True,
            detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}: {exc}",
        )


@router.get("/devices", response_model=list[str], dependencies=[_SCOPE_READ])
async def list_network_devices(
    node: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[str]:
    """Available raw devices / ports for the form dropdowns (all interfaces). Best-effort."""
    await _assert_network_access(current_user, node)
    try:
        client, auth = await _resolve_read_auth(current_user, node)
        raw = await client.get_node_network_interfaces(auth, node)
        names = [str(r.get("iface")) for r in raw if r.get("iface")]
        return sorted(set(names))
    except Exception as exc:
        logger.warning("networks/devices: node '%s' failed: %r", node, exc)
        return []


@router.post("", status_code=status.HTTP_201_CREATED, response_model=NetworkWriteResponse, dependencies=[_SCOPE_WRITE])
async def create_network_iface(
    body: NetworkIfaceWriteRequest,
    node: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> NetworkWriteResponse:
    """Create a bridge or VLAN interface (staged as pending, AC-CB-4/AC-CV-2)."""
    await _assert_network_access(current_user, node)
    client, auth = await _resolve_write_auth(current_user, node)

    # Pre-check name collision → clean 409 (AC-CB-3). Proxmox's own duplicate error
    # is opaque/version-dependent, so we detect it deterministically here. Best-effort:
    # if the existence check itself fails we fall through and let Proxmox reject it.
    try:
        existing = await client.get_node_network_interfaces(auth, node)
        if any(isinstance(r, dict) and str(r.get("iface")) == body.iface for r in existing):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Interface '{body.iface}' existiert bereits auf Node '{node}'",
            )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("networks create: collision pre-check failed for node '%s': %r", node, exc)

    params = body.to_proxmox_params()
    params["iface"] = body.iface
    try:
        await client.create_network_iface(auth, node, params)
        await write_audit_log(
            event_type="network_iface_created",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"node={node} iface={body.iface} type={body.type}",
        )
        return NetworkWriteResponse(iface=body.iface, warnings=body.soft_warnings())
    except httpx.HTTPStatusError as exc:
        raise _network_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/{iface}", response_model=NetworkWriteResponse, dependencies=[_SCOPE_WRITE])
async def update_network_iface(
    iface: str = Path(...),
    body: NetworkIfaceWriteRequest = ...,  # noqa: B008
    node: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> NetworkWriteResponse:
    """Fully edit an interface (staged as pending, AC-UP-1/2)."""
    await _assert_network_access(current_user, node)
    client, auth = await _resolve_write_auth(current_user, node)
    params = body.to_proxmox_params()
    try:
        await client.update_network_iface(auth, node, iface, params)
        await write_audit_log(
            event_type="network_iface_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"node={node} iface={iface} type={body.type}",
        )
        return NetworkWriteResponse(iface=iface, warnings=body.soft_warnings())
    except httpx.HTTPStatusError as exc:
        raise _network_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/{iface}/usage", response_model=NetworkUsageResponse, dependencies=[_SCOPE_READ])
async def check_network_iface_usage(
    iface: str = Path(...),
    node: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> NetworkUsageResponse:
    """Find VMs/LXC on this node that reference the bridge (AC-DEL-1). Best-effort fan-out."""
    await _assert_network_access(current_user, node)
    try:
        client, auth = await _resolve_read_auth(current_user, node)
    except Exception as exc:
        logger.warning("networks usage: auth for node '%s' failed: %r", node, exc)
        return NetworkUsageResponse(iface=iface, incomplete=True)

    usages, incomplete = await _find_bridge_usage(client, auth, node, iface)
    return NetworkUsageResponse(
        iface=iface,
        in_use=bool(usages),
        usages=usages,
        incomplete=incomplete,
    )


@router.delete("/{iface}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_network_iface(
    iface: str = Path(...),
    node: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Mark an interface for removal (staged as pending, AC-DEL-3).

    Usage warning is the frontend's responsibility via GET /{iface}/usage; here we
    just stage the deletion (the user has already confirmed despite any warning)."""
    await _assert_network_access(current_user, node)
    client, auth = await _resolve_write_auth(current_user, node)
    try:
        await client.delete_network_iface(auth, node, iface)
        await write_audit_log(
            event_type="network_iface_deleted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"node={node} iface={iface}",
        )
    except httpx.HTTPStatusError as exc:
        raise _network_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/reload", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def reload_network(
    node: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Apply staged changes via node network reload (AC-APPLY-2). May briefly drop connectivity."""
    await _assert_network_access(current_user, node)
    client, auth = await _resolve_write_auth(current_user, node)
    try:
        await client.reload_node_network(auth, node)
        await write_audit_log(
            event_type="network_reloaded",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"node={node}",
        )
    except httpx.HTTPStatusError as exc:
        raise _network_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/revert", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def revert_network(
    node: str = Query(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> None:
    """Discard all staged changes (AC-APPLY-3)."""
    await _assert_network_access(current_user, node)
    client, auth = await _resolve_write_auth(current_user, node)
    try:
        await client.revert_node_network(auth, node)
        await write_audit_log(
            event_type="network_reverted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"node={node}",
        )
    except httpx.HTTPStatusError as exc:
        raise _network_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _find_bridge_usage(
    client, auth, node: str, iface: str
) -> tuple[list[NetworkUsageEntry], bool]:
    """Node-filtered fan-out: which guests on *node* reference bridge *iface*? (Tech Design A.3).

    Bridges are node-local, so we only inspect guests hosted on the target node.
    Returns (usages, incomplete) — incomplete=True if any config could not be read."""
    try:
        vms = await client.get_cluster_resources_v2(auth, "vm")
    except Exception as exc:
        logger.warning("bridge usage: cluster resources for node '%s' failed: %r", node, exc)
        return [], True

    targets = [r for r in vms if r.get("node") == node and r.get("vmid")]
    if not targets:
        return [], False

    sem = asyncio.Semaphore(10)
    incomplete = False

    async def _check(r: dict):
        nonlocal incomplete
        vmid = _i(r.get("vmid"))
        if vmid is None:
            return None
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
                    if k.strip() == "bridge" and v.strip() == iface:
                        return NetworkUsageEntry(
                            vmid=vmid,
                            name=str(r.get("name") or vmid),
                            node=node,
                            kind=kind,
                        )
        return None

    results = await asyncio.gather(*[_check(r) for r in targets], return_exceptions=True)
    usages = [x for x in results if isinstance(x, NetworkUsageEntry)]
    return usages, incomplete
