# p3portal.org
"""PROJ-83: FastAPI-Router für das Ansible-Inventory (Core).

Prefix /api/ansible-inventory. User-Scope ist Core; Pool-/Global-Scope sind Plus
(404 in Pure Core via assert_guest_run_allowed). Host-Key-Reset: Owner ODER
manage_ansible_inventory.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.core.deps import CurrentUser, get_current_user
from backend.features.ansible_inventory import inventory as _inv
from backend.features.ansible_inventory import host_state, keys as _keys
from backend.features.ansible_inventory.onboarding import (
    render_cloud_init_vendor_data,
    render_onboarding_block,
)
from backend.features.ansible_inventory.permissions import (
    assert_guest_run_allowed,
    assert_owner_or_manage,
    has_manage_inventory,
)
from backend.features.ansible_inventory.schemas import (
    ConnectivityTestOut,
    HostEntryOut,
    InventoryOut,
    MarkManagedOut,
    OnboardingBlockOut,
    ResetHostKeyOut,
)
from backend.services.audit_service import write_audit_log

router = APIRouter(prefix="/api/ansible-inventory", tags=["ansible-inventory"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). GET → :read, Mutationen → :write.
from backend.features.api_surface.deps import require_scope_for_upk  # noqa: E402
_SCOPE_READ = Depends(require_scope_for_upk("ansible_inventory:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("ansible_inventory:write"))


def _validate_scope(scope: str) -> str:
    if scope not in ("user", "pool", "global"):
        raise HTTPException(status_code=422, detail="invalid_scope")
    return scope


@router.get("/hosts", response_model=InventoryOut, dependencies=[_SCOPE_READ])
async def list_hosts(
    scope: str = Query("user"),
    scope_ref: int | None = Query(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> InventoryOut:
    """Listet die Hosts eines Scopes mit Gruppierung managed/unmanaged/no_ip."""
    _validate_scope(scope)
    await assert_guest_run_allowed(current_user, scope, scope_ref, None)
    if current_user.user_id is None:
        raise HTTPException(status_code=403, detail="requires_local_user")

    result = await _inv.build_inventory(scope, scope_ref, current_user.user_id, target_hosts=None)
    return InventoryOut(
        scope=scope,
        scope_ref=scope_ref,
        error=result.error if result.error in (_inv.ERR_EMPTY_SCOPE, _inv.ERR_NO_KEY) else None,
        hosts=[
            HostEntryOut(
                host_ref=e.host_ref,
                portal_node_id=e.portal_node_id,
                proxmox_node=e.proxmox_node,
                vmid=e.vmid,
                kind=e.kind,
                group=e.group,
                ip=e.ip,
                ansible_user=e.ansible_user,
            )
            for e in result.entries
        ],
    )


@router.get("/onboarding-block", response_model=OnboardingBlockOut, dependencies=[_SCOPE_READ])
async def get_onboarding_block(
    scope: str = Query("user"),
    scope_ref: int | None = Query(None),
    global_opt_in: bool = Query(False),
    current_user: CurrentUser = Depends(get_current_user),
) -> OnboardingBlockOut:
    """Zeigt den kanonischen Onboarding-Block zum manuellen Einfügen im Gast.

    Enthält den Service-User p3-ansible + NOPASSWD-sudo + die zutreffenden Public Keys.
    Kein Token-Privileg nötig.
    """
    _validate_scope(scope)
    await assert_guest_run_allowed(current_user, scope, scope_ref, None)
    if current_user.user_id is None:
        raise HTTPException(status_code=403, detail="requires_local_user")

    pool_id = scope_ref if scope == "pool" else None
    pub_keys = await _keys.get_injection_public_keys(current_user.user_id, pool_id, global_opt_in)
    return OnboardingBlockOut(
        block=render_onboarding_block(pub_keys),
        vendor_data=render_cloud_init_vendor_data(pub_keys),
        key_count=len(pub_keys),
    )


@router.post(
    "/hosts/{portal_node_id}/{kind}/{vmid}/reset-host-key",
    response_model=ResetHostKeyOut,
    dependencies=[_SCOPE_WRITE],
)
async def reset_host_key(
    portal_node_id: int,
    kind: str,
    vmid: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> ResetHostKeyOut:
    """Löscht den gemerkten Host-Key → nächster Run re-TOFUt. RBAC: Owner ODER
    manage_ansible_inventory."""
    if kind not in ("qemu", "lxc"):
        raise HTTPException(status_code=422, detail="invalid_kind")

    allowed = has_manage_inventory(current_user)
    if not allowed and current_user.user_id is not None:
        from backend.features.owners.service import is_owner
        resource_type = "lxc" if kind == "lxc" else "vm"
        allowed = await is_owner(current_user.user_id, resource_type, portal_node_id, vmid)
    if not allowed:
        raise HTTPException(status_code=403, detail="forbidden")

    changed = await host_state.reset_host_key(portal_node_id, vmid, kind)
    await write_audit_log(
        "ansible_host_key_reset", current_user.username, current_user.auth_type,
        detail=f"node={portal_node_id} vmid={vmid} kind={kind} changed={changed}",
    )
    return ResetHostKeyOut(detail="reset" if changed else "no_host_key")


# ── PROJ-84 ───────────────────────────────────────────────────────────────────

@router.post(
    "/hosts/{portal_node_id}/{kind}/{vmid}/mark-managed",
    response_model=MarkManagedOut,
    dependencies=[_SCOPE_WRITE],
)
async def mark_managed(
    portal_node_id: int,
    kind: str,
    vmid: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> MarkManagedOut:
    """Markiert einen bestehenden (adoptierten) Host als verwaltet (`ssh_managed=true`), ohne
    Ownership zu ändern. Voraussetzung: der Onboarding-Block wurde im Gast ausgeführt.
    RBAC: Owner des Hosts ODER `manage_ansible_inventory`. `global_opt_in` bleibt unberührt.
    """
    await assert_owner_or_manage(current_user, portal_node_id, kind, vmid)
    await host_state.set_managed(portal_node_id, vmid, kind)

    # AC-RUN-2: ist der Host in einem ausführbaren Scope?
    owned, pooled = await _inv._node_run_scope_sets(portal_node_id)
    st = await host_state.get_host_state(portal_node_id, vmid, kind)
    global_opt_in = bool(st and st["global_opt_in"])
    in_run_scope = ((vmid, kind) in owned) or ((vmid, kind) in pooled) or global_opt_in

    await write_audit_log(
        "ansible_host_marked_managed", current_user.username, current_user.auth_type,
        detail=f"node={portal_node_id} vmid={vmid} kind={kind} in_run_scope={in_run_scope}",
    )
    return MarkManagedOut(
        detail="managed", host_ref=_inv.host_ref(portal_node_id, vmid, kind),
        in_run_scope=in_run_scope,
    )


@router.post(
    "/hosts/{portal_node_id}/{kind}/{vmid}/test-connection",
    response_model=ConnectivityTestOut,
    dependencies=[_SCOPE_WRITE],
)
async def test_connection(
    portal_node_id: int,
    kind: str,
    vmid: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> ConnectivityTestOut:
    """Informativer SSH-Verbindungstest als `p3-ansible` (kein Run, kein Zustands-Schreiben).
    RBAC: Owner ODER `manage_ansible_inventory`. Setzt `ssh_managed` NICHT.
    """
    await assert_owner_or_manage(current_user, portal_node_id, kind, vmid)
    from backend.services.nodes_service import get_node
    from backend.features.ansible_inventory.runner import test_guest_connection

    node = await get_node(portal_node_id)
    if node is None:
        return ConnectivityTestOut(ok=False, reason="error")

    # Live-IP + proxmox_node ermitteln
    live_map, _states = await _inv._resolve_node_live(portal_node_id, [(vmid, kind)])
    live = live_map.get(vmid, {})
    proxmox_node = live.get("proxmox_node", "")
    vm_type = live.get("type", "qemu")
    ip = await _inv._fetch_host_ip(node, proxmox_node, vmid, vm_type)
    if not ip:
        return ConnectivityTestOut(ok=False, reason="no_ip")

    st = await host_state.get_host_state(portal_node_id, vmid, kind)
    ansible_user = st["ansible_user"] if st else host_state.DEFAULT_ANSIBLE_USER
    host_key = st["host_key"] if st else None

    # Scope-Key auflösen: eigener Host → User-Key; sonst (manage_ansible_inventory) → Global-Key.
    private_key: str | None = None
    resource_type = "lxc" if kind == "lxc" else "vm"
    is_caller_owner = False
    if current_user.user_id is not None:
        from backend.features.owners.service import is_owner
        is_caller_owner = await is_owner(current_user.user_id, resource_type, portal_node_id, vmid)
    if is_caller_owner and current_user.user_id is not None:
        private_key = await _keys.get_user_private_key(current_user.user_id)
    elif has_manage_inventory(current_user):
        from backend.core.plus_protocol import plus_behavior
        gs = await plus_behavior.resolve_guest_scope("global", None, current_user.user_id or 0)
        private_key = gs.private_key if gs else None

    ok, reason = await test_guest_connection(ip, ansible_user, private_key, host_key)
    await write_audit_log(
        "ansible_host_connectivity_tested", current_user.username, current_user.auth_type,
        detail=f"node={portal_node_id} vmid={vmid} kind={kind} ok={ok} reason={reason}",
    )
    return ConnectivityTestOut(ok=ok, reason=reason)
