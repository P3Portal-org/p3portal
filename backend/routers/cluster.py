# p3portal.org
from __future__ import annotations

import asyncio
import logging
import re

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel

from typing import Annotated

from fastapi import Path

from backend.core.deps import CurrentUser, get_current_user, require_operator, require_not_restricted, require_admin
from backend.features.api_surface.deps import require_scope_for_upk
from backend.core.plus_protocol import plus_behavior
from backend.services.cluster_cache_service import cluster_cache
from backend.services.config_service import get_proxmox_node
from backend.services import alert_check_service as _alert_check
from backend.models.cluster import ClusterStatusResponse, NodeInfo, VmInfo
from backend.models.vms import (
    BackupCreateRequest,
    BackupDeleteRequest,
    BackupFile,
    BackupSchedule,
    DiskConfig,
    FilesystemInfo,
    GuestInfoResponse,
    LxcNetworkInterface,
    NetworkInterface,
    VmBackupsResponse,
    VmDetailResponse,
    VmTaskResponse,
)
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient, proxmox_client
from backend.services.service_accounts import _extract_token
from backend.services.rbac_service import get_user_permissions, has_any_assignments, check_permission
from backend.services.local_auth import get_user_by_username
from backend.services.settings_service import get_setting

router = APIRouter(prefix="/api/cluster", tags=["cluster"])
logger = logging.getLogger(__name__)


# ── PROJ-38: LXC Template request schemas ────────────────────────────────────

class LxcTemplateDownloadRequest(BaseModel):
    node: str
    template: str
    storage: str


class LxcTemplateDeleteRequest(BaseModel):
    node: str
    storage: str
    volid: str


_VALID_TEMPLATE_FILENAME = re.compile(r'^[a-zA-Z0-9._-]+\.(tar\.gz|tar\.zst)$')
_MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024  # 4 GB


async def _alert_vms_callback(node_id: int, _endpoint: str, data: list) -> None:
    """PROJ-34: Bridge between ClusterCacheService on_fresh_data and alert_check_service."""
    try:
        await _alert_check.check_node(node_id, data or [])
    except Exception:
        pass  # Alert checks must never break the cache response path
    # PROJ-48: Owner-Reconcile nach erfolgreichem Node-Refresh
    try:
        from backend.features.owners.cleanup import reconcile_for_node
        await reconcile_for_node(node_id, data or [])
    except Exception:
        pass
    # PROJ-74: Config-Snapshots orphan-markieren für verschwundene VMs
    try:
        still_visible: set[tuple[int, str, str]] = {
            (int(r.get("vmid", -1)), str(r.get("node", "")), str(r.get("type", "qemu")))
            for r in (data or [])
            if r.get("vmid") is not None
        }
        await plus_behavior.on_cluster_refresh_vanished_resources_config_snapshots(
            still_visible, node_id
        )
    except Exception:
        pass
    # PROJ-83: persistierten Ansible-Host-Zustand für verschwundene VMs/LXC bereinigen
    try:
        from backend.features.ansible_inventory import host_state as _ah
        still_visible_kinds: set[tuple[int, str]] = {
            (int(r.get("vmid", -1)), str(r.get("type", "qemu")))
            for r in (data or [])
            if r.get("vmid") is not None
        }
        await _ah.delete_vanished(node_id, still_visible_kinds)
    except Exception:
        pass
    # PROJ-96: VM-Abhängigkeits-Kanten verschwundener VMs als „verwaist" markieren.
    # Nur nach erfolgreichem Refresh (on_fresh_data) → eine offline-Installation
    # verwaist nichts fälschlich (EC-6).
    try:
        still_visible_vmids: set[int] = {
            int(r.get("vmid", -1))
            for r in (data or [])
            if r.get("vmid") is not None
        }
        await plus_behavior.on_cluster_refresh_vanished_resources_dependencies(
            still_visible_vmids, node_id
        )
    except Exception:
        pass


def _cluster_http_exc(exc: httpx.HTTPStatusError, auth: ProxmoxAuth) -> HTTPException:
    """Map Proxmox HTTP errors to appropriate FastAPI exceptions.

    When using a service-account token (local users), 401/403 from Proxmox
    means the token is invalid/deleted – that's a backend config issue, not a
    user-session issue.  Returning 401 would trigger an automatic frontend
    logout, which is wrong.  Map to 502 instead so the user stays logged in.

    When using the user's own Proxmox cookie (Proxmox-auth users), 401 means
    their Proxmox ticket expired → pass it through so the frontend redirects
    to the login page.
    """
    code = exc.response.status_code
    if auth.kind == "token" and code in (401, 403):
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox auth error – service account token may be invalid or deleted",
        )
    return HTTPException(status_code=code, detail="Proxmox API error")


async def _get_cluster_auth(current_user: CurrentUser) -> ProxmoxAuth:
    """Resolve ProxmoxAuth for cluster dashboard reads.

    Proxmox-login users: use their session cookie.
    Local users: use the viewer token from the default Portal node.
    """
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab to access cluster data",
            )
        return ProxmoxAuth(kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""))
    else:
        from backend.services.nodes_service import get_default_node
        node = await get_default_node()
        token = _extract_token(node, "viewer") if node else None
        if not token:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Viewer service account not configured – contact your administrator",
            )
        return ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)


def _build_portal_client(node) -> tuple[ProxmoxClient, ProxmoxAuth]:
    """Create a per-node ProxmoxClient + viewer ProxmoxAuth from a NodeRow."""
    client = ProxmoxClient(base_url=node.url, verify_ssl=node.verify_ssl)
    token = _extract_token(node, "viewer")
    if not token:
        raise ValueError(f"No viewer token configured for portal node '{node.name}'")
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


async def _get_all_portal_clients(
    current_user: CurrentUser,
) -> list[tuple[object, ProxmoxClient, ProxmoxAuth]]:
    """Return (NodeRow, client, auth) for every relevant portal node.

    Plus-Edition + local users: all registered portal nodes in parallel.
    All other cases should not call this function (use _get_cluster_auth instead).
    """
    from backend.services.nodes_service import list_nodes
    all_nodes = await list_nodes()
    if not all_nodes:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox nodes configured",
        )
    result = []
    for node in all_nodes:
        token = _extract_token(node, "viewer")
        if not token:
            continue
        client = ProxmoxClient(base_url=node.url, verify_ssl=node.verify_ssl)
        auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
        result.append((node, client, auth))
    if not result:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Viewer service account not configured – contact your administrator",
        )
    return result


async def _filter_nodes_for_rbac_user(user_id: int, nodes: list[NodeInfo]) -> list[NodeInfo]:
    """Return only nodes where the viewer has at least one RBAC assignment.

    Protects against information disclosure: a viewer without assignments on a
    node should not know that node exists. Falls back to the full list when the
    user has no portal_node_id-specific assignments (NULL assignments match any
    node, so every node is relevant in that case).
    """
    perms = await get_user_permissions(user_id)
    assigned_node_ids = {p["portal_node_id"] for p in perms if p.get("portal_node_id") is not None}
    if not assigned_node_ids:
        # Only null-scoped assignments → every node could host assigned resources
        return nodes
    return [n for n in nodes if n.portal_node_id in assigned_node_ids]


async def fetch_nodes(
    current_user: CurrentUser,
    force: bool = False,
    raise_on_empty: bool = True,
) -> list[NodeInfo]:
    """Single-source node fan-out (PROJ-30/33) reused by the dashboard *and*
    PROJ-75 topology. Set ``raise_on_empty=False`` to get best-effort behaviour
    (return whatever installations are reachable, no 502) for the topology view.
    """
    plus = plus_behavior.can_use_multi_node_dashboard()

    # PROJ-30 + PROJ-33: Plus + local → fan-out with per-node cache
    if plus and current_user.auth_type != "proxmox":
        if force:
            cluster_cache.invalidate_all()
        portal_clients = await _get_all_portal_clients(current_user)
        results = await asyncio.gather(
            *[cluster_cache.get_or_fetch(
                node_id=nr.id,
                endpoint="nodes",
                ttl=nr.poll_interval,
                fetch_fn=lambda _c=c, _a=a: _c.get_nodes_with_swap(_a),
            ) for nr, c, a in portal_clients],
            return_exceptions=True,
        )
        nodes: list[NodeInfo] = []
        for (node_row, _, _), res in zip(portal_clients, results):
            if isinstance(res, Exception):
                continue
            duration_ms = cluster_cache.get_duration_ms(node_row.id, "nodes")
            for r in res:
                info = NodeInfo.model_validate(r)
                info.portal_node_name = node_row.name
                info.portal_node_id = node_row.id
                info.response_time_ms = duration_ms
                nodes.append(info)
        if not nodes and raise_on_empty:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not reach any Proxmox installation",
            )
        # PROJ-12: viewer-only sees nodes they have RBAC assignments on
        if current_user.auth_type == "local" and current_user.role == "viewer":
            nodes = await _filter_nodes_for_rbac_user(current_user.user_id, nodes)
        return nodes

    # PROJ-33: Basis + local → single default node with cache
    if current_user.auth_type == "local":
        from backend.services.nodes_service import get_default_node
        default_node = await get_default_node()
        auth = await _get_cluster_auth(current_user)
        poll_interval = default_node.poll_interval if default_node else 30
        node_cache_id = default_node.id if default_node else -1
        core_client = ProxmoxClient(base_url=default_node.url, verify_ssl=default_node.verify_ssl) if default_node else proxmox_client

        async def _fetch_core_nodes():
            return await core_client.get_nodes_with_swap(auth)

        try:
            raw = await cluster_cache.get_or_fetch(
                node_id=node_cache_id,
                endpoint="nodes",
                ttl=poll_interval,
                fetch_fn=_fetch_core_nodes,
                force=force,
            )
        except httpx.HTTPStatusError as exc:
            raise _cluster_http_exc(exc, auth)
        except httpx.RequestError:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
        duration_ms = cluster_cache.get_duration_ms(node_cache_id, "nodes")
        result = [NodeInfo.model_validate(r) for r in raw]
        for info in result:
            info.response_time_ms = duration_ms
            if default_node:
                info.portal_node_id = default_node.id
        # PROJ-12: viewer-only sees nodes they have RBAC assignments on
        if current_user.role == "viewer":
            result = await _filter_nodes_for_rbac_user(current_user.user_id, result)
        return result

    # Proxmox-login → no cache, direct call
    auth = await _get_cluster_auth(current_user)
    try:
        raw = await proxmox_client.get_nodes_with_swap(auth)
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return [NodeInfo.model_validate(r) for r in raw]


@router.get("/nodes", response_model=list[NodeInfo])
async def get_nodes(
    force: bool = False,
    current_user: CurrentUser = Depends(require_not_restricted),
    _scope: CurrentUser = Depends(require_scope_for_upk("cluster:read")),
) -> list[NodeInfo]:
    return await fetch_nodes(current_user, force=force)


async def _collect_vm_resources(
    current_user: CurrentUser,
    force: bool = False,
    raise_on_empty: bool = True,
) -> tuple[list[VmInfo], dict[int, tuple[ProxmoxClient, ProxmoxAuth]]]:
    """Fan-out raw VM/LXC resources (PROJ-30/33) → (vms, vm_client_map).

    ``vm_client_map`` maps ``id(vm)`` → (client, auth) for follow-up per-VM
    lookups (IP / ctime). Shared by the dashboard and PROJ-75 topology.
    """
    plus = plus_behavior.can_use_multi_node_dashboard()

    # vm_client_map: id(vm) → (client, auth) for per-VM IP/ctime lookups
    vm_client_map: dict[int, tuple[ProxmoxClient, ProxmoxAuth]] = {}
    vms: list[VmInfo] = []

    # PROJ-30 + PROJ-33: Plus + local → fan-out with per-node cache
    if plus and current_user.auth_type != "proxmox":
        if force:
            cluster_cache.invalidate_all()
        portal_clients = await _get_all_portal_clients(current_user)
        cached_results = await asyncio.gather(
            *[cluster_cache.get_or_fetch(
                node_id=nr.id,
                endpoint="vms",
                ttl=nr.poll_interval,
                fetch_fn=lambda _c=c, _a=a: _c.get_cluster_resources_v2(_a, "vm"),
                on_fresh_data=_alert_vms_callback,
            ) for nr, c, a in portal_clients],
            return_exceptions=True,
        )
        for (node_row, node_client, node_auth), res in zip(portal_clients, cached_results):
            if isinstance(res, Exception):
                continue
            for r in res:
                vm = VmInfo.model_validate(r)
                vm.portal_node_name = node_row.name
                vm.portal_node_id = node_row.id
                vms.append(vm)
                vm_client_map[id(vm)] = (node_client, node_auth)
        if not vms and raise_on_empty:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not reach any Proxmox installation",
            )

    # PROJ-33: Basis + local → single default node with cache
    elif current_user.auth_type == "local":
        from backend.services.nodes_service import get_default_node
        default_node = await get_default_node()
        auth = await _get_cluster_auth(current_user)
        poll_interval = default_node.poll_interval if default_node else 30
        node_cache_id = default_node.id if default_node else -1
        core_client = ProxmoxClient(base_url=default_node.url, verify_ssl=default_node.verify_ssl) if default_node else proxmox_client

        try:
            raw = await cluster_cache.get_or_fetch(
                node_id=node_cache_id,
                endpoint="vms",
                ttl=poll_interval,
                fetch_fn=lambda: core_client.get_cluster_resources_v2(auth, "vm"),
                force=force,
                on_fresh_data=_alert_vms_callback,
            )
        except httpx.HTTPStatusError as exc:
            raise _cluster_http_exc(exc, auth)
        except httpx.RequestError:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
        vms = [VmInfo.model_validate(r) for r in raw]
        for vm in vms:
            if default_node:
                vm.portal_node_id = default_node.id
            vm_client_map[id(vm)] = (core_client, auth)

    else:
        # Proxmox-login → no cache, direct call
        auth = await _get_cluster_auth(current_user)
        try:
            if plus:
                raw = await proxmox_client.get_cluster_resources_v2(auth, "vm")
            else:
                raw = await proxmox_client.get_cluster_resources_v2(auth, "vm")
        except httpx.HTTPStatusError as exc:
            raise _cluster_http_exc(exc, auth)
        except httpx.RequestError:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
        vms = [VmInfo.model_validate(r) for r in raw]
        for vm in vms:
            vm_client_map[id(vm)] = (proxmox_client, auth)

    return vms, vm_client_map


async def _lookup_vm_ips(
    vms: list[VmInfo], vm_client_map: dict[int, tuple[ProxmoxClient, ProxmoxAuth]]
) -> None:
    """Enrich running VMs/LXCs with their first non-loopback IPv4 (in-place)."""
    running = [vm for vm in vms if vm.status == "running"]
    if not running:
        return
    ip_results = await asyncio.gather(
        *[vm_client_map[id(vm)][0].get_vm_ip(
            vm_client_map[id(vm)][1], vm.node, vm.vmid, vm.type,
        ) for vm in running],
        return_exceptions=True,
    )
    for vm, result in zip(running, ip_results):
        if isinstance(result, str):
            vm.ip = result


async def _lookup_template_ctimes(
    vms: list[VmInfo], vm_client_map: dict[int, tuple[ProxmoxClient, ProxmoxAuth]]
) -> None:
    """Enrich template VMs with their creation ctime (in-place)."""
    templates = [vm for vm in vms if vm.template == 1]
    if not templates:
        return
    ctime_results = await asyncio.gather(
        *[vm_client_map[id(vm)][0].get_vm_ctime(
            vm_client_map[id(vm)][1], vm.node, vm.vmid, vm.type,
        ) for vm in templates],
        return_exceptions=True,
    )
    for vm, result in zip(templates, ctime_results):
        if isinstance(result, int):
            vm.ctime = result


async def apply_vm_rbac_filter(
    current_user: CurrentUser, vms: list[VmInfo]
) -> list[VmInfo]:
    """Single-source RBAC filter (PROJ-12) reused by the dashboard *and*
    PROJ-75 topology — guarantees no divergence (AC-RBAC-4).

    - admin / operator / proxmox auth: full list
    - restricted role: empty (no assignments → sees nothing)
    - viewer/operator with assignments: only assigned VMs (sets ``permissions``)
    - viewer/operator without assignments: full list (backwards compat)
    """
    if current_user.auth_type == "local" and current_user.role not in ("admin", "operator"):
        user = await get_user_by_username(current_user.username)
        if user is not None:
            has_assignments = await has_any_assignments(user["id"])
            if has_assignments or current_user.role == "restricted":
                if not has_assignments:
                    return []  # restricted with no assignments sees nothing
                user_perms = await get_user_permissions(user["id"])
                perm_map = {
                    (p["resource_type"], p["resource_id"]): p["permissions"]
                    for p in user_perms
                }
                filtered = []
                for vm in vms:
                    res_type = "lxc" if vm.type == "lxc" else "vm"
                    perms = perm_map.get((res_type, vm.vmid))
                    if perms is not None and "view" in perms:
                        vm.permissions = perms
                        filtered.append(vm)
                return filtered

    return vms


async def fetch_visible_vm_resources(
    current_user: CurrentUser,
    force: bool = False,
    with_ip: bool = False,
) -> list[VmInfo]:
    """RBAC-filtered VM/LXC resources for the current user — single-source for
    the dashboard *and* PROJ-75 topology.

    ``with_ip=False`` (topology default) skips the N per-VM IP calls; the
    topology resource-bars come from cluster/resources (cpu/mem/disk) and IPs
    are loaded on-demand in the detail panel. ``raise_on_empty=False`` makes the
    fan-out best-effort (no 502 when an installation has 0 guests / is offline).
    """
    vms, vm_client_map = await _collect_vm_resources(
        current_user, force=force, raise_on_empty=False
    )
    if with_ip:
        await _lookup_vm_ips(vms, vm_client_map)
    return await apply_vm_rbac_filter(current_user, vms)


@router.get("/vms", response_model=list[VmInfo])
async def get_vms(
    force: bool = False,
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("cluster:read")),
) -> list[VmInfo]:
    vms, vm_client_map = await _collect_vm_resources(current_user, force=force)
    await _lookup_vm_ips(vms, vm_client_map)
    await _lookup_template_ctimes(vms, vm_client_map)
    return await apply_vm_rbac_filter(current_user, vms)


@router.get("/cache-stats")
async def get_cache_stats(
    _: CurrentUser = Depends(require_admin),
) -> list[dict]:
    """Return per-(node_id, endpoint) cache stats for the admin nodes view."""
    return cluster_cache.get_all_stats()


@router.get("/templates")
async def get_templates(current_user: CurrentUser = Depends(get_current_user)) -> list[dict]:
    """Return all Proxmox VM templates (vmid, name, node) for use in playbook dropdowns."""
    plus = plus_behavior.can_use_multi_node_dashboard()

    # PROJ-30: Plus-Edition + local users → fan-out across all portal nodes
    if plus and current_user.auth_type != "proxmox":
        portal_clients = await _get_all_portal_clients(current_user)
        results = await asyncio.gather(
            *[c.get_cluster_resources_v2(a, "vm") for _, c, a in portal_clients],
            return_exceptions=True,
        )
        templates = []
        for _, res in zip(portal_clients, results):
            if isinstance(res, Exception):
                continue
            for r in res:
                if r.get("template") == 1:
                    templates.append({
                        "vmid": int(r["vmid"]),
                        "name": r.get("name", str(r["vmid"])),
                        "node": r.get("node", ""),
                    })
        return templates

    # Core-Edition or Proxmox-login: cluster-wide call (covers single-node and clustered Proxmox)
    auth = await _get_cluster_auth(current_user)
    if current_user.auth_type == "local":
        from backend.services.nodes_service import get_default_node
        _default_node = await get_default_node()
        core_client = ProxmoxClient(base_url=_default_node.url, verify_ssl=_default_node.verify_ssl) if _default_node else proxmox_client
    else:
        core_client = proxmox_client
    try:
        raw = await core_client.get_cluster_resources_v2(auth, "vm")
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    return [
        {"vmid": int(r["vmid"]), "name": r.get("name", str(r["vmid"])), "node": r.get("node", "")}
        for r in raw
        if r.get("template") == 1
    ]


@router.get("/next-vmid")
async def get_next_playbook_vmid(current_user: CurrentUser = Depends(require_operator)) -> dict:
    """Return the next free VM ID in the configured playbook range."""
    min_id = int(await get_setting("playbook_vmid_min") or "100")
    max_id = int(await get_setting("playbook_vmid_max") or "999999")
    auth = await _get_cluster_auth(current_user)
    if current_user.auth_type == "local":
        from backend.services.nodes_service import get_default_node
        _vmid_node = await get_default_node()
        _vmid_client = ProxmoxClient(base_url=_vmid_node.url, verify_ssl=_vmid_node.verify_ssl) if _vmid_node else proxmox_client
    else:
        _vmid_client = proxmox_client
    try:
        vmid = await _vmid_client.get_next_vmid(auth, min_id, max_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")
    return {"vmid": vmid, "min": min_id, "max": max_id}


@router.get("/status", response_model=ClusterStatusResponse)
async def get_cluster_status(
    force: bool = False,
    current_user: CurrentUser = Depends(require_not_restricted),
    _scope: CurrentUser = Depends(require_scope_for_upk("cluster:read")),
) -> ClusterStatusResponse:
    plus = plus_behavior.can_use_multi_node_dashboard()

    # PROJ-30 + PROJ-33: Plus + local → fan-out with per-node cache
    if plus and current_user.auth_type != "proxmox":
        if force:
            cluster_cache.invalidate_all()
        portal_clients = await _get_all_portal_clients(current_user)

        async def _make_status_fetch(client: ProxmoxClient, auth: ProxmoxAuth):
            async def _fetch():
                entries = await client.get_cluster_status_v2(auth)
                ha = await client.get_ha_status_v2(auth)
                return {"entries": entries, "ha": ha}
            return _fetch

        cached_results = await asyncio.gather(
            *[cluster_cache.get_or_fetch(
                node_id=nr.id,
                endpoint="status",
                ttl=nr.poll_interval,
                fetch_fn=await _make_status_fetch(c, a),
            ) for nr, c, a in portal_clients],
            return_exceptions=True,
        )

        total_nodes = 0
        all_quorate = True
        ha_statuses: list[str] = []
        unreachable: list[str] = []
        for (node_row, _, _), res in zip(portal_clients, cached_results):
            if isinstance(res, Exception):
                unreachable.append(node_row.name)
                all_quorate = False
                continue
            entries = res["entries"]
            ha = res["ha"]
            cluster_entry = next((e for e in entries if e.get("type") == "cluster"), {})
            total_nodes += int(cluster_entry.get("nodes", 0))
            if not bool(cluster_entry.get("quorate", 0)):
                all_quorate = False
            ha_statuses.append(ha)

        if total_nodes == 0 and unreachable and not ha_statuses:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Could not reach any Proxmox installation",
            )

        ha_status = "active" if "active" in ha_statuses else (ha_statuses[0] if ha_statuses else "none")
        return ClusterStatusResponse(
            quorum=all_quorate,
            node_count=total_nodes,
            ha_status=ha_status,
            unreachable_nodes=unreachable,
        )

    # PROJ-33: Basis + local → single default node with cache
    if current_user.auth_type == "local":
        from backend.services.nodes_service import get_default_node
        default_node = await get_default_node()
        auth = await _get_cluster_auth(current_user)
        poll_interval = default_node.poll_interval if default_node else 30
        node_cache_id = default_node.id if default_node else -1
        core_client = ProxmoxClient(base_url=default_node.url, verify_ssl=default_node.verify_ssl) if default_node else proxmox_client

        async def _fetch_core_status():
            entries = await core_client.get_cluster_status_v2(auth)
            ha = await core_client.get_ha_status_v2(auth)
            cluster_entry = next((e for e in entries if e.get("type") == "cluster"), None)
            if cluster_entry:
                return {
                    "node_count": int(cluster_entry.get("nodes", 0)),
                    "quorate": bool(cluster_entry.get("quorate", 0)),
                    "ha": ha,
                }
            node_entries = [e for e in entries if e.get("type") == "node"]
            return {
                "node_count": len(node_entries),
                "quorate": any(e.get("online", 0) == 1 for e in node_entries),
                "ha": ha,
            }

        try:
            cached = await cluster_cache.get_or_fetch(
                node_id=node_cache_id,
                endpoint="status",
                ttl=poll_interval,
                fetch_fn=_fetch_core_status,
                force=force,
            )
        except httpx.HTTPStatusError as exc:
            raise _cluster_http_exc(exc, auth)
        except httpx.RequestError:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
        return ClusterStatusResponse(
            quorum=cached["quorate"],
            node_count=cached["node_count"],
            ha_status=cached["ha"],
        )

    # Proxmox-login → no cache, direct call
    auth = await _get_cluster_auth(current_user)
    try:
        entries = await proxmox_client.get_cluster_status_v2(auth)
        ha_status = await proxmox_client.get_ha_status_v2(auth)
        cluster_entry = next((e for e in entries if e.get("type") == "cluster"), None)
        if cluster_entry:
            return ClusterStatusResponse(
                quorum=bool(cluster_entry.get("quorate", 0)),
                node_count=int(cluster_entry.get("nodes", 0)),
                ha_status=ha_status,
            )
        node_entries = [e for e in entries if e.get("type") == "node"]
        return ClusterStatusResponse(
            quorum=any(e.get("online", 0) == 1 for e in node_entries),
            node_count=len(node_entries),
            ha_status=ha_status,
        )
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM Detail Page helpers (PROJ-29) ──────────────────────────────────────────

async def _get_write_auth(current_user: CurrentUser) -> ProxmoxAuth:
    """Resolve operator-level ProxmoxAuth for backup create/delete operations."""
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        return ProxmoxAuth(kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""))
    from backend.services.nodes_service import get_default_node
    node = await get_default_node()
    token = _extract_token(node, current_user.role) if node else None
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{current_user.role.capitalize()} service account not configured",
        )
    return ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)


async def _get_portal_node_write_auth(
    current_user: CurrentUser,
    proxmox_node: str,
    role: str,
) -> tuple[ProxmoxClient, ProxmoxAuth]:
    """Resolve write-level auth for a specific Proxmox node.

    For proxmox-login users their session cookie is valid across the whole cluster.
    For local users we look up which portal node manages the given Proxmox node and
    extract the matching role token (operator / admin).
    """
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        return proxmox_client, ProxmoxAuth(
            kind="cookie",
            value=session["ticket"],
            csrf=session.get("csrf", ""),
        )

    from backend.services.nodes_service import get_node_for_proxmox_name, get_default_node
    node_row = await get_node_for_proxmox_name(proxmox_node)
    if node_row is None:
        node_row = await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured",
        )
    token = _extract_token(node_row, role)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{role.capitalize()} service account not configured for node '{node_row.name}'",
        )
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


async def _check_detail_access(current_user: CurrentUser, vmid: int, vm_type: str) -> None:
    """RBAC guard for VM detail page reads.

    - proxmox auth / admin / operator: always allowed
    - restricted: always blocked
    - viewer without assignments: allowed (consistent with dashboard)
    - viewer with assignments: must have 'view' on this specific VM
    """
    if current_user.auth_type == "proxmox" or current_user.role in ("admin", "operator"):
        return
    if current_user.role == "restricted":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    user = await get_user_by_username(current_user.username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    if not await has_any_assignments(user["id"]):
        return  # viewer without assignments sees everything (consistent with dashboard)
    res_type = "lxc" if vm_type == "lxc" else "vm"
    if not await check_permission(user["id"], vmid, res_type, "view"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Not authorized to view {res_type} {vmid}",
        )


_NIC_MODELS = frozenset([
    "virtio", "e1000", "e1000e", "vmxnet3", "rtl8139",
    "ne2k_pci", "pcnet", "i82551", "i82557b", "i82559er",
])


def _parse_networks(config: dict) -> list[NetworkInterface]:
    networks = []
    for i in range(31):
        val = config.get(f"net{i}")
        if not val:
            continue
        parts: dict[str, str] = {}
        for segment in val.split(","):
            if "=" in segment:
                k, v = segment.split("=", 1)
                parts[k.strip()] = v.strip()
        model, mac = "", ""
        for k, v in parts.items():
            if k in _NIC_MODELS:
                model, mac = k, v
                break
        bridge = parts.get("bridge", "")
        networks.append(NetworkInterface(id=f"net{i}", model=model, bridge=bridge, mac=mac))
    return networks


_QEMU_DISK_PREFIXES = ("scsi", "virtio", "ide", "sata")


def _parse_disks(config: dict, vm_type: str) -> list[DiskConfig]:
    disks = []
    if vm_type == "lxc":
        keys = [k for k in config if k == "rootfs" or (k.startswith("mp") and k[2:].isdigit())]
    else:
        keys = [k for k in config if any(k.startswith(p) for p in _QEMU_DISK_PREFIXES)]
    for key in sorted(keys):
        val = config.get(key, "")
        if not val or val.startswith("none") or ",media=cdrom" in val:
            continue
        first_part = val.split(",")[0]
        storage = first_part.split(":")[0] if ":" in first_part else ""
        size = ""
        serial = None
        for part in val.split(","):
            if part.startswith("size="):
                size = part.split("=", 1)[1]
            elif part.startswith("serial="):
                serial = part.split("=", 1)[1]
        if storage:
            disks.append(DiskConfig(id=key, storage=storage, size=size, serial=serial))
    return disks


def _job_covers_vmid(job: dict, vmid: int) -> bool:
    """Return True if a datacenter backup job covers the given VMID."""
    raw = job.get("vmid", "")
    if not raw or str(raw).strip() == "all":
        return True
    return str(vmid) in [v.strip() for v in str(raw).split(",")]


# ── VM Detail Page endpoints (PROJ-29) ───────────────────────────────────────

@router.get("/vms/{node}/{vm_type}/{vmid}", response_model=VmDetailResponse)
async def get_vm_detail(
    node: str,
    vm_type: Annotated[str, Path(pattern="^(qemu|lxc)$")],
    vmid: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> VmDetailResponse:
    client, auth = await _get_client_auth_for_node(current_user, node)
    await _check_detail_access(current_user, vmid, vm_type)
    try:
        vm_status, vm_config = await asyncio.gather(
            client.get_vm_status_current(auth, node, vmid, vm_type),
            client.get_vm_config(auth, node, vmid, vm_type),
        )
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    is_running = vm_status.get("status") == "running"
    raw_tags = vm_config.get("tags", "") or ""
    tags = [t.strip() for t in raw_tags.replace(";", ",").split(",") if t.strip()]

    ip: str | None = None
    if is_running:
        try:
            ip = await client.get_vm_ip(auth, node, vmid, vm_type)
        except Exception:
            pass

    raw_onboot = vm_config.get("onboot")
    raw_protection = vm_config.get("protection")

    from backend.services.nodes_service import get_node_for_proxmox_name as _get_node_for_name
    portal_node = await _get_node_for_name(node)

    # PROJ-76 Phase 2b: stack-managed badge + serverside mutations-block source.
    managed_by_stack = None
    if portal_node is not None:
        try:
            from backend.core.plus_protocol import plus_behavior as _pb
            managed_by_stack = await _pb.get_stack_for_vm(portal_node.id, vmid)
        except Exception:
            managed_by_stack = None

    return VmDetailResponse(
        vmid=vmid,
        name=vm_status.get("name") or vm_config.get("name", str(vmid)),
        type=vm_type,
        status=vm_status.get("status", "stopped"),
        node=node,
        ip=ip,
        uptime=vm_status.get("uptime", 0),
        tags=tags,
        is_template=bool(vm_config.get("template", 0)),
        cpu_usage=vm_status.get("cpu") if is_running else None,
        cpu_cores=vm_config.get("cores", vm_status.get("cpus", 1)),
        mem_used=vm_status.get("mem") if is_running else None,
        mem_total=vm_status.get("maxmem", 0),
        bios=vm_config.get("bios", "seabios"),
        ostype=vm_config.get("ostype", ""),
        networks=_parse_networks(vm_config),
        disks=_parse_disks(vm_config, vm_type),
        # PROJ-32: extended config fields
        cpu_type=vm_config.get("cpu") or None,
        sockets=vm_config.get("sockets"),
        onboot=bool(raw_onboot) if raw_onboot is not None else None,
        protection=bool(raw_protection) if raw_protection is not None else None,
        description=vm_config.get("description") or None,
        lxc_hostname=vm_config.get("hostname") if vm_type == "lxc" else None,
        lxc_ostemplate=vm_config.get("ostemplate") if vm_type == "lxc" else None,
        # PROJ-48: expose portal node ID for owner endpoints
        portal_node_id=portal_node.id if portal_node else None,
        managed_by_stack=managed_by_stack,
    )


@router.get("/vms/{node}/{vm_type}/{vmid}/backups", response_model=VmBackupsResponse)
async def get_vm_backups(
    node: str,
    vm_type: Annotated[str, Path(pattern="^(qemu|lxc)$")],
    vmid: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> VmBackupsResponse:
    client, auth = await _get_client_auth_for_node(current_user, node)
    await _check_detail_access(current_user, vmid, vm_type)
    try:
        storages = await client.get_node_backup_storages(auth, node)
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    storage_names = [s.get("storage", "") for s in storages if s.get("storage")]
    if storage_names:
        content_results_raw, jobs_raw = await asyncio.gather(
            asyncio.gather(
                *[client.get_storage_contents(auth, node, s) for s in storage_names],
                return_exceptions=True,
            ),
            client.get_datacenter_backup_jobs(auth),
        )
        content_results = content_results_raw
    else:
        jobs_raw = await client.get_datacenter_backup_jobs(auth)
        content_results = []

    backups: list[BackupFile] = []
    for storage_name, result in zip(storage_names, content_results):
        if isinstance(result, Exception):
            continue
        for item in result:
            if item.get("vmid") != vmid:
                continue
            volid = item.get("volid", "")
            filename = volid.split("/")[-1] if "/" in volid else volid.split(":")[-1]
            backups.append(BackupFile(
                volid=volid,
                filename=filename,
                created_at=item.get("ctime"),
                size=item.get("size", 0),
                storage=storage_name,
            ))
    backups.sort(key=lambda b: b.created_at or 0, reverse=True)

    schedules: list[BackupSchedule] = []
    for job in jobs_raw:
        if not _job_covers_vmid(job, vmid):
            continue
        schedules.append(BackupSchedule(
            id=str(job.get("id", "")),
            schedule=str(job.get("schedule", job.get("dow", ""))),
            storage=str(job.get("storage", "")),
            mode=str(job.get("mode", "snapshot")),
            compress=str(job.get("compress", "")),
            enabled=bool(job.get("enabled", 1)),
            comment=str(job.get("comment", "")),
        ))

    return VmBackupsResponse(backups=backups, schedules=schedules, storages=storage_names)


@router.post(
    "/vms/{node}/{vm_type}/{vmid}/backup",
    response_model=VmTaskResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_vm_backup(
    node: str,
    vm_type: Annotated[str, Path(pattern="^(qemu|lxc)$")],
    vmid: int,
    body: BackupCreateRequest,
    current_user: CurrentUser = Depends(require_operator),
) -> VmTaskResponse:
    client, auth = await _get_portal_node_write_auth(current_user, node, "operator")
    try:
        task_id = await client.create_vzdump_backup(
            auth, node, vmid, body.storage, body.mode, body.compress
        )
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return VmTaskResponse(task_id=task_id)


@router.delete("/vms/{node}/{vm_type}/{vmid}/backup", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vm_backup(
    node: str,
    vm_type: Annotated[str, Path(pattern="^(qemu|lxc)$")],
    vmid: int,
    body: BackupDeleteRequest,
    current_user: CurrentUser = Depends(require_operator),
) -> None:
    client, auth = await _get_portal_node_write_auth(current_user, node, "operator")
    try:
        await client.delete_storage_content(auth, node, body.storage, body.volid)
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── PROJ-32: Guest-Info & LXC-Interfaces ─────────────────────────────────────

@router.get("/vms/{node}/qemu/{vmid}/guest-info", response_model=GuestInfoResponse)
async def get_vm_guest_info(
    node: str,
    vmid: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> GuestInfoResponse:
    """Return QEMU Guest Agent info: OS, hostname, timezone, filesystems.

    All four agent calls run in parallel with a 5 s timeout each.
    Individual call failures are silent (field set to null) – the endpoint
    never returns 500 just because the guest agent is not available.
    """
    client, auth = await _get_client_auth_for_node(current_user, node)
    await _check_detail_access(current_user, vmid, "qemu")
    raw = await client.get_guest_info(auth, node, vmid)
    return GuestInfoResponse.model_validate(raw)


@router.get("/vms/{node}/lxc/{vmid}/interfaces", response_model=list[LxcNetworkInterface])
async def get_lxc_interfaces(
    node: str,
    vmid: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[LxcNetworkInterface]:
    """Return all network interfaces (with IPs + MAC) for an LXC container."""
    client, auth = await _get_client_auth_for_node(current_user, node)
    await _check_detail_access(current_user, vmid, "lxc")
    raw_list = await client.get_lxc_interfaces(auth, node, vmid)
    return [LxcNetworkInterface.model_validate(r) for r in raw_list]


# ── PROJ-36: Node-Detail + LXC-Templates ─────────────────────────────────────

@router.get("/nodes/{node}/detail")
async def get_node_detail(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return full metrics for a single node: CPU, RAM, storage pools, network interfaces, version, uptime."""
    node_client, auth = await _get_client_auth_for_node(current_user, node)
    base = node_client._base
    auth_kwargs = node_client._auth_kwargs(auth)

    try:
        async with node_client._client() as client:
            status_resp, storage_resp, network_resp = await asyncio.gather(
                client.get(f"{base}/api2/json/nodes/{node}/status", **auth_kwargs),
                client.get(f"{base}/api2/json/nodes/{node}/storage", **auth_kwargs),
                client.get(f"{base}/api2/json/nodes/{node}/network", **auth_kwargs),
            )
        for r in (status_resp, storage_resp, network_resp):
            r.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    node_status = status_resp.json().get("data", {})
    storages = storage_resp.json().get("data", [])
    networks = network_resp.json().get("data", [])

    return {
        "node": node,
        "status": node_status,
        "storage_pools": [
            {
                "storage": s.get("storage"),
                "type": s.get("type"),
                "used": s.get("used"),
                "avail": s.get("avail"),
                "total": s.get("total"),
                "active": s.get("active"),
                "content": s.get("content"),
            }
            for s in storages
            if s.get("active")
        ],
        "network_interfaces": [
            {
                "iface": n.get("iface"),
                "type": n.get("type"),
                "address": n.get("address"),
                "netmask": n.get("netmask"),
                "gateway": n.get("gateway"),
                "bridge_ports": n.get("bridge_ports"),
                "active": n.get("active"),
            }
            for n in networks
            if n.get("iface")
        ],
    }


@router.get("/lxc-templates")
async def list_lxc_templates(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return available CT templates and installed ones.

    Local users: fan-out across all configured portal nodes (PROJ-38 Multi-Node fix).
    Proxmox-login users: single-node path using the session auth.
    """
    # ── Local users: fan-out across all portal nodes ──────────────────────────
    if current_user.auth_type != "proxmox":
        from backend.services.nodes_service import list_nodes
        all_nodes = await list_nodes()
        if not all_nodes:
            return {"available": [], "installed": [], "failed_nodes": []}

        async def _fetch_node_templates(node_row):
            # admin→operator→viewer: Listen des vztmpl-Storage-Inhalts braucht
            # Datastore.Audit, das der Viewer-Token meist nicht hat → 403 →
            # still leer. Stärkstes verfügbares Read-Token wählen (analog
            # iso_service / Netzwerk-Tab / lxc-template-storages).
            token = (
                _extract_token(node_row, "admin")
                or _extract_token(node_row, "operator")
                or _extract_token(node_row, "viewer")
            )
            if not token:
                raise ValueError(f"no read token for {node_row.name}")
            nc = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
            na = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
            base = nc._base
            auth_kw = nc._auth_kwargs(na)
            pve_node = node_row.proxmox_node
            node_available: list[dict] = []
            node_installed: list[dict] = []
            async with nc._client() as http:
                try:
                    r = await http.get(f"{base}/api2/json/nodes/{pve_node}/aplinfo", **auth_kw)
                    r.raise_for_status()
                    node_available = r.json().get("data", [])
                except Exception:
                    pass
                try:
                    sr = await http.get(f"{base}/api2/json/nodes/{pve_node}/storage", **auth_kw)
                    sr.raise_for_status()
                    storages = [
                        s["storage"] for s in sr.json().get("data", [])
                        if s.get("active") and "vztmpl" in (s.get("content") or "")
                    ]
                    for st in storages:
                        try:
                            cr = await http.get(
                                f"{base}/api2/json/nodes/{pve_node}/storage/{st}/content",
                                params={"content": "vztmpl"},
                                **auth_kw,
                            )
                            cr.raise_for_status()
                            for item in cr.json().get("data", []):
                                item["storage"] = st
                                item["pve_node"] = pve_node
                                item["portal_node_name"] = node_row.name
                                node_installed.append(item)
                        except Exception:
                            pass
                except Exception:
                    pass
            return node_available, node_installed

        results = await asyncio.gather(
            *[_fetch_node_templates(nr) for nr in all_nodes],
            return_exceptions=True,
        )
        available_seen: set[str] = set()
        available: list[dict] = []
        installed: list[dict] = []
        failed_nodes: list[str] = []
        for node_row, result in zip(all_nodes, results):
            if isinstance(result, Exception):
                failed_nodes.append(node_row.name)
                continue
            node_available, node_installed = result
            for tmpl in node_available:
                key = tmpl.get("template", "")
                if key and key not in available_seen:
                    available_seen.add(key)
                    available.append(tmpl)
            installed.extend(node_installed)
        return {"available": available, "installed": installed, "failed_nodes": failed_nodes}

    # ── Proxmox-login: single-node path (existing behaviour) ─────────────────
    auth = await _get_cluster_auth(current_user)
    base = proxmox_client._base
    auth_kwargs = proxmox_client._auth_kwargs(auth)

    try:
        async with proxmox_client._client() as client:
            nodes_resp = await client.get(f"{base}/api2/json/nodes", **auth_kwargs)
        nodes_resp.raise_for_status()
        online_nodes = [n["node"] for n in nodes_resp.json().get("data", []) if n.get("status") == "online"]
    except Exception:
        online_nodes = []

    first_node = online_nodes[0] if online_nodes else get_proxmox_node()

    available_list: list[dict] = []
    installed_list: list[dict] = []

    try:
        async with proxmox_client._client() as client:
            aplinfo_resp = await client.get(f"{base}/api2/json/nodes/{first_node}/aplinfo", **auth_kwargs)
        aplinfo_resp.raise_for_status()
        available_list = aplinfo_resp.json().get("data", [])
    except Exception:
        pass

    try:
        async with proxmox_client._client() as client:
            storage_resp = await client.get(f"{base}/api2/json/nodes/{first_node}/storage", **auth_kwargs)
        storage_resp.raise_for_status()
        storages = [
            s["storage"] for s in storage_resp.json().get("data", [])
            if s.get("active") and "vztmpl" in (s.get("content") or "")
        ]
        for st in storages:
            try:
                async with proxmox_client._client() as client:
                    content_resp = await client.get(
                        f"{base}/api2/json/nodes/{first_node}/storage/{st}/content",
                        params={"content": "vztmpl"},
                        **auth_kwargs,
                    )
                content_resp.raise_for_status()
                for item in content_resp.json().get("data", []):
                    item["storage"] = st
                    item["pve_node"] = first_node
                    installed_list.append(item)
            except Exception:
                pass
    except Exception:
        pass

    return {"available": available_list, "installed": installed_list, "failed_nodes": []}


@router.post("/lxc-templates/download", status_code=status.HTTP_204_NO_CONTENT)
async def download_lxc_template(
    body: LxcTemplateDownloadRequest,
    current_user: CurrentUser = Depends(require_operator),
) -> None:
    """Trigger pveam download of a CT template onto the specified node/storage."""
    nc, na = await _get_portal_node_write_auth(current_user, body.node, "operator")
    try:
        async with nc._client() as client:
            resp = await client.post(
                f"{nc._base}/api2/json/nodes/{body.node}/aplinfo",
                data={"storage": body.storage, "template": body.template},
                **nc._auth_kwargs(na),
            )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, na)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/lxc-templates", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lxc_template(
    body: LxcTemplateDeleteRequest,
    current_user: CurrentUser = Depends(require_admin),
) -> None:
    """Delete a downloaded CT template from Proxmox storage."""
    import urllib.parse
    nc, na = await _get_portal_node_write_auth(current_user, body.node, "admin")
    encoded = urllib.parse.quote(body.volid, safe="")
    try:
        async with nc._client() as client:
            resp = await client.delete(
                f"{nc._base}/api2/json/nodes/{body.node}/storage/{body.storage}/content/{encoded}",
                **nc._auth_kwargs(na),
            )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, na)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/lxc-templates/upload", status_code=status.HTTP_204_NO_CONTENT)
async def upload_lxc_template(
    node: str = Form(...),
    storage: str = Form(...),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_admin),
) -> None:
    """Upload a custom LXC template (.tar.gz / .tar.zst) to a Proxmox node storage."""
    filename = file.filename or ""
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid filename: path traversal not allowed",
        )
    if not _VALID_TEMPLATE_FILENAME.match(filename):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid filename: must end with .tar.gz or .tar.zst and contain only [a-zA-Z0-9._-]",
        )
    content = await file.read()
    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="File too large: maximum 4 GB",
        )
    nc, na = await _get_portal_node_write_auth(current_user, node, "admin")
    auth_kw = nc._auth_kwargs(na)
    try:
        async with nc._client() as http:
            resp = await http.post(
                f"{nc._base}/api2/json/nodes/{node}/storage/{storage}/upload",
                data={"content": "vztmpl", "filename": filename},
                files={"file": (filename, content, "application/octet-stream")},
                timeout=httpx.Timeout(600.0),
                **auth_kw,
            )
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, na)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.get("/portal-nodes")
async def get_portal_nodes(
    current_user: CurrentUser = Depends(require_not_restricted),
) -> list[dict]:
    """Return configured portal node names accessible to the current user.

    Local users: all portal nodes from nodes_service.
    Proxmox-login users: live Proxmox cluster nodes.
    """
    if current_user.auth_type != "proxmox":
        from backend.services.nodes_service import list_nodes
        nodes = await list_nodes()
        return [{"name": n.name, "proxmox_node": n.proxmox_node} for n in nodes]

    auth = await _get_cluster_auth(current_user)
    base = proxmox_client._base
    auth_kwargs = proxmox_client._auth_kwargs(auth)
    try:
        async with proxmox_client._client() as client:
            resp = await client.get(f"{base}/api2/json/nodes", **auth_kwargs)
        resp.raise_for_status()
        return [
            {"name": n["node"], "proxmox_node": n["node"]}
            for n in resp.json().get("data", [])
            if n.get("status") == "online"
        ]
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── PROJ-40: Node Tasks & Backups ────────────────────────────────────────────

async def _get_client_auth_for_node(
    current_user: CurrentUser,
    proxmox_node: str,
) -> tuple[ProxmoxClient, ProxmoxAuth]:
    """Resolve ProxmoxClient + ProxmoxAuth for read operations on a specific Proxmox node.

    For proxmox-login users their session cookie is valid across the whole cluster.
    For local users we look up which portal node manages the given Proxmox node and
    extract the viewer token from it.
    """
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab to access cluster data",
            )
        return proxmox_client, ProxmoxAuth(
            kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""),
        )

    from backend.services.nodes_service import get_node_for_proxmox_name, get_default_node
    node_row = await get_node_for_proxmox_name(proxmox_node)
    if node_row is None:
        node_row = await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured",
        )
    token = _extract_token(node_row, "viewer")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Viewer service account not configured for this node",
        )
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return client, auth


@router.get("/nodes/{node}/vm-options")
async def get_node_vm_options(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Form-helper options for a Proxmox node: bridges, CPU types, used tags.

    Used by the PROJ-76 Stacks form to populate dropdowns. Best-effort: each
    section degrades to an empty list on per-section errors so the form falls
    back to free-text input. Read-only via the node's viewer token.
    """
    # admin→operator→viewer: reading /nodes/{node}/network (bridges) kann je nach
    # Token-Setup mehr Recht brauchen als /status – daher das stärkste verfügbare
    # Read-Token wählen (analog lxc-template-storages / iso_service).
    if current_user.auth_type == "proxmox":
        client, auth = await _get_client_auth_for_node(current_user, node)
    else:
        from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name
        node_row = await get_node_for_proxmox_name(node)
        if node_row is None:
            node_row = await get_default_node()
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

    async def _safe(coro, default, label):
        try:
            return await coro
        except Exception as exc:
            logger.warning("vm-options: %s for node '%s' failed: %s", label, node, exc)
            return default

    bridges, cpu_types, tags, node_status, vnets = await asyncio.gather(
        _safe(client.get_node_bridges(auth, node), [], "bridges"),
        _safe(client.get_node_cpu_types(auth, node), [], "cpu_types"),
        _safe(client.get_used_tags(auth, node), [], "tags"),
        _safe(client.get_node_status(auth, node), {}, "status"),
        # SDN-VNets sind cluster-weit (/cluster/sdn/vnets) und können – wie eine
        # Bridge – im Gast-Netz referenziert werden (net0: bridge=<vnet>). Best-
        # effort: braucht ggf. SDN-Read-Recht, sonst leere Liste → Freitext.
        _safe(client.get_sdn_vnets(auth), [], "vnets"),
    )
    status_data = node_status if isinstance(node_status, dict) else {}
    vnet_names = sorted({
        str(v.get("vnet"))
        for v in (vnets if isinstance(vnets, list) else [])
        if isinstance(v, dict)
        and v.get("vnet")
        and str(v.get("state", "")).lower() != "deleted"
    })
    return {
        "bridges": bridges,
        "vnets": vnet_names,             # PROJ-79/80: auswählbare SDN-VNets
        "cpu_types": cpu_types,
        "tags": tags,
        "maxcpu": status_data.get("maxcpu"),   # physische Kerne des Nodes
        "maxmem": status_data.get("maxmem"),   # RAM des Nodes in Bytes
    }


@router.get("/nodes/{node}/tasks")
async def get_node_tasks(
    node: str = Path(...),
    limit: int = Query(default=50, ge=1, le=500),
    typefilter: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    """Return the latest tasks for a Proxmox node.

    Each entry contains upid, type, user, status, starttime, endtime, duration.
    Used by the Compute Nodes Finetuning tab (PROJ-40).
    Auth: operator+ by default; viewer with node:view_tasks (PROJ-47) allowed.
    """
    if current_user.auth_type != "proxmox" and current_user.role not in ("admin", "operator"):
        _allowed = False
        if current_user.user_id is not None:
            try:
                from backend.services.nodes_service import get_node_for_proxmox_name
                from backend.services.permissions_resolver import resolve_node_action
                portal_node = await get_node_for_proxmox_name(node)
                if portal_node is not None:
                    _allowed = await resolve_node_action(
                        current_user.user_id, portal_node["id"], "node:view_tasks"
                    )
            except Exception:
                pass
        if not _allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="node_view_tasks_not_authorized",
            )
    client, auth = await _get_client_auth_for_node(current_user, node)
    try:
        raw = await client.get_node_tasks(auth, node, limit=limit, typefilter=typefilter)
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    result = []
    for t in raw:
        starttime = t.get("starttime")
        endtime = t.get("endtime")
        duration: int | None = None
        if starttime is not None and endtime is not None:
            duration = max(0, int(endtime) - int(starttime))
        result.append({
            "upid": t.get("upid", ""),
            "type": t.get("type", ""),
            "id": t.get("id", ""),
            "user": t.get("user", ""),
            "status": t.get("status", ""),
            "starttime": starttime,
            "endtime": endtime,
            "duration": duration,
        })
    return result


@router.get("/nodes/{node}/backups")
async def get_node_backups(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[dict]:
    """Return vzdump backup tasks for a Proxmox node.

    Each entry contains upid, vmid, status, starttime, endtime, duration.
    Used by the Compute Nodes Finetuning Backups tab (PROJ-40).
    Auth: operator+ by default; viewer with node:view_backups (PROJ-47) allowed.
    """
    if current_user.auth_type != "proxmox" and current_user.role not in ("admin", "operator"):
        _allowed = False
        if current_user.user_id is not None:
            try:
                from backend.services.nodes_service import get_node_for_proxmox_name
                from backend.services.permissions_resolver import resolve_node_action
                portal_node = await get_node_for_proxmox_name(node)
                if portal_node is not None:
                    _allowed = await resolve_node_action(
                        current_user.user_id, portal_node["id"], "node:view_backups"
                    )
            except Exception:
                pass
        if not _allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="node_view_backups_not_authorized",
            )
    client, auth = await _get_client_auth_for_node(current_user, node)
    try:
        raw = await client.get_node_tasks(auth, node, limit=50, typefilter="vzdump")
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    result = []
    for t in raw:
        starttime = t.get("starttime")
        endtime = t.get("endtime")
        duration: int | None = None
        if starttime is not None and endtime is not None:
            duration = max(0, int(endtime) - int(starttime))
        result.append({
            "upid": t.get("upid", ""),
            "vmid": t.get("id"),
            "status": t.get("status", ""),
            "starttime": starttime,
            "endtime": endtime,
            "duration": duration,
        })
    return result


@router.get("/lxc-template-storages")
async def get_lxc_template_storages(
    node: str = Query(..., description="Portal node name (or Proxmox node for proxmox-login users)"),
    current_user: CurrentUser = Depends(require_operator),
) -> list[str]:
    """Return storage names that support vztmpl content for a portal node."""
    if current_user.auth_type != "proxmox":
        from backend.services.nodes_service import list_nodes
        all_nodes = await list_nodes()
        node_row = next((n for n in all_nodes if n.name == node), None)
        if node_row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Node '{node}' not found")
        token = _extract_token(node_row, "admin") or _extract_token(node_row, "operator") or _extract_token(node_row, "viewer")
        if not token:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No admin/operator/viewer token configured for this node",
            )
        nc = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
        na = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
        auth_kw = nc._auth_kwargs(na)
        pve_node = node_row.proxmox_node
        try:
            async with nc._client() as http:
                sr = await http.get(f"{nc._base}/api2/json/nodes/{pve_node}/storage", **auth_kw)
            sr.raise_for_status()
            return [
                s["storage"] for s in sr.json().get("data", [])
                if s.get("active") and "vztmpl" in (s.get("content") or "")
            ]
        except httpx.HTTPStatusError as exc2:
            raise _cluster_http_exc(exc2, na)
        except httpx.RequestError:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    auth = await _get_cluster_auth(current_user)
    base = proxmox_client._base
    auth_kwargs = proxmox_client._auth_kwargs(auth)
    try:
        async with proxmox_client._client() as client:
            sr = await client.get(f"{base}/api2/json/nodes/{node}/storage", **auth_kwargs)
        sr.raise_for_status()
        return [
            s["storage"] for s in sr.json().get("data", [])
            if s.get("active") and "vztmpl" in (s.get("content") or "")
        ]
    except httpx.HTTPStatusError as exc:
        raise _cluster_http_exc(exc, auth)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
