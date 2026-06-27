# p3portal.org
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.models.rbac import AssignmentResponse, PresetResponse

_DEFAULT_PRESETS = [
    {
        "name": "Viewer",
        "description": "Nur lesen",
        "permissions": ["view"],
    },
    {
        "name": "Operator",
        "description": "Start, Stop, Reboot, Snapshot",
        "permissions": ["view", "start", "stop", "reboot", "snapshot"],
    },
    {
        "name": "Admin",
        "description": "Vollzugriff",
        "permissions": ["view", "start", "stop", "reboot", "snapshot", "configure", "delete", "clone"],
    },
]


def _row_to_preset(row, assignment_count: int = 0) -> PresetResponse:
    return PresetResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        permissions=json.loads(row["permissions"]),
        node_actions=json.loads(row["node_actions"]) if row.get("node_actions") else [],
        created_at=row["created_at"],
        created_by=row["created_by"],
        assignment_count=assignment_count,
    )


def _row_to_assignment(row) -> AssignmentResponse:
    return AssignmentResponse(
        id=row["id"],
        user_id=row["user_id"],
        resource_type=row["resource_type"],
        resource_id=row["resource_id"],
        portal_node_id=row["portal_node_id"],
        node_name=row.get("node_name"),
        preset_id=row["preset_id"],
        preset_name=row["preset_name"],
        permissions=json.loads(row["permissions"]),
        created_at=row["created_at"],
        created_by=row["created_by"],
    )


# ── Preset CRUD ───────────────────────────────────────────────────────────────

async def count_presets() -> int:
    async with get_db() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM role_presets"))
        return result.scalar()


async def list_presets() -> list[PresetResponse]:
    async with get_db() as session:
        result = await session.execute(
            text("""
                SELECT p.*,
                       COUNT(a.id) AS assignment_count
                  FROM role_presets p
             LEFT JOIN resource_assignments a ON a.preset_id = p.id
              GROUP BY p.id
              ORDER BY p.created_at ASC
            """)
        )
        rows = result.mappings().fetchall()
    return [_row_to_preset(r, r["assignment_count"]) for r in rows]


async def get_preset_by_id(preset_id: int) -> PresetResponse | None:
    async with get_db() as session:
        result = await session.execute(
            text("""
                SELECT p.*,
                       COUNT(a.id) AS assignment_count
                  FROM role_presets p
             LEFT JOIN resource_assignments a ON a.preset_id = p.id
                 WHERE p.id = :id
              GROUP BY p.id
            """),
            {"id": preset_id},
        )
        row = result.mappings().fetchone()
    return _row_to_preset(row, row["assignment_count"]) if row else None


async def get_preset_usage_count(preset_id: int) -> int:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT COUNT(*) FROM resource_assignments WHERE preset_id = :id"),
            {"id": preset_id},
        )
        return result.scalar()


async def create_preset(
    name: str,
    description: str,
    permissions: list[str],
    created_by: str,
    node_actions: list[str] | None = None,
) -> PresetResponse:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        result = await session.execute(
            text("""
                INSERT INTO role_presets
                    (name, description, permissions, node_actions, created_at, created_by)
                VALUES (:name, :description, :permissions, :node_actions, :created_at, :created_by)
                RETURNING id
            """),
            {
                "name": name,
                "description": description,
                "permissions": json.dumps(permissions),
                "node_actions": json.dumps(node_actions or []),
                "created_at": now,
                "created_by": created_by,
            },
        )
        await session.commit()
        preset_id = result.scalar()
    return await get_preset_by_id(preset_id)


async def update_preset(
    preset_id: int,
    name: str | None,
    description: str | None,
    permissions: list[str] | None,
    node_actions: list[str] | None = None,
) -> PresetResponse | None:
    async with get_db() as session:
        if name is not None:
            await session.execute(
                text("UPDATE role_presets SET name = :name WHERE id = :id"),
                {"name": name, "id": preset_id},
            )
        if description is not None:
            await session.execute(
                text("UPDATE role_presets SET description = :desc WHERE id = :id"),
                {"desc": description, "id": preset_id},
            )
        if permissions is not None:
            await session.execute(
                text("UPDATE role_presets SET permissions = :perms WHERE id = :id"),
                {"perms": json.dumps(permissions), "id": preset_id},
            )
        if node_actions is not None:
            await session.execute(
                text("UPDATE role_presets SET node_actions = :na WHERE id = :id"),
                {"na": json.dumps(node_actions), "id": preset_id},
            )
        await session.commit()
    return await get_preset_by_id(preset_id)


async def delete_preset(preset_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM role_presets WHERE id = :id"),
            {"id": preset_id},
        )
        await session.commit()
        return result.rowcount > 0


# ── Assignment CRUD ───────────────────────────────────────────────────────────

async def list_assignments(user_id: int) -> list[AssignmentResponse]:
    async with get_db() as session:
        result = await session.execute(
            text("""
                SELECT a.*,
                       p.name AS preset_name,
                       p.permissions AS permissions,
                       n.name AS node_name
                  FROM resource_assignments a
                  JOIN role_presets p ON p.id = a.preset_id
             LEFT JOIN nodes n ON n.id = a.portal_node_id
                 WHERE a.user_id = :user_id
                 ORDER BY a.created_at ASC
            """),
            {"user_id": user_id},
        )
        rows = result.mappings().fetchall()
    return [_row_to_assignment(r) for r in rows]


async def create_assignment(
    user_id: int,
    resource_type: str,
    resource_id: int,
    preset_id: int,
    created_by: str,
    portal_node_id: int | None = None,
) -> AssignmentResponse:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        result = await session.execute(
            text("""
                INSERT INTO resource_assignments
                    (user_id, resource_type, resource_id, portal_node_id,
                     preset_id, created_at, created_by)
                VALUES (:user_id, :resource_type, :resource_id, :portal_node_id,
                        :preset_id, :created_at, :created_by)
                RETURNING id
            """),
            {
                "user_id": user_id,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "portal_node_id": portal_node_id,
                "preset_id": preset_id,
                "created_at": now,
                "created_by": created_by,
            },
        )
        await session.commit()
        assignment_id = result.scalar()
        result = await session.execute(
            text("""
                SELECT a.*,
                       p.name AS preset_name,
                       p.permissions AS permissions,
                       n.name AS node_name
                  FROM resource_assignments a
                  JOIN role_presets p ON p.id = a.preset_id
             LEFT JOIN nodes n ON n.id = a.portal_node_id
                 WHERE a.id = :id
            """),
            {"id": assignment_id},
        )
        row = result.mappings().fetchone()
    return _row_to_assignment(row)


async def delete_assignment(user_id: int, assignment_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM resource_assignments WHERE id = :id AND user_id = :user_id"),
            {"id": assignment_id, "user_id": user_id},
        )
        await session.commit()
        return result.rowcount > 0


# ── Permission helpers ────────────────────────────────────────────────────────

async def get_user_permissions(user_id: int) -> list[dict]:
    """Returns list of {resource_type, resource_id, portal_node_id, permissions} for a user."""
    async with get_db() as session:
        result = await session.execute(
            text("""
                SELECT a.resource_type, a.resource_id, a.portal_node_id, p.permissions
                  FROM resource_assignments a
                  JOIN role_presets p ON p.id = a.preset_id
                 WHERE a.user_id = :user_id
            """),
            {"user_id": user_id},
        )
        rows = result.mappings().fetchall()
    return [
        {
            "resource_type": r["resource_type"],
            "resource_id": r["resource_id"],
            "portal_node_id": r["portal_node_id"],
            "permissions": json.loads(r["permissions"]),
        }
        for r in rows
    ]


async def has_any_assignments(user_id: int) -> bool:
    """Returns True if the user has any RBAC assignments configured."""
    async with get_db() as session:
        result = await session.execute(
            text("SELECT COUNT(*) FROM resource_assignments WHERE user_id = :user_id"),
            {"user_id": user_id},
        )
        return result.scalar() > 0


async def check_permission(
    user_id: int,
    resource_id: int,
    resource_type: str,
    action: str,
    portal_node_id: int | None = None,
) -> bool:
    """Returns True if user has the given action on the resource.

    Code-Review-Fix: unioniert über *alle* passenden Assignments (vorher nur die
    erste Zeile → das großzügigste Preset gewann nicht) und ist node-bewusst:
    - ``portal_node_id is None`` → Verhalten wie bisher (Match nur per VMID, alle
      Zeilen unioniert) — rückwärtskompatibel für Aufrufer ohne Node-Kontext.
    - ``portal_node_id`` gesetzt → ein node-scoped Assignment greift nur auf
      genau diesem Portal-Node; ``portal_node_id IS NULL`` gilt weiterhin überall
      (Legacy). Schließt den Cross-Installation-Leak (kollidierende VMIDs).
    """
    async with get_db() as session:
        result = await session.execute(
            text("""
                SELECT p.permissions, a.portal_node_id
                  FROM resource_assignments a
                  JOIN role_presets p ON p.id = a.preset_id
                 WHERE a.user_id = :user_id
                   AND a.resource_id = :resource_id
                   AND a.resource_type = :resource_type
            """),
            {"user_id": user_id, "resource_id": resource_id, "resource_type": resource_type},
        )
        rows = result.mappings().fetchall()
    for row in rows:
        row_node = row["portal_node_id"]
        # node-scoped assignment greift nur auf seinem Node (NULL = überall)
        if portal_node_id is not None and row_node is not None and row_node != portal_node_id:
            continue
        if action in json.loads(row["permissions"]):
            return True
    return False


# ── Seed ─────────────────────────────────────────────────────────────────────

async def seed_default_presets() -> None:
    """Creates default presets if none exist yet."""
    async with get_db() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM role_presets"))
        if result.scalar() > 0:
            return
    for p in _DEFAULT_PRESETS:
        await create_preset(p["name"], p["description"], p["permissions"], created_by="system")
