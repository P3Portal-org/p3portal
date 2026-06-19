# p3portal.org
"""PROJ-67 Phase 1 – F-002: Webhook-Allowlist API.

Verwaltet die Liste erlaubter Webhook-Hostnamen/Patterns.
Unterstützt exakte Hostnamen und Wildcard-Patterns (*.example.com).
Nur für Admins zugänglich.
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, field_validator
from sqlalchemy import text

from backend.db.database import get_db
from backend.core.deps import CurrentUser, require_admin_or
from backend.services.audit_service import write_audit_log

router = APIRouter(prefix="/api/webhook-allowlist", tags=["security"])


class AllowlistEntryCreate(BaseModel):
    pattern: str
    allow_http: bool = False

    @field_validator("pattern")
    @classmethod
    def validate_pattern(cls, v: str) -> str:
        v = v.strip().lower()
        if not v:
            raise ValueError("Pattern darf nicht leer sein")
        if len(v) > 255:
            raise ValueError("Pattern zu lang (max 255 Zeichen)")
        return v


class AllowlistEntryResponse(BaseModel):
    id: int
    pattern: str
    allow_http: bool
    created_at: str
    created_by: str


@router.get("", response_model=list[AllowlistEntryResponse])
async def list_allowlist_entries(
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> list[AllowlistEntryResponse]:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT id, pattern, allow_http, created_at, created_by FROM webhook_allowlist ORDER BY id")
        )
        rows = result.mappings().fetchall()
    return [AllowlistEntryResponse(**dict(r)) for r in rows]


@router.post("", response_model=AllowlistEntryResponse, status_code=201)
async def create_allowlist_entry(
    body: AllowlistEntryCreate,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> AllowlistEntryResponse:
    now = datetime.now(timezone.utc).isoformat()
    async with get_db() as db:
        try:
            result = await db.execute(
                text(
                    "INSERT INTO webhook_allowlist (pattern, allow_http, created_at, created_by) "
                    "VALUES (:pattern, :allow_http, :created_at, :created_by) RETURNING id"
                ),
                {
                    "pattern": body.pattern,
                    "allow_http": int(body.allow_http),
                    "created_at": now,
                    "created_by": current_user.username,
                },
            )
            # RETURNING id statt cursor.lastrowid: asyncpg kennt kein lastrowid,
            # RETURNING ist auf SQLite (≥3.35) und PostgreSQL portabel.
            new_id = result.scalar()
            await db.commit()
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Pattern '{body.pattern}' existiert bereits",
                )
            raise

    await write_audit_log(
        "webhook_allowlist_added",
        username=current_user.username,
        auth_type=current_user.auth_type,
        detail=f"pattern={body.pattern}",
    )
    return AllowlistEntryResponse(
        id=new_id,
        pattern=body.pattern,
        allow_http=body.allow_http,
        created_at=now,
        created_by=current_user.username,
    )


@router.delete("/{entry_id}", status_code=204)
async def delete_allowlist_entry(
    entry_id: int,
    current_user: CurrentUser = Depends(require_admin_or("manage_settings")),
) -> None:
    async with get_db() as db:
        result = await db.execute(
            text("SELECT pattern FROM webhook_allowlist WHERE id = :id"),
            {"id": entry_id},
        )
        row = result.mappings().fetchone()
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Eintrag nicht gefunden")
        pattern = row["pattern"]

        await db.execute(
            text("DELETE FROM webhook_allowlist WHERE id = :id"),
            {"id": entry_id},
        )
        await db.commit()

    await write_audit_log(
        "webhook_allowlist_removed",
        username=current_user.username,
        auth_type=current_user.auth_type,
        detail=f"pattern={pattern}",
    )
