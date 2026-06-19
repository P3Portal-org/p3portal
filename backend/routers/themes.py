# p3portal.org
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, status

from backend.core.deps import CurrentUser, get_current_user, require_admin
from backend.core.plus_protocol import plus_behavior
from backend.models.themes import (
    PreferencesRequest,
    PreferencesResponse,
    SetDefaultRequest,
    ThemeEditorRequest,
    ThemeResponse,
)
from backend.services import theme_service
from backend.services.settings_service import get_setting, set_setting
from backend.services.profile_service import get_user_profile
from backend.db.database import get_db
from sqlalchemy import text

router = APIRouter(prefix="/api/themes", tags=["themes"])

_SETTING_KEY = "theme.global_default"
_DEFAULT_THEME = "dark"


# ── Public ────────────────────────────────────────────────────────────────────

@router.get("/default")
async def get_global_default() -> dict:
    theme_id = await get_setting(_SETTING_KEY) or _DEFAULT_THEME
    return {"theme_id": theme_id}


# ── Authenticated ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[ThemeResponse])
async def list_themes(
    _: CurrentUser = Depends(get_current_user),
) -> list[ThemeResponse]:
    themes = await theme_service.list_themes()
    return [ThemeResponse(**t) for t in themes]


# ── Admin ─────────────────────────────────────────────────────────────────────

@router.post("/default", status_code=204)
async def set_global_default(
    body: SetDefaultRequest,
    admin: CurrentUser = Depends(require_admin),
) -> Response:
    await set_setting(_SETTING_KEY, body.theme_id, admin.username)
    return Response(status_code=204)


@router.post("/upload", response_model=ThemeResponse, status_code=201)
async def upload_theme(
    file: UploadFile,
    admin: CurrentUser = Depends(require_admin),
) -> ThemeResponse:
    if not plus_behavior.can_use_theme_editor():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Plus-Lizenz erforderlich")

    content = await file.read()
    if len(content) > theme_service.MAX_THEME_BYTES:
        raise HTTPException(status_code=413, detail="Datei zu groß (max. 100 KB)")

    import json
    try:
        data = json.loads(content)
    except Exception:
        raise HTTPException(status_code=422, detail="Ungültiges JSON")

    name = data.get("name", "")
    variables = data.get("variables", {})
    if not name or not isinstance(variables, dict):
        raise HTTPException(status_code=422, detail="Pflichtfelder fehlen: name, variables")

    try:
        result = await theme_service.upload_theme(name, variables, admin.username)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return ThemeResponse(**result)


@router.post("", response_model=ThemeResponse, status_code=201)
async def create_theme(
    body: ThemeEditorRequest,
    admin: CurrentUser = Depends(require_admin),
) -> ThemeResponse:
    if not plus_behavior.can_use_theme_editor():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Plus-Lizenz erforderlich")
    try:
        result = await theme_service.create_theme(body.name, body.variables, admin.username)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return ThemeResponse(**result)


@router.put("/{theme_id}", response_model=ThemeResponse)
async def update_theme(
    theme_id: str,
    body: ThemeEditorRequest,
    _: CurrentUser = Depends(require_admin),
) -> ThemeResponse:
    if not plus_behavior.can_use_theme_editor():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Plus-Lizenz erforderlich")
    try:
        result = await theme_service.update_theme(theme_id, body.name, body.variables)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except LookupError:
        raise HTTPException(status_code=409, detail="Name bereits vergeben")
    if result is None:
        raise HTTPException(status_code=404, detail="Theme nicht gefunden")
    return ThemeResponse(**result)


@router.delete("/{theme_id}", status_code=204)
async def delete_theme(
    theme_id: str,
    _: CurrentUser = Depends(require_admin),
) -> Response:
    try:
        found = await theme_service.delete_theme(theme_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not found:
        raise HTTPException(status_code=404, detail="Theme nicht gefunden")
    return Response(status_code=204)


# ── User preferences (under /api/me, mounted separately via profile router) ──
# These are registered on a separate sub-router to match /api/me/preferences

preferences_router = APIRouter(prefix="/api/me", tags=["preferences"])


@preferences_router.get("/preferences", response_model=PreferencesResponse)
async def get_preferences(
    current_user: CurrentUser = Depends(get_current_user),
) -> PreferencesResponse:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT theme_preference, lang_preference FROM user_profiles WHERE username = :u"),
            {"u": current_user.username},
        )
        row = result.mappings().fetchone()
    if not row:
        return PreferencesResponse(theme_id=None, lang_code=None)
    return PreferencesResponse(
        theme_id=row["theme_preference"],
        lang_code=row["lang_preference"],
    )


@preferences_router.patch("/preferences", status_code=204)
async def set_preferences(
    body: PreferencesRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    async with get_db() as session:
        # Ensure user_profiles row exists (upsert)
        await session.execute(
            text(
                """INSERT INTO user_profiles (username, auth_type, theme_preference, lang_preference)
                   VALUES (:u, 'local', :theme, :lang)
                   ON CONFLICT(username) DO UPDATE SET
                       theme_preference = COALESCE(:theme, user_profiles.theme_preference),
                       lang_preference  = COALESCE(:lang,  user_profiles.lang_preference)"""
            ),
            {"u": current_user.username, "theme": body.theme_id, "lang": body.lang_code},
        )
        await session.commit()
    return Response(status_code=204)
