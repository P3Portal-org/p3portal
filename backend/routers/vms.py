# p3portal.org
from __future__ import annotations

import asyncio
import uuid
from typing import NoReturn

import httpx
from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from backend.features.api_surface.deps import require_scope_for_upk  # PROJ-97

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.models.vms import (
    DiskAttachRequest,
    DiskListResponse,
    DiskResizeRequest,
    ImageStorageInfo,
    ServiceAccountStatusResponse,
    SnapshotCreateRequest,
    SnapshotInfo,
    VmConfigUpdateRequest,
    VmTaskResponse,
)
from backend.services.audit_service import write_audit_log
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient, proxmox_client
from backend.services.service_accounts import _extract_token, get_service_account_status
from backend.services.rbac_service import check_permission, has_any_assignments
from backend.services.local_auth import get_user_by_username

router = APIRouter(prefix="/api", tags=["vms"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). VM-Reads → cluster:read, Mutationen → vms:write.
_SCOPE_READ = Depends(require_scope_for_upk("cluster:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("vms:write"))


async def _assert_not_stack_managed(pve_node: str, vmid: int, username: str, auth_type: str) -> None:
    """Block single-VM mutations on stack-managed VMs (PROJ-76 Phase 2b, AC-2B-MUT-6).

    Serverside enforcement: CPU/RAM/Disk/Delete on a VM tracked by a stack state
    must go through the stack definition. Core-mode is a no-op (Plus-Hook → None).
    Power actions and snapshots are intentionally NOT guarded.
    """
    from backend.core.plus_protocol import plus_behavior
    from backend.services.nodes_service import get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(pve_node)
    if node_row is None:
        return
    try:
        managed = await plus_behavior.get_stack_for_vm(node_row.id, vmid)
    except Exception:
        managed = None
    if managed:
        await write_audit_log(
            event_type="stack_vm_mutation_blocked",
            username=username,
            auth_type=auth_type,
            detail=f"vmid={vmid} node={pve_node} stack_id={managed['stack_id']}",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error": "vm_managed_by_stack",
                "stack_id": managed["stack_id"],
                "stack_name": managed["stack_name"],
            },
        )


async def _dependency_impact(
    pve_node: str, vmid: int, confirm: bool, action: str,
    username: str, auth_type: str,
) -> None:
    """PROJ-96: warn-then-confirm guard for actions on a VM others depend on.

    Structurally analog to ``_assert_not_stack_managed`` (a Plus-hook lookup +
    409), but **resumable**: if dependents exist and ``confirm`` is False, raise
    409 ``dependency_impact`` with the list of direct dependents. A retry with
    ``?confirm=true`` skips the guard and runs the original action (warnen, nicht
    blockieren — PROJ-96 decision #2). Core-mode is a no-op (Plus-Hook → []).
    Wired into stop/reboot/rollback/delete; start is intentionally NOT guarded.
    Not permission-gated (AC-IMPACT-5) — any user allowed to run the action gets
    the warning.
    """
    if confirm:
        return
    from backend.core.plus_protocol import plus_behavior
    from backend.services.nodes_service import get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(pve_node)
    if node_row is None:
        return
    try:
        dependents = await plus_behavior.get_dependents_of_vm(node_row.id, vmid)
    except Exception:
        dependents = []
    if not dependents:
        return
    await write_audit_log(
        event_type="vm_dependency_impact_warned",
        username=username,
        auth_type=auth_type,
        detail=f"vmid={vmid} node={pve_node} action={action} dependents={len(dependents)}",
    )
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "error": "dependency_impact",
            "action": action,
            "count": len(dependents),
            "dependents": dependents,
        },
    )


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


def _disk_write_http_exc(exc: httpx.HTTPStatusError) -> NoReturn:
    """Map Proxmox errors for disk write ops (PROJ-81 AC-RBAC-3 / EC-14).

    Unlike the generic cluster mapper, a Proxmox 403 is surfaced as a real 403
    with a clear hint (the token lacks the disk privileges), and a 401 becomes
    a 502 so a deleted/rotated token never logs the portal user out.
    """
    code = exc.response.status_code
    if code == 403:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Proxmox token lacks the required privileges "
                "(VM.Config.Disk + Datastore.Allocate/AllocateSpace)"
            ),
        )
    if code == 401:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox authentication failed",
        )
    raise HTTPException(status_code=code, detail="Proxmox API error")


# ── VM Power Operations ───────────────────────────────────────────────────────

@router.post("/vms/{vmid}/start", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
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


@router.post("/vms/{vmid}/stop", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def vm_stop(
    vmid: int,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "stop")
        await _dependency_impact(
            pve_node, vmid, confirm, "stop", current_user.username, current_user.auth_type
        )
        task_id = await client.vm_power_action(auth, pve_node, vmid, "shutdown", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/vms/{vmid}/reboot", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def vm_reboot(
    vmid: int,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "reboot")
        await _dependency_impact(
            pve_node, vmid, confirm, "reboot", current_user.username, current_user.auth_type
        )
        task_id = await client.vm_power_action(auth, pve_node, vmid, "reboot", vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM Configuration (CPU / RAM / flags) ──────────────────────────────────────

@router.patch("/vms/{vmid}/config", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_vm_config(
    vmid: int,
    body: VmConfigUpdateRequest,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Apply a CPU/RAM/flag change to a VM or LXC via a single config diff.

    QEMU CPU/RAM changes generally only take effect after a restart unless
    hot-plug is enabled; LXC changes usually apply live. Requires the
    ``configure`` action (admin/operator portal-wide, or RBAC assignment).
    """
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure")
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)

        updates: dict = {}
        delete_keys: list[str] = []

        if body.cores is not None:
            updates["cores"] = body.cores
        if body.memory is not None:
            updates["memory"] = body.memory
        if body.onboot is not None:
            updates["onboot"] = 1 if body.onboot else 0
        if body.protection is not None:
            updates["protection"] = 1 if body.protection else 0
        # QEMU-only
        if vm_type == "qemu" and body.sockets is not None:
            updates["sockets"] = body.sockets
        # LXC-only
        if vm_type == "lxc" and body.swap is not None:
            updates["swap"] = body.swap
        # description: empty string removes the field
        if body.description is not None:
            if body.description.strip():
                updates["description"] = body.description
            else:
                delete_keys.append("description")

        if not updates and not delete_keys:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No configuration changes provided",
            )

        await client.put_vm_config(auth, pve_node, vmid, updates, delete_keys, vm_type)

        changed = sorted([*updates.keys(), *(f"-{k}" for k in delete_keys)])
        await write_audit_log(
            event_type="vm_config_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"{vm_type} {vmid} on {pve_node}: {', '.join(changed)}",
        )
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM Disk Management (PROJ-81, QEMU, Proxmox-only) ──────────────────────────

_DISK_BUSES = ("scsi", "virtio", "sata", "ide")
_BUS_MAX = {"scsi": 30, "virtio": 15, "sata": 5}   # highest valid index per bus
_DISK_SLOT_PATTERN = r"^(scsi|virtio|sata|ide)\d+$"


def _next_free_disk_slot(config: dict, bus: str) -> int:
    """Return the lowest unused index for *bus*; 422 when all slots are taken."""
    used = {int(k[len(bus):]) for k in config if k.startswith(bus) and k[len(bus):].isdigit()}
    for idx in range(_BUS_MAX[bus] + 1):
        if idx not in used:
            return idx
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=f"No free {bus} slot available",
    )


def _size_to_gib(raw: str) -> float:
    """Parse a Proxmox size string ('32G', '512M', '1T') to GiB."""
    s = (raw or "").strip()
    if not s:
        return 0.0
    unit = s[-1].upper()
    factors = {"K": 1024, "M": 1024 ** 2, "G": 1024 ** 3, "T": 1024 ** 4}
    try:
        if unit in factors:
            return float(s[:-1]) * factors[unit] / (1024 ** 3)
        return float(s) / (1024 ** 3)  # plain bytes
    except ValueError:
        return 0.0


def _first_boot_disk(config: dict) -> str | None:
    """Return the boot/root disk slot, or None if it can't be determined.

    Prefers the explicit ``bootdisk`` key, else the first disk-like entry in the
    ``boot order=`` list.
    """
    bootdisk = config.get("bootdisk")
    if isinstance(bootdisk, str) and bootdisk.strip():
        return bootdisk.strip()
    boot = config.get("boot")
    if isinstance(boot, str) and "order=" in boot:
        order = boot.split("order=", 1)[1].split(",")[0]
        for entry in order.split(";"):
            entry = entry.strip()
            if any(entry.startswith(b) and entry[len(b):].isdigit() for b in _DISK_BUSES):
                return entry
    return None


def _qemu_disks(config: dict) -> list:
    """Parse the QEMU disks out of a VM config (reuses cluster._parse_disks)."""
    from backend.routers.cluster import _parse_disks
    return _parse_disks(config, "qemu")


async def _resolve_node_read_auth(
    current_user: CurrentUser, node_name: str
) -> tuple[ProxmoxClient, ProxmoxAuth]:
    """Build a read client/auth for a node (admin→operator→viewer token chain).

    Listing ``/nodes/{node}/storage`` can require more than a viewer token, so
    the strongest available read token is preferred (analog vm-options / iso).
    """
    from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name

    node_row = await get_node_for_proxmox_name(node_name) or await get_default_node()
    if node_row is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No Proxmox node configured",
        )
    if current_user.auth_type == "proxmox":
        auth = await _build_auth_for_node(current_user, node_row)
    else:
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
        auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
    return client, auth


@router.get("/nodes/{node}/image-storages", response_model=list[ImageStorageInfo], dependencies=[_SCOPE_READ])
async def list_image_storages(
    node: str = Path(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ImageStorageInfo]:
    """List storages on *node* that can hold VM disk images (datastore dropdown)."""
    try:
        client, auth = await _resolve_node_read_auth(current_user, node)
        raw = await client.get_node_image_storages(auth, node)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
    return [
        ImageStorageInfo(
            name=str(s.get("storage", "")),
            type=str(s.get("type", "")),
            avail=int(s.get("avail", 0) or 0),
            total=int(s.get("total", 0) or 0),
            used=int(s.get("used", 0) or 0),
        )
        for s in raw
        if s.get("storage")
    ]


@router.post("/vms/{vmid}/disks", response_model=DiskListResponse, dependencies=[_SCOPE_WRITE])
async def attach_disk(
    vmid: int,
    body: DiskAttachRequest,
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> DiskListResponse:
    """Create + attach an additional disk to a QEMU VM (synchronous)."""
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure")
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        if vm_type != "qemu":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Disk management is only supported for QEMU VMs",
            )

        config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        index = _next_free_disk_slot(config, body.bus)
        serial = f"p3-{uuid.uuid4().hex[:8]}"
        await client.attach_vm_disk(
            auth, pve_node, vmid, body.bus, index, body.storage, body.size_gb, serial
        )
        slot = f"{body.bus}{index}"
        await write_audit_log(
            event_type="vm_disk_attached",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"qemu {vmid} on {pve_node}: {slot}={body.storage}:{body.size_gb}G",
        )
        new_config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        return DiskListResponse(disks=_qemu_disks(new_config), disk=slot)
    except httpx.HTTPStatusError as exc:
        _disk_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/vms/{vmid}/disks/{disk}/resize", response_model=DiskListResponse, dependencies=[_SCOPE_WRITE])
async def resize_disk(
    vmid: int,
    body: DiskResizeRequest,
    disk: str = Path(..., pattern=_DISK_SLOT_PATTERN),
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> DiskListResponse:
    """Grow an existing QEMU disk (synchronous; Proxmox cannot shrink)."""
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure")
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        if vm_type != "qemu":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Disk management is only supported for QEMU VMs",
            )

        config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        raw = config.get(disk)
        if not raw or str(raw).startswith("none") or ",media=cdrom" in str(raw):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Disk {disk} not found")
        current_gib = next(
            (_size_to_gib(d.size) for d in _qemu_disks(config) if d.id == disk), 0.0
        )
        if body.size_gb <= current_gib:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"New size ({body.size_gb} GiB) must be larger than the current "
                    f"size ({current_gib:.0f} GiB) — Proxmox cannot shrink disks"
                ),
            )

        await client.resize_vm_disk(auth, pve_node, vmid, disk, body.size_gb)
        await write_audit_log(
            event_type="vm_disk_resized",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"qemu {vmid} on {pve_node}: {disk} → {body.size_gb}G",
        )
        new_config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        return DiskListResponse(disks=_qemu_disks(new_config), disk=disk)
    except httpx.HTTPStatusError as exc:
        _disk_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vms/{vmid}/disks/{disk}", response_model=DiskListResponse, dependencies=[_SCOPE_WRITE])
async def remove_disk(
    vmid: int,
    disk: str = Path(..., pattern=_DISK_SLOT_PATTERN),
    confirm: str = Query(..., description="VM name typed by the user to confirm the destructive action"),
    node: str | None = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
) -> DiskListResponse:
    """Detach + physically purge a QEMU disk (synchronous, irreversible).

    Guards: name-confirmation token, root/boot-disk protection, stack-block.
    """
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "configure")
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        if vm_type != "qemu":
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Disk management is only supported for QEMU VMs",
            )

        config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        expected = str(config.get("name") or vmid)
        if confirm != expected:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Confirmation does not match the VM name",
            )
        raw = config.get(disk)
        if not raw or str(raw).startswith("none") or ",media=cdrom" in str(raw):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Disk {disk} not found")

        # Root-/boot-disk protection (EC-3): explicit boot disk, else index-0 fallback.
        boot_disk = _first_boot_disk(config)
        is_root = (disk == boot_disk) if boot_disk is not None else any(
            disk == f"{b}0" for b in _DISK_BUSES
        )
        if is_root:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="The root/boot disk cannot be removed",
            )

        await client.delete_vm_disk(auth, pve_node, vmid, disk)
        await write_audit_log(
            event_type="vm_disk_removed",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"qemu {vmid} on {pve_node}: {disk}",
        )
        new_config = await client.get_vm_config(auth, pve_node, vmid, "qemu")
        return DiskListResponse(disks=_qemu_disks(new_config), disk=disk)
    except httpx.HTTPStatusError as exc:
        _disk_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── Snapshot Management ───────────────────────────────────────────────────────

@router.get("/vms/{vmid}/snapshots", response_model=list[SnapshotInfo], dependencies=[_SCOPE_READ])
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


@router.post("/vms/{vmid}/snapshots", response_model=VmTaskResponse, status_code=status.HTTP_202_ACCEPTED, dependencies=[_SCOPE_WRITE])
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


@router.post("/vms/{vmid}/snapshots/{snap_name}/rollback", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def rollback_snapshot(
    vmid: int,
    snap_name: str,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(get_current_user),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "snapshot")
        await _dependency_impact(
            pve_node, vmid, confirm, "rollback", current_user.username, current_user.auth_type
        )
        task_id = await client.rollback_snapshot(auth, pve_node, vmid, snap_name, vm_type)
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/vms/{vmid}/snapshots/{snap_name}", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
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

@router.delete("/vms/{vmid}", response_model=VmTaskResponse, dependencies=[_SCOPE_WRITE])
async def delete_vm(
    vmid: int,
    node: str | None = Query(default=None),
    confirm: bool = Query(default=False),
    current_user: CurrentUser = Depends(require_admin),
) -> VmTaskResponse:
    try:
        client, auth, pve_node, vm_type = await _resolve_vm_access(current_user, vmid, node)
        await _check_rbac(current_user, vmid, vm_type, "delete")
        # PROJ-76: single-VM delete blocked for stack-managed VMs (use stack destroy).
        await _assert_not_stack_managed(pve_node, vmid, current_user.username, current_user.auth_type)
        # PROJ-96: warn (resumable) when other VMs depend on this one.
        await _dependency_impact(
            pve_node, vmid, confirm, "delete", current_user.username, current_user.auth_type
        )
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
                # PROJ-77: native Auto-Snapshots als rotated/vm_deleted markieren
                try:
                    await _pb.on_vm_lxc_deleted_auto_snapshots(
                        _node_row.id, vmid, vm_type, current_user.username,
                    )
                except Exception:
                    pass
                # PROJ-96: VM-Abhängigkeits-Kanten als „verwaist" markieren (nie löschen)
                try:
                    await _pb.on_vm_lxc_deleted_dependencies(
                        _node_row.id, vmid, current_user.username,
                    )
                except Exception:
                    pass
        except Exception:
            pass
        return VmTaskResponse(task_id=task_id)
    except httpx.HTTPStatusError as exc:
        _handle_proxmox_error(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


# ── VM IP + SSH Check ────────────────────────────────────────────────────────

@router.get("/vms/{node}/{vmid}/ip", dependencies=[_SCOPE_READ])
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


@router.get("/vms/{node}/{vmid}/ssh-check", dependencies=[_SCOPE_READ])
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

@router.get("/service-accounts/status", response_model=ServiceAccountStatusResponse, dependencies=[_SCOPE_READ])
async def get_service_account_status(
    _: CurrentUser = Depends(require_admin),
) -> ServiceAccountStatusResponse:
    return ServiceAccountStatusResponse(**await get_service_account_status())
