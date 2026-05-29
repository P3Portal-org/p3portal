# p3portal.org
"""PROJ-66: FastAPI-Router für Tooling-Health-Endpoints.

3 Endpoints (alle für eingeloggte Nutzer, kein Role-Gate):
  GET  /api/system/tooling/status            – gecachter Tooling-Status
  POST /api/system/tooling/recheck           – Cache-Bypass (Rate-Limit 30s/User/Tool)
  GET  /api/system/tooling/audit-history     – letzte 20 Status-Transitions (aus audit_logs)
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from backend.core.deps import CurrentUser, get_current_user
from backend.db.database import get_db, get_engine_dialect
from backend.db.dialect import json_path_extract
from backend.features.tooling.schemas import AuditHistoryItem, AuditHistoryResponse
from backend.features.tooling.service import tooling_service
from sqlalchemy import text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/system/tooling", tags=["tooling"])


@router.get("/status")
async def get_tooling_status(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Aktueller Tooling-Status aus Cache (kein Subprocess, kein Admin-Gate).

    Gibt 'unknown' zurück wenn noch kein Check durchgeführt wurde.
    """
    cache = tooling_service.get_cached()
    return {tool_id: status_obj.model_dump() for tool_id, status_obj in cache.items()}


@router.post("/recheck", status_code=200)
async def recheck_tooling(
    current_user: CurrentUser = Depends(get_current_user),
):
    """Sofortiger Re-Check aller Tools (Cache-Bypass).

    Rate-Limit: max 1× pro 30 s pro User pro Tool. Bei Überschreitung → HTTP 429.
    """
    user_id = current_user.user_id  # None für Proxmox-Auth-User

    # Rate-Limit prüfen (vor Lock-Akquisition, Service-Methode setzt Timestamp sofort)
    for tool_id in ["ansible", "packer"]:
        retry_after = tooling_service.check_rate_limit(user_id, tool_id)
        if retry_after is not None:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={"detail": "rate_limited", "retry_after": retry_after},
                headers={"Retry-After": str(retry_after)},
            )

    try:
        cache = await tooling_service.force_recheck(user_id=user_id)
    except ValueError as exc:
        # Service kann auch ValueError mit "rate_limited:tool:X" werfen (Race)
        parts = str(exc).split(":")
        retry_after = int(parts[2]) if len(parts) >= 3 else _RATE_LIMIT_SECONDS
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"detail": "rate_limited", "retry_after": retry_after},
            headers={"Retry-After": str(retry_after)},
        )

    return {tool_id: status_obj.model_dump() for tool_id, status_obj in cache.items()}


_RATE_LIMIT_SECONDS = 30


@router.get("/audit-history", response_model=AuditHistoryResponse)
async def get_tooling_audit_history(
    tool: str = Query("ansible", description="Tool-ID ('ansible' oder 'packer')"),
    limit: int = Query(20, ge=1, le=100),
    current_user: CurrentUser = Depends(get_current_user),
):
    """Letzte N Tooling-Status-Transitions aus audit_logs (für Slide-Over-Sektion).

    Filtert auf event_type='tooling_status_changed' und payload.tool=<tool>.
    Kein Admin-Gate (AC-API-1).
    """
    _dialect = get_engine_dialect()
    async with get_db() as session:
        result = await session.execute(
            text(
                f"""
                SELECT id, created_at, detail
                FROM audit_logs
                WHERE event_type = 'tooling_status_changed'
                  AND auth_type = 'tooling'
                  AND {json_path_extract('detail', 'tool', _dialect)} = :tool
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"tool": tool, "limit": limit},
        )
        rows = result.mappings().fetchall()

    items: list[AuditHistoryItem] = []
    for row in rows:
        try:
            payload = json.loads(row["detail"] or "{}")
        except (json.JSONDecodeError, TypeError):
            payload = {}

        items.append(
            AuditHistoryItem(
                id=row["id"],
                created_at=row["created_at"],
                tool=payload.get("tool", tool),
                from_status=payload.get("from", "unknown"),
                to_status=payload.get("to", "unknown"),
                version=payload.get("version"),
                stderr_excerpt=payload.get("stderr_excerpt"),
            )
        )

    return AuditHistoryResponse(tool=tool, items=items, total=len(items))
