# p3portal.org
from __future__ import annotations

import json
from datetime import datetime, timezone

import bcrypt as _bcrypt
from sqlalchemy import text

from backend.db.database import get_db
from backend.models.auth import UserResponse


def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def _row_to_user(row) -> UserResponse:
    raw = row["portal_permissions"] if "portal_permissions" in row.keys() else "[]"
    try:
        perms = json.loads(raw or "[]")
    except Exception:
        perms = []
    try:
        group_names = json.loads(row["group_names"] or "[]") if "group_names" in row.keys() else []
    except Exception:
        group_names = []
    try:
        preset_names = json.loads(row["preset_names"] or "[]") if "preset_names" in row.keys() else []
    except Exception:
        preset_names = []
    return UserResponse(
        id=row["id"],
        username=row["username"],
        role=row["role"],
        active=bool(row["active"]),
        created_at=row["created_at"],
        portal_permissions=perms,
        group_names=group_names,
        preset_names=preset_names,
    )


async def get_user_by_username(username: str) -> dict | None:
    """Returns the raw DB row dict or None."""
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM local_users WHERE username = :username"),
            {"username": username},
        )
        row = result.mappings().fetchone()
    return dict(row) if row else None


def _list_users_sql() -> "text":
    """Baut die list_users-Query dialect-abhängig (PROJ-71).

    SQLite nutzt json_group_array, PostgreSQL kennt diese Funktion nicht und
    nutzt json_agg. Das PG-Ergebnis wird mit ::text serialisiert, damit es – wie
    bei SQLite – als JSON-String ankommt; sonst dekodiert der asyncpg-Dialekt
    json zu Python-Objekten und das nachgelagerte json.loads() in _row_to_user
    schlüge fehl.
    """
    from backend.db.database import get_engine_dialect

    if get_engine_dialect() == "postgresql":
        g_agg = "json_agg(gr.name ORDER BY gr.name)::text"
        p_agg = "json_agg(DISTINCT rp.name ORDER BY rp.name)::text"
    else:
        g_agg = "json_group_array(gr.name ORDER BY gr.name)"
        p_agg = "json_group_array(DISTINCT rp.name ORDER BY rp.name)"

    return text(
        f"""
        SELECT
            lu.*,
            COALESCE(g.group_names, '[]') AS group_names,
            COALESCE(p.preset_names, '[]') AS preset_names
        FROM local_users lu
        LEFT JOIN (
            SELECT gm.user_id, {g_agg} AS group_names
            FROM group_members gm
            JOIN groups gr ON gr.id = gm.group_id
            GROUP BY gm.user_id
        ) g ON g.user_id = lu.id
        LEFT JOIN (
            SELECT ra.user_id, {p_agg} AS preset_names
            FROM resource_assignments ra
            JOIN role_presets rp ON rp.id = ra.preset_id
            WHERE ra.user_id IS NOT NULL
            GROUP BY ra.user_id
        ) p ON p.user_id = lu.id
        ORDER BY lu.created_at ASC
        """
    )


async def list_users() -> list[UserResponse]:
    async with get_db() as session:
        result = await session.execute(_list_users_sql())
        rows = result.mappings().fetchall()
    return [_row_to_user(r) for r in rows]


async def get_user_by_id(user_id: int) -> UserResponse | None:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM local_users WHERE id = :id"), {"id": user_id}
        )
        row = result.mappings().fetchone()
    return _row_to_user(row) if row else None


async def create_user(username: str, password: str, role: str) -> UserResponse:
    now = datetime.now(timezone.utc).isoformat()
    password_hash = hash_password(password)
    async with get_db() as session:
        result = await session.execute(
            text(
                """INSERT INTO local_users (username, password_hash, role, active, created_at)
                   VALUES (:username, :password_hash, :role, 1, :created_at)
                   RETURNING id"""
            ),
            {"username": username, "password_hash": password_hash, "role": role, "created_at": now},
        )
        await session.commit()
        user_id = result.scalar()
        result = await session.execute(
            text("SELECT * FROM local_users WHERE id = :id"), {"id": user_id}
        )
        row = result.mappings().fetchone()
    return _row_to_user(row)


async def count_all_users() -> int:
    async with get_db() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM local_users"))
        return result.scalar()


async def count_active_admins() -> int:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT COUNT(*) FROM local_users WHERE role = 'admin' AND active = 1")
        )
        return result.scalar()


async def update_user(
    user_id: int,
    password: str | None,
    role: str | None,
    active: bool | None,
) -> UserResponse | None:
    async with get_db() as session:
        if password is not None:
            await session.execute(
                text("UPDATE local_users SET password_hash = :ph WHERE id = :id"),
                {"ph": hash_password(password), "id": user_id},
            )
        if role is not None:
            await session.execute(
                text("UPDATE local_users SET role = :role WHERE id = :id"),
                {"role": role, "id": user_id},
            )
        if active is not None:
            await session.execute(
                text("UPDATE local_users SET active = :active WHERE id = :id"),
                {"active": 1 if active else 0, "id": user_id},
            )
        await session.commit()
        result = await session.execute(
            text("SELECT * FROM local_users WHERE id = :id"), {"id": user_id}
        )
        row = result.mappings().fetchone()
    return _row_to_user(row) if row else None


async def delete_user(user_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM local_users WHERE id = :id"), {"id": user_id}
        )
        await session.commit()
        return result.rowcount > 0


async def update_last_login(username: str, ip: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE local_users SET last_login_at = :ts, last_login_ip = :ip "
                "WHERE username = :username"
            ),
            {"ts": now, "ip": ip, "username": username},
        )
        await session.commit()


async def reset_password(user_id: int, new_password: str) -> UserResponse | None:
    """Admin-initiated reset: sets new password + must_change_password = 1."""
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE local_users "
                "SET password_hash = :ph, must_change_password = 1 "
                "WHERE id = :id"
            ),
            {"ph": hash_password(new_password), "id": user_id},
        )
        await session.commit()
        result = await session.execute(
            text("SELECT * FROM local_users WHERE id = :id"), {"id": user_id}
        )
        row = result.mappings().fetchone()
    return _row_to_user(row) if row else None


async def change_own_password(
    username: str, old_password: str, new_password: str
) -> bool:
    """User self-service: verifies old password, sets new one, clears must_change flag."""
    user = await get_user_by_username(username)
    if user is None or not verify_password(old_password, user["password_hash"]):
        return False
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE local_users "
                "SET password_hash = :ph, must_change_password = 0 "
                "WHERE username = :username"
            ),
            {"ph": hash_password(new_password), "username": username},
        )
        await session.commit()
    return True


async def clear_must_change_password(username: str) -> None:
    async with get_db() as session:
        await session.execute(
            text("UPDATE local_users SET must_change_password = 0 WHERE username = :username"),
            {"username": username},
        )
        await session.commit()


async def update_portal_permissions(user_id: int, permissions: list[str]) -> UserResponse | None:
    async with get_db() as session:
        await session.execute(
            text("UPDATE local_users SET portal_permissions = :perms WHERE id = :id"),
            {"perms": json.dumps(permissions), "id": user_id},
        )
        await session.commit()
    return await get_user_by_id(user_id)


async def seed_default_admin(username: str, password: str) -> None:
    """Creates default admin if local_users table is empty."""
    async with get_db() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM local_users"))
        if result.scalar() > 0:
            return
    await create_user(username, password, "admin")
