# p3portal.org
"""PROJ-47: Business-Logik für das Node-Assignments-Modul."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from backend.db.database import get_db
from backend.core.plus_protocol import plus_behavior
from backend.services.audit_service import write_audit_log
from .schemas import VALID_NODE_ACTIONS

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── helpers ───────────────────────────────────────────────────────────────────

async def _get_node(db, node_id: int) -> dict | None:
    result = await db.execute(text("SELECT id, name FROM nodes WHERE id = :id"), {"id": node_id})
    row = result.mappings().fetchone()
    return dict(row) if row else None


async def _get_preset(db, preset_id: int) -> dict | None:
    result = await db.execute(
        text("SELECT id, name, permissions, node_actions FROM role_presets WHERE id = :id"),
        {"id": preset_id},
    )
    row = result.mappings().fetchone()
    return dict(row) if row else None


async def _get_subject_display(db, subject_type: str, subject_id: int) -> str | None:
    if subject_type == "user":
        result = await db.execute(
            text("SELECT username FROM local_users WHERE id = :id"),
            {"id": subject_id},
        )
    else:
        result = await db.execute(
            text("SELECT name FROM groups WHERE id = :id"),
            {"id": subject_id},
        )
    row = result.fetchone()
    return row[0] if row else None


def _row_to_response(row: dict) -> dict:
    node_actions_raw = row.get("node_actions") or row.get("preset_node_actions") or "[]"
    if isinstance(node_actions_raw, str):
        try:
            node_actions = json.loads(node_actions_raw)
        except (ValueError, TypeError):
            node_actions = []
    else:
        node_actions = list(node_actions_raw)
    return {
        "id": row["id"],
        "node_id": row["node_id"],
        "subject_type": row["subject_type"],
        "subject_id": row["subject_id"],
        "subject_display": row.get("subject_display"),
        "role_preset_id": row["role_preset_id"],
        "preset_name": row.get("preset_name"),
        "preset_node_actions": node_actions,
        "added_at": row["added_at"],
        "added_by": row["added_by"],
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def list_assignments(node_id: int) -> list[dict]:
    async with get_db() as db:
        node = await _get_node(db, node_id)
        if node is None:
            raise KeyError(f"Node {node_id} nicht gefunden")

        result = await db.execute(
            text("""
                SELECT na.id, na.node_id, na.subject_type, na.subject_id,
                       na.role_preset_id, na.added_at, na.added_by,
                       rp.name AS preset_name, rp.node_actions
                  FROM node_assignments na
                  JOIN role_presets rp ON rp.id = na.role_preset_id
                 WHERE na.node_id = :nid
                 ORDER BY na.added_at ASC
            """),
            {"nid": node_id},
        )
        rows = result.mappings().fetchall()

        enriched = []
        for row in rows:
            d = dict(row)
            d["subject_display"] = await _get_subject_display(db, d["subject_type"], d["subject_id"])
            enriched.append(_row_to_response(d))

    return enriched


async def add_assignment(
    node_id: int,
    subject_type: str,
    subject_id: int,
    role_preset_id: int,
    added_by: str,
) -> dict:
    async with get_db() as db:
        node = await _get_node(db, node_id)
        if node is None:
            raise KeyError(f"Node {node_id} nicht gefunden")

        preset = await _get_preset(db, role_preset_id)
        if preset is None:
            raise ValueError(f"Rollenpreset {role_preset_id} nicht gefunden")

        subject_display = await _get_subject_display(db, subject_type, subject_id)
        if subject_display is None:
            kind = "Nutzer" if subject_type == "user" else "Gruppe"
            raise ValueError(f"{kind} mit ID {subject_id} nicht gefunden")

        # Plus-Gate
        max_assignments = plus_behavior.get_max_node_assignments()
        if max_assignments is not None:
            count_result = await db.execute(
                text("SELECT COUNT(*) FROM node_assignments"),
            )
            total = count_result.scalar() or 0
            if total >= max_assignments:
                raise PermissionError("license_limit_node_assignments_reached")

        now = _now()
        try:
            result = await db.execute(
                text(
                    "INSERT INTO node_assignments "
                    "(node_id, subject_type, subject_id, role_preset_id, added_at, added_by) "
                    "VALUES (:nid, :stype, :sid, :pid, :now, :by) RETURNING id"
                ),
                {
                    "nid": node_id,
                    "stype": subject_type,
                    "sid": subject_id,
                    "pid": role_preset_id,
                    "now": now,
                    "by": added_by,
                },
            )
            # RETURNING id statt cursor.lastrowid (asyncpg-kompatibel, S562/S588).
            new_id = result.scalar()
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise ValueError("Dieses Subjekt hat bereits eine Zuweisung auf diesem Node.")

    await write_audit_log(
        "node_assignment_added",
        username=added_by,
        detail=json.dumps({
            "node_id": node_id,
            "node_name": node["name"],
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_display": subject_display,
            "role_preset_id": role_preset_id,
            "added_by": added_by,
        }),
    )

    return {
        "id": new_id,
        "node_id": node_id,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "subject_display": subject_display,
        "role_preset_id": role_preset_id,
        "preset_name": preset["name"],
        "preset_node_actions": json.loads(preset["node_actions"] or "[]"),
        "added_at": now,
        "added_by": added_by,
    }


async def update_assignment(
    node_id: int,
    subject_type: str,
    subject_id: int,
    new_preset_id: int,
    changed_by: str,
) -> dict | None:
    async with get_db() as db:
        node = await _get_node(db, node_id)
        if node is None:
            raise KeyError(f"Node {node_id} nicht gefunden")

        result = await db.execute(
            text(
                "SELECT id, role_preset_id, added_at FROM node_assignments "
                "WHERE node_id = :nid AND subject_type = :stype AND subject_id = :sid"
            ),
            {"nid": node_id, "stype": subject_type, "sid": subject_id},
        )
        row = result.mappings().fetchone()
        if row is None:
            return None

        old_preset_id = row["role_preset_id"]
        existing_added_at = row["added_at"]
        new_preset = await _get_preset(db, new_preset_id)
        if new_preset is None:
            raise ValueError(f"Rollenpreset {new_preset_id} nicht gefunden")

        subject_display = await _get_subject_display(db, subject_type, subject_id)

        await db.execute(
            text(
                "UPDATE node_assignments SET role_preset_id = :pid "
                "WHERE node_id = :nid AND subject_type = :stype AND subject_id = :sid"
            ),
            {"pid": new_preset_id, "nid": node_id, "stype": subject_type, "sid": subject_id},
        )
        await db.commit()

    await write_audit_log(
        "node_assignment_changed",
        username=changed_by,
        detail=json.dumps({
            "node_id": node_id,
            "node_name": node["name"],
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_display": subject_display,
            "old_preset_id": old_preset_id,
            "new_preset_id": new_preset_id,
            "changed_by": changed_by,
        }),
    )

    return {
        "id": row["id"],
        "node_id": node_id,
        "subject_type": subject_type,
        "subject_id": subject_id,
        "subject_display": subject_display,
        "role_preset_id": new_preset_id,
        "preset_name": new_preset["name"],
        "preset_node_actions": json.loads(new_preset["node_actions"] or "[]"),
        "added_at": existing_added_at,
        "added_by": changed_by,
    }


async def remove_assignment(
    node_id: int,
    subject_type: str,
    subject_id: int,
    removed_by: str,
    source: str = "manual",
) -> bool:
    async with get_db() as db:
        node = await _get_node(db, node_id)

        result = await db.execute(
            text(
                "SELECT id, role_preset_id FROM node_assignments "
                "WHERE node_id = :nid AND subject_type = :stype AND subject_id = :sid"
            ),
            {"nid": node_id, "stype": subject_type, "sid": subject_id},
        )
        row = result.mappings().fetchone()
        if row is None:
            return False

        preset_id = row["role_preset_id"]
        subject_display = await _get_subject_display(db, subject_type, subject_id)

        await db.execute(
            text(
                "DELETE FROM node_assignments "
                "WHERE node_id = :nid AND subject_type = :stype AND subject_id = :sid"
            ),
            {"nid": node_id, "stype": subject_type, "sid": subject_id},
        )
        await db.commit()

    await write_audit_log(
        "node_assignment_removed",
        username=removed_by,
        detail=json.dumps({
            "node_id": node_id,
            "node_name": node["name"] if node else None,
            "subject_type": subject_type,
            "subject_id": subject_id,
            "subject_display": subject_display,
            "role_preset_id": preset_id,
            "removed_by": removed_by,
            "source": source,
        }),
    )
    return True


# ── Cleanup-Hooks (aufgerufen vor Kaskaden-DELETE) ────────────────────────────

async def cleanup_assignments_for_user(user_id: int, deleted_by: str) -> None:
    """Audit-Log für alle Node-Assignments eines Users vor dem User-Delete.

    Schreibt einen Eintrag pro Assignment. Der eigentliche DELETE erfolgt
    danach über DB-Cascade (kein harter FK, daher explizit).
    """
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT na.node_id, na.subject_type, na.subject_id, na.role_preset_id, n.name AS node_name "
                "FROM node_assignments na "
                "LEFT JOIN nodes n ON n.id = na.node_id "
                "WHERE na.subject_type = 'user' AND na.subject_id = :uid"
            ),
            {"uid": user_id},
        )
        rows = result.mappings().fetchall()

        for row in rows:
            await db.execute(
                text(
                    "DELETE FROM node_assignments "
                    "WHERE node_id = :nid AND subject_type = 'user' AND subject_id = :uid"
                ),
                {"nid": row["node_id"], "uid": user_id},
            )
        await db.commit()

    for row in rows:
        await write_audit_log(
            "node_assignment_removed",
            username=deleted_by,
            detail=json.dumps({
                "node_id": row["node_id"],
                "node_name": row["node_name"],
                "subject_type": "user",
                "subject_id": user_id,
                "role_preset_id": row["role_preset_id"],
                "removed_by": deleted_by,
                "source": "user_deleted",
            }),
        )


async def cleanup_assignments_for_group(group_id: int, deleted_by: str) -> None:
    """Audit-Log für alle Node-Assignments einer Gruppe vor dem Group-Delete."""
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT na.node_id, na.subject_type, na.subject_id, na.role_preset_id, n.name AS node_name "
                "FROM node_assignments na "
                "LEFT JOIN nodes n ON n.id = na.node_id "
                "WHERE na.subject_type = 'group' AND na.subject_id = :gid"
            ),
            {"gid": group_id},
        )
        rows = result.mappings().fetchall()

        for row in rows:
            await db.execute(
                text(
                    "DELETE FROM node_assignments "
                    "WHERE node_id = :nid AND subject_type = 'group' AND subject_id = :gid"
                ),
                {"nid": row["node_id"], "gid": group_id},
            )
        await db.commit()

    for row in rows:
        await write_audit_log(
            "node_assignment_removed",
            username=deleted_by,
            detail=json.dumps({
                "node_id": row["node_id"],
                "node_name": row["node_name"],
                "subject_type": "group",
                "subject_id": group_id,
                "role_preset_id": row["role_preset_id"],
                "removed_by": deleted_by,
                "source": "group_deleted",
            }),
        )


async def cleanup_assignments_for_node(node_id: int, node_name: str, deleted_by: str) -> None:
    """Audit-Log für alle Node-Assignments eines Nodes vor dem Node-Delete (FK CASCADE).

    Liest die Liste VOR dem Cascade und schreibt Audit-Einträge.
    """
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT subject_type, subject_id, role_preset_id "
                "FROM node_assignments WHERE node_id = :nid"
            ),
            {"nid": node_id},
        )
        rows = result.mappings().fetchall()

    for row in rows:
        await write_audit_log(
            "node_assignment_removed",
            username=deleted_by,
            detail=json.dumps({
                "node_id": node_id,
                "node_name": node_name,
                "subject_type": row["subject_type"],
                "subject_id": row["subject_id"],
                "role_preset_id": row["role_preset_id"],
                "removed_by": deleted_by,
                "source": "node_deleted",
            }),
        )


async def get_assignment_count_for_preset(preset_id: int) -> int:
    """Gibt die Anzahl Node-Assignments zurück, die ein Preset referenzieren."""
    async with get_db() as db:
        result = await db.execute(
            text("SELECT COUNT(*) FROM node_assignments WHERE role_preset_id = :pid"),
            {"pid": preset_id},
        )
        return result.scalar() or 0


# ── /me/node-assignments ──────────────────────────────────────────────────────

async def get_my_node_assignments(username: str) -> list[dict]:
    """Gibt alle Node-Zugriffe zurück, die ein User direkt oder via Gruppe hat."""
    async with get_db() as db:
        # User-ID ermitteln
        user_result = await db.execute(
            text("SELECT id FROM local_users WHERE username = :u"),
            {"u": username},
        )
        user_row = user_result.fetchone()
        if user_row is None:
            return []
        user_id = user_row[0]

        # Direkte Zuweisungen
        direct_result = await db.execute(
            text("""
                SELECT na.node_id, n.name AS node_name,
                       na.role_preset_id, rp.name AS preset_name,
                       rp.permissions, rp.node_actions
                  FROM node_assignments na
                  JOIN nodes n ON n.id = na.node_id
                  JOIN role_presets rp ON rp.id = na.role_preset_id
                 WHERE na.subject_type = 'user' AND na.subject_id = :uid
            """),
            {"uid": user_id},
        )
        direct_rows = direct_result.mappings().fetchall()

        # Gruppen des Users
        group_result = await db.execute(
            text("""
                SELECT gm.group_id, g.name AS group_name
                  FROM group_members gm
                  JOIN groups g ON g.id = gm.group_id
                 WHERE gm.user_id = :uid
            """),
            {"uid": user_id},
        )
        group_rows = group_result.mappings().fetchall()

        # Gruppen-Zuweisungen
        group_assignments = []
        for grp in group_rows:
            ga_result = await db.execute(
                text("""
                    SELECT na.node_id, n.name AS node_name,
                           na.role_preset_id, rp.name AS preset_name,
                           rp.permissions, rp.node_actions
                      FROM node_assignments na
                      JOIN nodes n ON n.id = na.node_id
                      JOIN role_presets rp ON rp.id = na.role_preset_id
                     WHERE na.subject_type = 'group' AND na.subject_id = :gid
                """),
                {"gid": grp["group_id"]},
            )
            for ga_row in ga_result.mappings().fetchall():
                group_assignments.append((dict(ga_row), grp["group_name"]))

    entries = []
    seen_nodes: set[int] = set()

    for row in direct_rows:
        entries.append({
            "node_id": row["node_id"],
            "node_name": row["node_name"],
            "role_preset_id": row["role_preset_id"],
            "preset_name": row["preset_name"],
            "preset_permissions": json.loads(row["permissions"] or "[]"),
            "preset_node_actions": json.loads(row["node_actions"] or "[]"),
            "source": "direct",
            "source_group_name": None,
        })
        seen_nodes.add(row["node_id"])

    for row, group_name in group_assignments:
        entries.append({
            "node_id": row["node_id"],
            "node_name": row["node_name"],
            "role_preset_id": row["role_preset_id"],
            "preset_name": row["preset_name"],
            "preset_permissions": json.loads(row["permissions"] or "[]"),
            "preset_node_actions": json.loads(row["node_actions"] or "[]"),
            "source": "group",
            "source_group_name": group_name,
        })

    return entries
