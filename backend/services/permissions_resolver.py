# p3portal.org
"""PROJ-47: Zentraler Permissions-Resolver.

Aggregiert alle Quellen-Pfade (PROJ-12 Single-Assignments, PROJ-46 Pool-Assignments,
PROJ-47 Node-Assignments) und wendet die Union-Regel an: das großzügigste Preset gewinnt.

Verwendung:
    from backend.services.permissions_resolver import resolve_user_permissions, resolve_node_action

    # VM/LXC-Zugriff prüfen
    allowed = await resolve_user_permissions(user_id=5, node_id=1, vmid=100, resource_type="vm")

    # Node-eigene Aktion prüfen (z.B. node:view_tasks)
    ok = await resolve_node_action(user_id=5, node_id=1, action="node:view_tasks")
"""
from __future__ import annotations

import json
import logging

from sqlalchemy import text

from backend.core.plus_protocol import plus_behavior
from backend.db.database import get_db

logger = logging.getLogger(__name__)


async def _get_user_id(db, username: str) -> int | None:
    result = await db.execute(
        text("SELECT id FROM local_users WHERE username = :u"),
        {"u": username},
    )
    row = result.fetchone()
    return row[0] if row else None


async def _get_group_ids(db, user_id: int) -> list[int]:
    result = await db.execute(
        text("SELECT group_id FROM group_members WHERE user_id = :uid"),
        {"uid": user_id},
    )
    return [row[0] for row in result.fetchall()]


async def _is_admin(db, user_id: int) -> bool:
    result = await db.execute(
        text("SELECT role FROM local_users WHERE id = :id"),
        {"id": user_id},
    )
    row = result.fetchone()
    return row is not None and row[0] == "admin"


# ── VM/LXC Resolver ──────────────────────────────────────────────────────────

# PROJ-48: Feste Action-Menge für Owner-Pfad (kein delete – Approval-Stub bis PROJ-50)
OWNER_ACTIONS: frozenset[str] = frozenset({
    "view", "start", "stop", "reboot", "snapshot", "configure", "clone",
})


async def _owner_actions_for_resource(
    db, user_id: int, resource_type: str, node_id: int, vmid: int
) -> set[str]:
    """Pfad 4 (PROJ-48): gibt OWNER_ACTIONS zurück wenn user aktiver Owner ist."""
    result = await db.execute(
        text("""
            SELECT 1 FROM vm_owners
             WHERE user_id = :uid AND resource_type = :rt
               AND node_id = :nid AND vmid = :vmid
               AND deleted_at IS NULL
             LIMIT 1
        """),
        {"uid": user_id, "rt": resource_type, "nid": node_id, "vmid": vmid},
    )
    return set(OWNER_ACTIONS) if result.fetchone() is not None else set()


async def resolve_user_permissions(
    user_id: int,
    node_id: int,
    vmid: int,
    resource_type: str,
) -> set[str]:
    """Gibt die Union aller erlaubten VM/LXC-Aktionen für einen User zurück.

    Quellen-Pfade (alle werden ausgewertet, Union-Regel):
    1. PROJ-12: resource_assignments (direkter VM/LXC-Zugriff)
    2. PROJ-46: pool_assignments (via Pool-Mitgliedschaft)
    3. PROJ-47: node_assignments (via Node-Scope für User + Gruppen)
    4. PROJ-48: vm_owners (Owner-Pfad, kein delete)

    Globaler Admin → Vollzugriff (["view","start","stop","reboot","snapshot","configure","delete","clone"]).
    """
    ALL_ACTIONS = {"view", "start", "stop", "reboot", "snapshot", "configure", "delete", "clone"}

    async with get_db() as db:
        if await _is_admin(db, user_id):
            return ALL_ACTIONS

        group_ids = await _get_group_ids(db, user_id)
        permissions: set[str] = set()

        # Pfad 1: PROJ-12 direkter VM/LXC-Zugriff
        # portal_node_id IS NULL = legacy-Eintrag gilt für alle Nodes (Backward-Compat)
        direct_result = await db.execute(
            text("""
                SELECT rp.permissions
                  FROM resource_assignments ra
                  JOIN role_presets rp ON rp.id = ra.preset_id
                 WHERE ra.user_id = :uid
                   AND ra.resource_type = :rtype
                   AND ra.resource_id = :vmid
                   AND (ra.portal_node_id IS NULL OR ra.portal_node_id = :node_id)
            """),
            {"uid": user_id, "rtype": resource_type, "vmid": vmid, "node_id": node_id},
        )
        for row in direct_result.fetchall():
            permissions.update(json.loads(row[0] or "[]"))

        # Pfad 2: PROJ-62 Pool-Permissions via Protocol-Hook (ersetzt direkte SQL-JOINs)
        pool_grants = await plus_behavior.get_pool_permissions(user_id)
        for grant in pool_grants:
            if grant.node_id == node_id and grant.vmid == vmid:
                permissions.update(grant.permissions)

        # Pfad 3: PROJ-47 Node-Assignment (User direkt)
        node_user_result = await db.execute(
            text("""
                SELECT rp.permissions
                  FROM node_assignments na
                  JOIN role_presets rp ON rp.id = na.role_preset_id
                 WHERE na.node_id = :nid
                   AND na.subject_type = 'user' AND na.subject_id = :uid
            """),
            {"nid": node_id, "uid": user_id},
        )
        for row in node_user_result.fetchall():
            permissions.update(json.loads(row[0] or "[]"))

        # Pfad 3b: PROJ-47 Node-Assignment (via Gruppen)
        if group_ids:
            node_group_result = await db.execute(
                text(f"""
                    SELECT rp.permissions
                      FROM node_assignments na
                      JOIN role_presets rp ON rp.id = na.role_preset_id
                     WHERE na.node_id = :nid
                       AND na.subject_type = 'group'
                       AND na.subject_id IN ({','.join(str(g) for g in group_ids)})
                """),
                {"nid": node_id},
            )
            for row in node_group_result.fetchall():
                permissions.update(json.loads(row[0] or "[]"))

        # Pfad 4: PROJ-48 Owner-Pfad (additiv, kein delete)
        permissions.update(
            await _owner_actions_for_resource(db, user_id, resource_type, node_id, vmid)
        )

    return permissions


# ── Node-Action Resolver ──────────────────────────────────────────────────────

async def resolve_node_action(user_id: int, node_id: int, action: str) -> bool:
    """Prüft ob ein User eine Node-eigene Aktion (z.B. node:view_tasks) ausführen darf.

    Nur Node-Assignments werden ausgewertet (kein Pool/Single-Path).
    Globaler Admin → immer erlaubt.
    """
    async with get_db() as db:
        if await _is_admin(db, user_id):
            return True

        group_ids = await _get_group_ids(db, user_id)

        # User-direktes Node-Assignment
        user_result = await db.execute(
            text("""
                SELECT rp.node_actions
                  FROM node_assignments na
                  JOIN role_presets rp ON rp.id = na.role_preset_id
                 WHERE na.node_id = :nid
                   AND na.subject_type = 'user' AND na.subject_id = :uid
            """),
            {"nid": node_id, "uid": user_id},
        )
        for row in user_result.fetchall():
            actions = json.loads(row[0] or "[]")
            if action in actions:
                return True

        # Gruppen-Node-Assignment
        if group_ids:
            group_result = await db.execute(
                text(f"""
                    SELECT rp.node_actions
                      FROM node_assignments na
                      JOIN role_presets rp ON rp.id = na.role_preset_id
                     WHERE na.node_id = :nid
                       AND na.subject_type = 'group'
                       AND na.subject_id IN ({','.join(str(g) for g in group_ids)})
                """),
                {"nid": node_id},
            )
            for row in group_result.fetchall():
                actions = json.loads(row[0] or "[]")
                if action in actions:
                    return True

    return False


# ── Playbook-Permission Resolver (PROJ-49) ────────────────────────────────────

async def can_user_execute_playbook(user_id: int, playbook_name: str) -> bool:
    """Prüft ob user_id das Playbook ausführen darf.

    3-Stufen-Prüfung (PROJ-63 Tech-Design §C):
    1. Admin → True
    2. Plus-Hook (can_user_execute_playbook):
       - ALLOW → True
       - DENY  → False
       - FALLBACK → weiter zu Stufe 3
    3. FALLBACK: required_role aus meta.yaml prüfen (Core-Verhalten)
    """
    from backend.core.plus_protocol import plus_behavior, PlaybookPermissionDecision

    async with get_db() as db:
        if await _is_admin(db, user_id):
            return True

    # Plus-Hook
    decision = await plus_behavior.can_user_execute_playbook(user_id, playbook_name)
    if decision == PlaybookPermissionDecision.ALLOW:
        return True
    if decision == PlaybookPermissionDecision.DENY:
        return False

    # FALLBACK: required_role-Prüfung (pre-PROJ-49-Verhalten, Core-Standard)
    from backend.services.playbook_service import get_playbook
    playbook = get_playbook(playbook_name)
    if playbook is None:
        return False

    async with get_db() as db:
        result = await db.execute(
            text("SELECT role FROM local_users WHERE id = :id"),
            {"id": user_id},
        )
        row = result.fetchone()
        if not row:
            return False
        user_role = row[0]

    required = (playbook.required_role or "").lower()
    role_hierarchy = {"viewer": 0, "operator": 1, "admin": 2}
    user_level = role_hierarchy.get(user_role, -1)
    required_level = role_hierarchy.get(required, 0)
    return user_level >= required_level


# ── Bulk-Visibility (Dashboard, PROJ-30) ─────────────────────────────────────

async def resolve_user_visible_vms(user_id: int, resources: list[dict]) -> set[tuple[int, int]]:
    """Gibt das Set aller (node_id, vmid)-Paare zurück, auf die der User mindestens 'view' hat.

    Optimiert für Dashboard-Listing: aggregiert alle drei Pfade in einem Durchgang.

    resources: Liste von dicts mit Pflichtfeldern node_id, vmid, resource_type.
    """
    ALL_ACTIONS = {"view", "start", "stop", "reboot", "snapshot", "configure", "delete", "clone"}

    if not resources:
        return set()

    async with get_db() as db:
        if await _is_admin(db, user_id):
            return {(r["node_id"], r["vmid"]) for r in resources}

        group_ids = await _get_group_ids(db, user_id)
        visible: set[tuple[int, int]] = set()

        # Pfad 1: PROJ-12 direkte Zuweisungen
        # Key: (resource_type, portal_node_id_or_None, vmid) – None = legacy, gilt für alle Nodes
        direct_result = await db.execute(
            text("""
                SELECT ra.resource_type, ra.resource_id, ra.portal_node_id, rp.permissions
                  FROM resource_assignments ra
                  JOIN role_presets rp ON rp.id = ra.preset_id
                 WHERE ra.user_id = :uid
            """),
            {"uid": user_id},
        )
        direct_perms: dict[tuple[str, int | None, int], set[str]] = {}
        for row in direct_result.fetchall():
            key = (row[0], row[2], row[1])  # (resource_type, portal_node_id, vmid)
            direct_perms.setdefault(key, set()).update(json.loads(row[3] or "[]"))

        # Pfad 2: PROJ-62 Pool-Permissions via Protocol-Hook (ersetzt direkte SQL-JOINs)
        pool_grants = await plus_behavior.get_pool_permissions(user_id)
        pool_perms: dict[tuple[int, int], set[str]] = {}
        for grant in pool_grants:
            key = (grant.node_id, grant.vmid)
            pool_perms.setdefault(key, set()).update(grant.permissions)

        # Pfad 3: PROJ-47 Node-Zuweisungen (User) → gibt Zugriff auf alle VMs des Nodes
        node_user_result = await db.execute(
            text("""
                SELECT na.node_id, rp.permissions
                  FROM node_assignments na
                  JOIN role_presets rp ON rp.id = na.role_preset_id
                 WHERE na.subject_type = 'user' AND na.subject_id = :uid
            """),
            {"uid": user_id},
        )
        node_perms: dict[int, set[str]] = {}
        for row in node_user_result.fetchall():
            node_perms.setdefault(row[0], set()).update(json.loads(row[1] or "[]"))

        # Pfad 3b: Node-Zuweisungen (Gruppen)
        if group_ids:
            node_group_result = await db.execute(
                text(f"""
                    SELECT na.node_id, rp.permissions
                      FROM node_assignments na
                      JOIN role_presets rp ON rp.id = na.role_preset_id
                     WHERE na.subject_type = 'group'
                       AND na.subject_id IN ({','.join(str(g) for g in group_ids)})
                """),
            )
            for row in node_group_result.fetchall():
                node_perms.setdefault(row[0], set()).update(json.loads(row[1] or "[]"))

        # Pfad 4: PROJ-48 Owner-Pfad – alle aktiven Owner-Einträge des Users
        owner_result = await db.execute(
            text("""
                SELECT node_id, vmid FROM vm_owners
                 WHERE user_id = :uid AND deleted_at IS NULL
            """),
            {"uid": user_id},
        )
        owner_vms: set[tuple[int, int]] = {(r[0], r[1]) for r in owner_result.fetchall()}

    # Auswertung: Union aller Quellen je VM
    for r in resources:
        node_id = r["node_id"]
        vmid = r["vmid"]
        resource_type = r.get("resource_type", "vm")

        combined: set[str] = set()
        # Pfad 1: Node-spezifischer Eintrag + legacy NULL-Node-Eintrag (Backward-Compat)
        combined.update(direct_perms.get((resource_type, node_id, vmid), set()))
        combined.update(direct_perms.get((resource_type, None, vmid), set()))
        # Pfad 2
        combined.update(pool_perms.get((node_id, vmid), set()))
        # Pfad 3
        combined.update(node_perms.get(node_id, set()))
        # Pfad 4: Owner → view-Berechtigung (kein delete)
        if (node_id, vmid) in owner_vms:
            combined.update(OWNER_ACTIONS)

        if "view" in combined:
            visible.add((node_id, vmid))

    return visible
