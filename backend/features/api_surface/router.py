# p3portal.org
"""PROJ-44: API-Surface Router – GET /api/version + GET /api/scopes/manifest + GET /api/admin/external-calls."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.features.api_surface.manifest import SCOPE_MANIFEST

router = APIRouter(tags=["api-surface"])


class VersionResponse(BaseModel):
    version: str
    api_compat_level: str
    edition: str


class ScopeEndpointOut(BaseModel):
    method: str
    path: str
    summary_key: str


class ScopeManifestEntryOut(BaseModel):
    name: str
    description_key: str
    endpoints: list[ScopeEndpointOut]
    plus_only: bool
    curl_example: str


class ScopeManifestResponse(BaseModel):
    scopes: list[ScopeManifestEntryOut]
    allowed_scopes: list[str]


@router.get("/api/version", response_model=VersionResponse, include_in_schema=True)
async def get_version() -> VersionResponse:
    """Gibt Backend-Version und api_compat_level zurück (ungeschützt, AC-28)."""
    from backend import __version__
    from backend.core.license import is_plus_edition
    edition = "plus" if is_plus_edition() else "core"
    return VersionResponse(
        version=__version__,
        api_compat_level="2",  # PROJ-97: Default-Deny für upk_-Keys (Breaking)
        edition=edition,
    )


@router.get("/api/scopes/manifest", response_model=ScopeManifestResponse)
async def get_scopes_manifest(
    current_user: CurrentUser = Depends(get_current_user),
) -> ScopeManifestResponse:
    """Liefert das statische Scope-Manifest + die für diesen User erlaubten Scopes.

    JWT-geschützt (kein Scope nötig). Wird vom Frontend für das API-Key-Modal verwendet.
    """
    from backend.db.database import get_db
    from sqlalchemy import text

    allowed: list[str] = []
    if current_user.user_id is not None:
        try:
            async with get_db() as session:
                row = await session.execute(
                    text("SELECT api_keys_allowed_scopes FROM local_users WHERE id = :uid"),
                    {"uid": current_user.user_id},
                )
                r = row.fetchone()
                if r and r[0]:
                    import json
                    allowed = json.loads(r[0])
        except Exception:
            pass

    entries = [
        ScopeManifestEntryOut(
            name=e.name,
            description_key=e.description_key,
            endpoints=[
                ScopeEndpointOut(method=ep.method, path=ep.path, summary_key=ep.summary_key)
                for ep in e.endpoints
            ],
            plus_only=e.plus_only,
            curl_example=e.curl_example,
        )
        for e in SCOPE_MANIFEST
    ]
    return ScopeManifestResponse(scopes=entries, allowed_scopes=allowed)


# ── GET /api/admin/external-calls ─────────────────────────────────────────────

class ExternalCallEntry(BaseModel):
    id: int
    api_key_id: int | None
    api_key_name: str | None
    scope_used: str | None
    auth_kind: str | None
    endpoint_class: str | None
    method: str | None
    endpoint: str | None
    status_code: int | None
    job_id: str | None
    playbook: str | None
    node: str | None
    callback_url: str | None
    called_at: str | None
    user_id: int | None


@router.get("/api/admin/external-calls", response_model=list[ExternalCallEntry])
async def list_external_calls(
    key_name: str | None = Query(default=None),
    scope: str | None = Query(default=None),
    auth_kind: str | None = Query(default=None),
    limit: int = Query(default=200, le=1000),
    _: CurrentUser = Depends(require_admin_or("manage_api_keys")),
) -> list[ExternalCallEntry]:
    """Liefert die letzten N Einträge aus external_api_log (AC-19)."""
    from backend.db.database import get_db
    from sqlalchemy import text

    filters = []
    params: dict = {"limit": limit}

    if scope:
        filters.append("l.scope_used = :scope")
        params["scope"] = scope
    if auth_kind:
        filters.append("l.auth_kind = :auth_kind")
        params["auth_kind"] = auth_kind

    key_join = ""
    if key_name:
        key_join = "JOIN user_api_keys uk ON uk.id = l.api_key_id"
        filters.append("uk.name LIKE :key_name")
        params["key_name"] = f"%{key_name}%"

    where = ("WHERE " + " AND ".join(filters)) if filters else ""

    sql = f"""
        SELECT
            l.id, l.api_key_id,
            COALESCE(uk2.name, l.api_key_name) AS api_key_name,
            l.scope_used, l.auth_kind, l.endpoint_class,
            l.method, l.endpoint, l.status_code,
            l.job_id, l.playbook, l.node, l.callback_url,
            l.called_at, l.user_id
        FROM external_api_log l
        LEFT JOIN user_api_keys uk2 ON uk2.id = l.api_key_id
        {key_join}
        {where}
        ORDER BY l.called_at DESC
        LIMIT :limit
    """

    async with get_db() as session:
        rows = await session.execute(text(sql), params)
        return [ExternalCallEntry(**dict(r._mapping)) for r in rows.fetchall()]
