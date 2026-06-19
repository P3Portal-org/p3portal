# p3portal.org
"""PROJ-83: RBAC für In-Guest-Runs + Inventory-Sicht (Core).

Ausführung ist scope-/ownership-gegated:
  - user   : jeder Ziel-Host muss dem laufenden Nutzer gehören (PROJ-48).
  - pool   : Pool-Mitglied/-Manager (durch den Mediator durchgesetzt – Nicht-Mitglieder
             erhalten ein leeres Kandidaten-Set).
  - global : Admin.
Pool-/Global-Scope sind Plus → 404 in Pure Core.

Verwaltung (scope-übergreifende Sicht, Key-Rotation) = `manage_ansible_inventory`
(Plus, delegierbar), getrennt von der Ausführung.
"""
from __future__ import annotations

from fastapi import HTTPException, status

from backend.core.deps import CurrentUser
from backend.core.plus_protocol import plus_behavior
from backend.features.ansible_inventory import inventory as _inv


async def user_candidate_refs(user_id: int) -> set[str]:
    cands = await _inv._user_scope_candidates(user_id)
    return {_inv.host_ref(nid, vmid, kind) for (nid, vmid, kind) in cands}


def _is_admin(current_user: CurrentUser) -> bool:
    return current_user.role == "admin"


def has_manage_inventory(current_user: CurrentUser) -> bool:
    return _is_admin(current_user) or (
        "manage_ansible_inventory" in (current_user.portal_permissions or [])
    )


async def assert_guest_run_allowed(
    current_user: CurrentUser,
    scope: str,
    scope_ref: int | None,
    target_hosts: list[str] | None,
) -> None:
    """Wirft 403/404, wenn der Nutzer den Gast-Run im gewählten Scope nicht ausführen darf."""
    if scope == "user":
        if current_user.user_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="guest_run_requires_local_user")
        if target_hosts:
            allowed = await user_candidate_refs(current_user.user_id)
            outside = set(target_hosts) - allowed
            if outside:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="host_outside_scope")
        return

    # Pool/Global sind Plus
    if not plus_behavior.can_use_ansible_inventory():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not_found")

    if scope == "global":
        # PROJ-84: Global-Scope (run + list) auf Admin ODER manage_ansible_inventory anheben,
        # damit node-weit (ownership-frei) onboardete Hosts vom Inventory-Manager ausführbar/
        # sichtbar sind (realisiert AC-RBAC-2 „scope-übergreifende Sicht").
        if not has_manage_inventory(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="global_scope_requires_manage_inventory"
            )
        return

    if scope == "pool":
        # Mitgliedschaft setzt der Mediator durch (resolve_guest_scope → None bei Nicht-Mitglied).
        # Nicht-Mitglieder bekommen damit ein leeres Kandidaten-Set (Host nicht in Auswahl).
        return

    raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid_scope")


async def assert_owner_or_manage(
    current_user: CurrentUser, portal_node_id: int, kind: str, vmid: int
) -> None:
    """PROJ-84: Erlaubt eine Host-bezogene Verwaltungsaktion (mark-managed / test-connection),
    wenn der Nutzer den Host besitzt (PROJ-48) ODER `manage_ansible_inventory` hat.

    `kind` wird gegen qemu/lxc validiert (422). Sonst 403.
    """
    if kind not in ("qemu", "lxc"):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="invalid_kind")
    if has_manage_inventory(current_user):
        return
    if current_user.user_id is not None:
        from backend.features.owners.service import is_owner
        resource_type = "lxc" if kind == "lxc" else "vm"
        if await is_owner(current_user.user_id, resource_type, portal_node_id, vmid):
            return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
