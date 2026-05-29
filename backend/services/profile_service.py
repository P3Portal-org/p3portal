# p3portal.org
from __future__ import annotations

from sqlalchemy import text

from backend.db.database import get_db
from backend.db.dialect import upsert_or_ignore


async def get_user_profile(username: str) -> dict | None:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM user_profiles WHERE username = :username"),
            {"username": username},
        )
        row = result.mappings().fetchone()
    return dict(row) if row else None


async def _ensure_profile(session, username: str, auth_type: str) -> None:
    # PROJ-71: upsert_or_ignore statt INSERT OR IGNORE (dialect-portabel)
    sql, params = upsert_or_ignore(
        "user_profiles",
        ["username", "auth_type"],
        {"username": username, "auth_type": auth_type},
    )
    await session.execute(text(sql), params)


async def get_ssh_key(username: str) -> str | None:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT ssh_public_key FROM user_profiles WHERE username = :username"),
            {"username": username},
        )
        row = result.mappings().fetchone()
    return row["ssh_public_key"] if row else None


async def set_ssh_key(username: str, auth_type: str, key: str) -> None:
    async with get_db() as session:
        await _ensure_profile(session, username, auth_type)
        await session.execute(
            text(
                "UPDATE user_profiles SET ssh_public_key = :key "
                "WHERE username = :username"
            ),
            {"key": key, "username": username},
        )
        await session.commit()


async def list_ssh_keys(username: str) -> list[dict]:
    async with get_db() as session:
        result = await session.execute(
            text(
                "SELECT id, label, public_key, created_at FROM user_ssh_keys "
                "WHERE username = :username ORDER BY created_at ASC"
            ),
            {"username": username},
        )
        rows = result.mappings().fetchall()
    return [dict(r) for r in rows]


async def add_ssh_key_entry(
    username: str, auth_type: str, label: str, public_key: str
) -> int:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        await _ensure_profile(session, username, auth_type)
        result = await session.execute(
            text(
                "INSERT INTO user_ssh_keys (username, label, public_key, created_at) "
                "VALUES (:username, :label, :public_key, :created_at) "
                "RETURNING id"
            ),
            {"username": username, "label": label, "public_key": public_key, "created_at": now},
        )
        row = result.fetchone()
        await session.commit()
    return row[0]


async def delete_ssh_key_entry(username: str, key_id: int) -> bool:
    async with get_db() as session:
        result = await session.execute(
            text(
                "DELETE FROM user_ssh_keys WHERE id = :id AND username = :username"
            ),
            {"id": key_id, "username": username},
        )
        await session.commit()
    return result.rowcount > 0


async def get_ssh_job_key_status(username: str) -> bool:
    """Gibt True zurück wenn ein (verschlüsselter) privater SSH-Key hinterlegt ist."""
    async with get_db() as session:
        result = await session.execute(
            text("SELECT ssh_private_key_enc FROM user_profiles WHERE username = :username"),
            {"username": username},
        )
        row = result.mappings().fetchone()
    return bool(row and row["ssh_private_key_enc"])


async def set_ssh_job_key(username: str, auth_type: str, private_key_plain: str) -> None:
    """Verschlüsselt den privaten Key mit Fernet und speichert ihn."""
    from backend.services.config_service import encrypt_secret
    encrypted = encrypt_secret(private_key_plain)
    async with get_db() as session:
        await _ensure_profile(session, username, auth_type)
        await session.execute(
            text(
                "UPDATE user_profiles SET ssh_private_key_enc = :enc "
                "WHERE username = :username"
            ),
            {"enc": encrypted, "username": username},
        )
        await session.commit()


async def delete_ssh_job_key(username: str) -> None:
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE user_profiles SET ssh_private_key_enc = NULL "
                "WHERE username = :username"
            ),
            {"username": username},
        )
        await session.commit()


async def get_ssh_job_key_decrypted(username: str) -> str | None:
    """Gibt den entschlüsselten privaten Key zurück – nur für den Scheduled-Job-Runner."""
    async with get_db() as session:
        result = await session.execute(
            text("SELECT ssh_private_key_enc FROM user_profiles WHERE username = :username"),
            {"username": username},
        )
        row = result.mappings().fetchone()
    if not (row and row["ssh_private_key_enc"]):
        return None
    from backend.services.config_service import decrypt_secret
    try:
        return decrypt_secret(row["ssh_private_key_enc"])
    except Exception:
        return None


async def generate_ssh_job_keypair(username: str, auth_type: str) -> str:
    """Generiert ein Ed25519-Schlüsselpaar, speichert den privaten Key verschlüsselt
    und gibt den öffentlichen Key (OpenSSH-Format) zurück."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, NoEncryption, PrivateFormat, PublicFormat,
    )
    key = Ed25519PrivateKey.generate()
    private_pem = key.private_bytes(Encoding.PEM, PrivateFormat.OpenSSH, NoEncryption()).decode()
    public_openssh = key.public_key().public_bytes(Encoding.OpenSSH, PublicFormat.OpenSSH).decode()
    public_openssh = f"{public_openssh.strip()} p3portal-job-key"
    await set_ssh_job_key(username, auth_type, private_pem)
    return public_openssh


async def delete_ssh_key(username: str) -> None:
    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE user_profiles SET ssh_public_key = NULL "
                "WHERE username = :username"
            ),
            {"username": username},
        )
        await session.commit()


async def update_last_login(username: str, auth_type: str, ip: str) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as session:
        await _ensure_profile(session, username, auth_type)
        await session.execute(
            text(
                "UPDATE user_profiles "
                "SET last_login_at = :ts, last_login_ip = :ip "
                "WHERE username = :username"
            ),
            {"ts": now, "ip": ip, "username": username},
        )
        await session.commit()
