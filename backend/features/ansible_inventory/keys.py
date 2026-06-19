# p3portal.org
"""PROJ-83: Key-Auflösung (Core).

Tier-1 = der bestehende PROJ-14-SSH-Job-Key des Nutzers (User-Scope).
Tier-2/3 (Pool-/Global-Key) liefert der Plus-Mediator.

Der User-Public-Key wird hier IMMER beigesteuert (Core); Pool-/Global-Pubkeys
kommen via get_injection_public_keys_extra aus Plus.
"""
from __future__ import annotations

from sqlalchemy import text

from backend.db.database import get_db


async def _username_for_user_id(user_id: int) -> str | None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT username FROM local_users WHERE id = :id"),
            {"id": user_id},
        )
        row = result.fetchone()
    return row[0] if row else None


async def get_user_public_key(user_id: int) -> str | None:
    """OpenSSH-Public-Key des User-Scope-Keys (PROJ-14), oder None wenn keiner."""
    username = await _username_for_user_id(user_id)
    if not username:
        return None
    from backend.services.profile_service import get_ssh_job_public_key
    return await get_ssh_job_public_key(username)


async def get_user_private_key(user_id: int) -> str | None:
    """Klartext-Private-Key des User-Scope-Keys (in-process, nur für den Runner)."""
    username = await _username_for_user_id(user_id)
    if not username:
        return None
    from backend.services.profile_service import get_ssh_job_key_decrypted
    return await get_ssh_job_key_decrypted(username)


async def get_injection_public_keys(
    user_id: int, pool_id: int | None, global_opt_in: bool
) -> list[str]:
    """Alle beim Deploy zu injizierenden Public Keys für einen Host.

    = [User-Pubkey] (immer, Core) + [Pool-Pubkey wenn pool] + [Global-Pubkey wenn opt_in]
    (Pool/Global via Plus-Mediator; in Core sind beide leer).
    """
    keys: list[str] = []
    user_pub = await get_user_public_key(user_id)
    if user_pub:
        keys.append(user_pub)

    from backend.core.plus_protocol import plus_behavior
    try:
        extra = await plus_behavior.get_injection_public_keys_extra(pool_id, global_opt_in)
    except Exception:
        extra = []
    for k in extra or []:
        if k and k not in keys:
            keys.append(k)
    return keys
