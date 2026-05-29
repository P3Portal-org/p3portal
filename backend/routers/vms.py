# p3portal.org
from __future__ import annotations

import asyncio
from typing import NoReturn

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.models.vms import (
    ServiceAccountStatusResponse,
    SnapshotCreateRequest,
    SnapshotInfo,
    VmTaskResponse,
)
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient, proxmox_client
from backend.services.service_accounts import _extract_token, get_service_account_status
from backend.services.rbac_service import check_permission, has_any_assignments
from backend.services.local_auth import get_user_by_username

router = APIRouter(prefix="/api", tags=["vms"])


async def _check_rbac(current_user: CurrentUser, vmid: int, vm_type: str, action: str) -> None:
    """Raises 403 if local user lacks the required action on this resource.

    - admin / operator: portal-wide access, always allowed.
    - viewer / restricted: RBAC assignments required; no assignments → blocked.
    """
    if current_user.auth_type == "proxmox" or current_user.role in ("admin", "operator"):
        return
    user = await get_user_by_username(current_user.username)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized",
        )
    if not await has_any_assignments(user["id"]):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Resource assignment required for this action",
        )
    res_type = "lxc" if vm_type == "lxc" else "vm"
    if not await check_permission(user["id"], vmid, res_type, action):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Action '{action}' not permitted on {res_type} {vmid}",
        )


async def _build_auth_for_node(current_user: CurrentUser, node) -> ProxmoxAuth:
    """Build ProxmoxAuth bound to a specific portal node.

    Proxmox-login users: PVE ticket cookie (URL-agnostic, only valid against the
    Proxmox instance they logged in to — see the proxmox-login deprecation note).
    Local users: role-specific API token from this exact node row.
    """
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab",
            )
        return ProxmoxAuth(
            kind="cookie",
            value=session["ticket"],
            csrf=session.get("csrf", ""),
        )
    token = _extract_token(node, current_user.role)
    if current_user.role in ("viewer", "restricted"):
        # RBAC users may have a viewer token but it lacks write permissions.
        # Always prefer operator/admin so the portal's RBAC layer controls access.
        token = _extract_token(node, "operator") or _extract_token(node, "admin") or token
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"{current_user.role.capitalize()} service account not configured"
                f" for node '{node.name}'"
            ),
        )
    return ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)


async def _resolve_vm_access(
    current_user: CurrentUser,
    vmid: int,
    proxmox_node: str | None = None,
) -> tuple[ProxmoxClient, ProxmoxAuth, str, str]:
    """Locate VMID and return (per-node client, auth, proxmox_node, vm_type).

    Resolution strategy:

    1. If ``proxmox_node`` (?node= query) is given, look up that node row and
       confirm the VM exists there. This is the unambiguous path used by the
       frontend whenever the VM listing already knows the node — required for
       Multi-Node setups where VMIDs can collide across standalone Proxmox
       installations.
    2. Otherwise, Plus + local users fan out over all portal nodes; the first
       VMID hit wins. Errors and missing tokens on individual nodes are
       silently skipped so a misconfigured node doesn't break the others.
    3. Core edition or proxmox-login users fall back to the default node and
       its /cluster/resources view (single-cluster assumption).
    """
    from backend.services.nodes_service import (
        get_default_node,
        get_node_for_proxmox_name,
        list_nodes,
    )

    # ── 1) Explicit node from query parameter ────────────────────────────────
    if proxmox_node:
        node_row = await get_node_for_proxmox_name(proxmox_node)
        if node_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Portal node for Proxmox node '{proxmox_node}' not configured",
            )
        auth = await _build_auth_for_node(current_user, node_row)
        client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
        resources = await client.get_cluster_resources_v2(auth, "vm")
        for r in resources:
            if int(r.get("vmid", -1)) == vmid:
                return (
                    client,
                    auth,
                    str(r.get("node") or proxmox_node),
                    str(r.get("type", "qemu")),
                )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"VM {vmid} not found on node '{proxmox_node}'",
        )

    # ── 2) Plus + local: fan-out over all portal nodes ───────────────────────
    from backend.core.plus_protocol import plus_behavior

    if plus_behavior.can_use_cluster_resources() and current_user.auth_type != "proxmox":
        all_nodes = await list_nodes()
        if not all_nodes:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Portal node configured – run the setup wizard",
            )
        for node_row in all_nodes:
            try:
                auth = await _build_auth_for_node(current_user, node_row)
            except HTTPException:
                continue
            client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
            try:
                resources = await client.get_cluster_resources_v2(auth, "vm")
            except Exception:
                continue
            for r in resources:
                if int(r.get("vmid", -1)) == vmid:
                    return (
                        client,
                        auth,
                        str(r.get("node") or node_row.name),
                        str(r.get("type", "qemu")),
                    )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"VM {vmid} not found")

    # ── 3) Core / proxmox-login: default node only ───────────────────────────
    node_row = await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Portal node configured – run the setup wizard",
        )
    auth = await _build_auth_for_node(current_user, node_row)
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    resources = await client.get_cluster_resources_v2(auth, "vm")
    for r in resources:
        if int(r.get("vmid", -1)) == vmid:
            return client, auth, str(r.get("node")), str(r.get("type", "qemu"))
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"VM {vmid} not found")


def _handle_proxmox_error(exc: httpx.HTTPStatusError) -> NoReturn:
    if exc.response.status_code == 403:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied by Proxmox")
    raise HTTPException(status_code=exc.response.status_code, detail="Proxmox API error")


# ── VM Power Operations ───────────────────────────────────────────────────────

@router.post("/vms/{vmid}/start", response_model=VmTaskResponse)
async def vm_start(
    vmid: int,
    node: str | None = Query(default=None, description="Proxmox node hosting the VM (Multi-Node disambiguation)"),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "start")
        task_id = await client.vm_power_action(auth, pve_node, vmid, "start", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/stop", response_model=VmTaskResponse)
async def vm_stop(
    vmid: int,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "stop")
        task_id = await client.vm_power_action(auth, pve_node, vmid, "shutdown", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/reboot", response_model=VmTaskResponse)
async def vm_reboot(
    vmid: int,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "reboot")
        task_id = await client.vm_power_action(auth, pve_node, vmid, "reboot", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Snapshot Management ───────────────────────────────────────────────────────

@router.get("/vms/{vmid}/snapshots", response_model=list[SnapshotInfo])
async def list_snapshots(
    vmid: int,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SnapshotInfo]:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot")
        raw = await client.get_snapshots(auth, pve_node, vmid, vm_type)
        return [SnapshotInfo.model_validate(s) for s in raw if s.get("name") != "current"]
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/snapshots", response_model=VmTaskResponse, status_code=status.HTTP_202_ACCEPTED)
async def create_snapshot(
    vmid: int,
    body: SnapshotCreateRequest,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot")
        task_id = await client.create_snapshot(auth, pve_node, vmid, body.name, body.description, vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 500:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Snapshot with this name already exists")
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/snapshots/{snap_name}/rollback", response_model=VmTaskResponse)
async def rollback_snapshot(
    vmid: int,
    snap_name: str,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot")
        task_id = await client.rollback_snapshot(auth, pve_node, vmid, snap_name, vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vms/{vmid}/snapshots/{snap_name}", response_model=VmTaskResponse)
async def delete_snapshot(
    vmid: int,
    snap_name: str,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot")
        task_id = await client.delete_snapshot(auth, pve_node, vmid, snap_name, vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM Deletion ───────────────────────────────────────────────────────────────

@router.delete("/vms/{vmid}", response_model=VmTaskResponse)
async def delete_vm(
    vmid: int,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(require_admin),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "delete")
        task_id = await client.delete_vm(auth, pve_node, vmid, vm_type)
        # PROJ-64: Pending Approvals für diese VM/LXC canceln (Plus-Protocol-Hook)
        try:
            from backend.core.plus_protocol import plus_behavior
            await plus_behavior.on_vm_lxc_deleted_approval_workflow(pve_node, vmid, current_user.username)
        except Exception:
            pass
        # PROJ-74: Config-Snapshots orphan-markieren (Plus-Protocol-Hook)
        try:
            from backend.core.plus_protocol import plus_behavior as _pb
            from backend.services.nodes_service import get_node_for_proxmox_name as _gnfpn
            _node_row = await _gnfpn(pve_node)
            if _node_row is not None:
                await _pb.on_vm_lxc_deleted_config_snapshots(
                    _node_row.id, pve_node, vmid, vm_type,
                    None, current_user.username,
                )
        except Exception:
            pass
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM IP + SSH Check ────────────────────────────────────────────────────────

@router.get("/vms/{node}/{vmid}/ip")
async def get_vm_ip(
    node: str,
    vmid: int,
    type: str = Query(default="qemu", pattern="^(qemu|lxc)$"),
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    # node is in the path here — resolve auth+client for that specific node.
    from backend.services.nodes_service import get_node_for_proxmox_name, get_default_node

    node_row = await get_node_for_proxmox_name(node) or await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Portal node configured",
        )
    auth = await _build_auth_for_node(current_user, node_row)
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    ip = await client.get_vm_ip(auth, node, vmid, type)
    return {"ip": ip}


@router.get("/vms/{node}/{vmid}/ssh-check")
async def check_vm_ssh(
    node: str,
    vmid: int,
    ip: str = Query(...),
    _: CurrentUser = Depends(get_current_user),
) -> dict:
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(ip, 22), timeout=3.0)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return {"reachable": True}
    except Exception:
        return {"reachable": False}


# ── Service Account Status ────────────────────────────────────────────────────

@router.get("/service-accounts/status", response_model=ServiceAccountStatusResponse)
async def get_service_account_status(
    _: CurrentUser = Depends(require_admin),
) -> ServiceAccountStatusResponse:
    return ServiceAccountStatusResponse(**await get_service_account_status())
