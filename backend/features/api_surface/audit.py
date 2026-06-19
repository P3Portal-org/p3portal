# p3portal.org
"""PROJ-44: Audit-Hilfsfunktionen für upk_-API-Aufrufe.

Alle Schreibvorgänge sind non-blocking (asyncio.ensure_future / BackgroundTasks).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)


async def log_api_call(
    *,
    api_key_id: int,
    user_id: int | None,
    api_key_name: str,
    scope_used: str,
    method: str,
    endpoint: str,
    status_code: int,
    job_id: str | None = None,
    playbook: str | None = None,
    node: str | None = None,
    callback_url: str | None = None,
) -> None:
    """Schreibt einen Eintrag in external_api_log für upk_-Aufrufe (AC-17, AC-18)."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with get_db() as session:
            await session.execute(
                text(
                    "INSERT INTO external_api_log "
                    "(api_key_id, api_key_name, scope_used, method, endpoint, status_code, "
                    " job_id, playbook, node, callback_url, called_at, "
                    " user_id, auth_kind, endpoint_class) "
                    "VALUES "
                    "(:key_id, :key_name, :scope, :method, :endpoint, :status, "
                    " :job_id, :playbook, :node, :callback_url, :now, "
                    " :user_id, 'upk', 'api')"
                ),
                {
                    "key_id": api_key_id,
                    "key_name": api_key_name,
                    "scope": scope_used,
                    "method": method,
                    "endpoint": endpoint,
                    "status": status_code,
                    "job_id": job_id,
                    "playbook": playbook,
                    "node": node,
                    "callback_url": callback_url,
                    "now": now,
                    "user_id": user_id,
                },
            )
            await session.commit()
    except Exception as exc:
        logger.warning("external_api_log write failed: %s", exc)


async def record_scope_denied(
    *,
    key_id: int,
    user_id: int | None,
    scope_required: str,
    endpoint: str,
    method: str,
    note: str | None = None,
) -> None:
    """Schreibt api_scope_denied in audit_logs (AC-20).

    PROJ-97: Der Default-Deny-Türsteher nutzt dasselbe Event, setzt aber
    scope_required="<no-scope-declared>" (Marker) und liefert über *note* das
    Key-Präfix mit, damit der Betreiber die Integration zuordnen kann (AC-DENY-4).
    """
    try:
        import json
        detail = {
            "key_id": key_id,
            "scope_required": scope_required,
            "endpoint": endpoint,
            "method": method,
            "target_user_id": user_id,
        }
        if note:
            detail["note"] = note
        await write_audit_log(
            "api_scope_denied",
            username=f"key:{key_id}",
            auth_type="local",
            detail=json.dumps(detail),
        )
    except Exception as exc:
        logger.warning("api_scope_denied audit write failed: %s", exc)


async def record_first_use(key_id: int, user_id: int | None) -> None:
    """Setzt first_used_at atomar – schreibt api_key_first_use genau einmal (AC-21)."""
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with get_db() as session:
            result = await session.execute(
                text(
                    "UPDATE user_api_keys SET first_used_at = :now "
                    "WHERE id = :id AND first_used_at IS NULL"
                ),
                {"now": now, "id": key_id},
            )
            await session.commit()
            if result.rowcount == 1:
                # Erster Aufruf – Audit-Event schreiben
                import json
                await write_audit_log(
                    "api_key_first_use",
                    username=f"key:{key_id}",
                    auth_type="local",
                    detail=json.dumps({"key_id": key_id, "user_id": user_id}),
                )
    except Exception as exc:
        logger.warning("api_key_first_use audit write failed: %s", exc)


async def record_scope_change(
    *,
    target_user_id: int,
    by_username: str,
    added: list[str],
    removed: list[str],
) -> None:
    """Schreibt api_scope_added / api_scope_removed für Admin-Whitelist-Änderungen (AC-22)."""
    import json
    for scope in added:
        try:
            await write_audit_log(
                "api_scope_added",
                username=by_username,
                auth_type="local",
                detail=json.dumps({
                    "target_user_id": target_user_id,
                    "scope": scope,
                    "by_user": by_username,
                }),
            )
        except Exception as exc:
            logger.warning("api_scope_added audit write failed: %s", exc)

    for scope in removed:
        try:
            await write_audit_log(
                "api_scope_removed",
                username=by_username,
                auth_type="local",
                detail=json.dumps({
                    "target_user_id": target_user_id,
                    "scope": scope,
                    "by_user": by_username,
                }),
            )
        except Exception as exc:
            logger.warning("api_scope_removed audit write failed: %s", exc)
