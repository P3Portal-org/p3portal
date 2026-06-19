# p3portal.org
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.exc import IntegrityError

from backend.core.config import settings
from backend.core.deps import CurrentUser, get_current_user
from backend.core.security import create_access_token
from backend.models.auth import TokenResponse
from backend.models.profile import (
    GenerateKeyPairResponse,
    MyGroupEntry,
    PasswordChangeRequest,
    ProfileResponse,
    SessionResponse,
    SshJobKeyRequest,
    SshJobKeyStatus,
    SshKeyCreateRequest,
    SshKeyOut,
    SshKeyRequest,
    SshKeyResponse,
)
from backend.services.local_auth import change_own_password, get_user_by_username
from backend.services.profile_service import (
    add_ssh_key_entry,
    delete_ssh_job_key,
    delete_ssh_key,
    delete_ssh_key_entry,
    generate_ssh_job_keypair,
    get_ssh_job_key_status,
    get_ssh_job_public_key,
    get_ssh_key,
    get_user_profile,
    list_ssh_keys,
    set_ssh_job_key,
    set_ssh_key,
)
from backend.services.session_service import (
    list_active_sessions,
    revoke_all_except_jti,
    revoke_session_by_id,
    revoke_session_by_jti,
)

router = APIRouter(prefix="/api/me", tags=["profile"])


# ── Profile overview ──────────────────────────────────────────────────────────

@router.get("", response_model=ProfileResponse)
async def get_profile(current_user: CurrentUser = Depends(get_current_user)) -> ProfileResponse:
    profile = await get_user_profile(current_user.username)
    last_login_at = None
    last_login_ip = None

    if current_user.auth_type == "local":
        user = await get_user_by_username(current_user.username)
        if user:
            last_login_at = user.get("last_login_at")
            last_login_ip = user.get("last_login_ip")
    elif profile:
        last_login_at = profile.get("last_login_at")
        last_login_ip = profile.get("last_login_ip")

    # PROJ-45: Eigene Gruppen-Mitgliedschaften (nur lokale Nutzer)
    groups: list[MyGroupEntry] = []
    if current_user.auth_type == "local":
        try:
            from backend.features.groups.service import get_user_groups
            raw = await get_user_groups(current_user.username)
            groups = [MyGroupEntry(**g) for g in raw]
        except Exception:
            pass

    return ProfileResponse(
        username=current_user.username,
        auth_type=current_user.auth_type,
        role=current_user.role,
        must_change_pw=current_user.must_change_pw,
        last_login_at=last_login_at,
        last_login_ip=last_login_ip,
        groups=groups,
    )


# ── Password change ───────────────────────────────────────────────────────────

@router.patch("/password", response_model=TokenResponse)
async def change_password(
    body: PasswordChangeRequest,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
) -> TokenResponse:
    if current_user.auth_type != "local":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Passwortänderung nur für Portal-Accounts möglich",
        )
    ok = await change_own_password(
        current_user.username, body.current_password, body.new_password
    )
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Anmeldung fehlgeschlagen",
        )

    # PROJ-67 Phase 1 – F-003: Alle anderen Sessions invalidieren (andere Geräte/Browser)
    from backend.services.session_service import revoke_all_for_user
    await revoke_all_for_user(
        current_user.username, reason="self_password_change", except_jti=current_user.jti
    )
    # Revoke current session so old token becomes invalid
    if current_user.jti:
        await revoke_session_by_jti(current_user.jti)

    # Issue new token without must_change_pw flag
    new_jti = str(uuid.uuid4())
    expire = datetime.now(timezone.utc)
    from datetime import timedelta
    expire_str = (expire + timedelta(hours=settings.jwt_expire_hours)).isoformat()

    from backend.services.session_service import create_session
    client_ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    await create_session(current_user.username, new_jti, expire_str, client_ip, ua)

    token = create_access_token(
        current_user.username,
        auth_type="local",
        role=current_user.role,
        jti=new_jti,
        must_change_pw=False,
    )
    return TokenResponse(access_token=token)


# ── SSH key ───────────────────────────────────────────────────────────────────

@router.get("/ssh-key", response_model=SshKeyResponse)
async def get_my_ssh_key(
    current_user: CurrentUser = Depends(get_current_user),
) -> SshKeyResponse:
    key = await get_ssh_key(current_user.username)
    return SshKeyResponse(key=key)


@router.put("/ssh-key", status_code=204)
async def set_my_ssh_key(
    body: SshKeyRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    await set_ssh_key(current_user.username, current_user.auth_type, body.key)
    return Response(status_code=204)


@router.delete("/ssh-key", status_code=204)
async def delete_my_ssh_key(
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    await delete_ssh_key(current_user.username)
    return Response(status_code=204)


# ── SSH-Job-Key (privater Key für Scheduled-SSH-Jobs) ────────────────────────

@router.get("/ssh-job-key", response_model=SshJobKeyStatus)
async def get_my_ssh_job_key_status(
    current_user: CurrentUser = Depends(get_current_user),
) -> SshJobKeyStatus:
    has_key = await get_ssh_job_key_status(current_user.username)
    public_key = await get_ssh_job_public_key(current_user.username) if has_key else None
    return SshJobKeyStatus(has_key=has_key, public_key=public_key)


@router.put("/ssh-job-key", status_code=204)
async def set_my_ssh_job_key(
    body: SshJobKeyRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    await set_ssh_job_key(current_user.username, current_user.auth_type, body.private_key)
    return Response(status_code=204)


@router.delete("/ssh-job-key", status_code=204)
async def delete_my_ssh_job_key(
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    await delete_ssh_job_key(current_user.username)
    return Response(status_code=204)


@router.post("/ssh-job-key/generate", response_model=GenerateKeyPairResponse, status_code=201)
async def generate_my_ssh_job_key(
    current_user: CurrentUser = Depends(get_current_user),
) -> GenerateKeyPairResponse:
    public_key = await generate_ssh_job_keypair(current_user.username, current_user.auth_type)
    return GenerateKeyPairResponse(public_key=public_key)


# ── SSH keys (multi) ─────────────────────────────────────────────────────────

@router.get("/ssh-keys", response_model=list[SshKeyOut])
async def list_my_ssh_keys(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SshKeyOut]:
    keys = await list_ssh_keys(current_user.username)
    return [SshKeyOut(**k) for k in keys]


@router.post("/ssh-keys", response_model=SshKeyOut, status_code=201)
async def add_my_ssh_key(
    body: SshKeyCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> SshKeyOut:
    try:
        key_id = await add_ssh_key_entry(
            current_user.username, current_user.auth_type, body.label, body.key
        )
    except IntegrityError:
        # uq_user_ssh_keys (username, label) verletzt → doppeltes Label.
        # IntegrityError ist dialect-portabel (SQLite "UNIQUE constraint failed" +
        # PostgreSQL "duplicate key value violates unique constraint") — vorher
        # wurde nur die SQLite-Meldung gematcht → PG lieferte fälschlich 500.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Ein Key mit der Bezeichnung '{body.label}' existiert bereits.",
        )
    keys = await list_ssh_keys(current_user.username)
    entry = next((k for k in keys if k["id"] == key_id), None)
    if not entry:
        raise HTTPException(status_code=500, detail="Fehler beim Speichern des Keys")
    return SshKeyOut(**entry)


@router.delete("/ssh-keys/{key_id}", status_code=204)
async def delete_my_ssh_key_by_id(
    key_id: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    deleted = await delete_ssh_key_entry(current_user.username, key_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSH-Key nicht gefunden")
    return Response(status_code=204)


# ── Sessions ──────────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=list[SessionResponse])
async def get_sessions(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[SessionResponse]:
    rows = await list_active_sessions(current_user.username)
    return [
        SessionResponse(
            id=r["id"],
            created_at=r["created_at"],
            expires_at=r["expires_at"],
            ip_address=r["ip_address"],
            user_agent=r["user_agent"],
            is_current=(r["jti"] == current_user.jti),
        )
        for r in rows
    ]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    revoked = await revoke_session_by_id(session_id, current_user.username)
    if not revoked:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session nicht gefunden")
    return Response(status_code=204)


@router.delete("/sessions", status_code=204)
async def revoke_other_sessions(
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    if current_user.jti:
        await revoke_all_except_jti(current_user.username, current_user.jti)
    return Response(status_code=204)


# ── PROJ-36: Personal notification settings ───────────────────────────────────

_NOTIF_DEFAULTS = {
    "email_enabled": False,
    "email_address": None,
    "webhook_url": None,
    "webhook_token_set": False,
    "min_severity": "high",
}


@router.get("/notifications")
async def get_notification_settings(
    current_user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return the user's personal alert notification preferences.

    The stored webhook token is never returned in clear text; the client only
    sees ``webhook_token_set`` to render a "saved"-placeholder.
    """
    from backend.db.database import get_db
    from sqlalchemy import text
    user = await get_user_by_username(current_user.username)
    if not user:
        return dict(_NOTIF_DEFAULTS)
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM user_notification_settings WHERE user_id = :uid"),
            {"uid": user["id"]},
        )
        row = result.mappings().fetchone()
    if not row:
        return dict(_NOTIF_DEFAULTS)
    row_dict = dict(row)
    return {
        "email_enabled": bool(row_dict.get("email_enabled")),
        "email_address": row_dict.get("email_address"),
        "webhook_url": row_dict.get("webhook_url"),
        "webhook_receiver_type": row_dict.get("webhook_receiver_type") or "custom",
        "webhook_token_set": bool(row_dict.get("webhook_token")),
        "min_severity": row_dict.get("min_severity") or "high",
    }


@router.put("/notifications", status_code=204)
async def set_notification_settings(
    body: dict,
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Save the user's personal alert notification preferences.

    ``webhook_token`` handling:
      - absent in body          → keep existing token
      - non-empty string        → encrypt and replace
      - explicit ``null`` or empty string → clear the stored token
    """
    from backend.db.database import get_db
    from sqlalchemy import text
    from datetime import datetime, timezone
    user = await get_user_by_username(current_user.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    min_severity = body.get("min_severity", "high")
    if min_severity not in ("low", "medium", "high", "critical"):
        raise HTTPException(status_code=422, detail="min_severity must be low|medium|high|critical")
    now = datetime.now(timezone.utc).isoformat()

    # Resolve current token row first to support partial token updates.
    async with get_db() as session:
        cur = await session.execute(
            text("SELECT webhook_token FROM user_notification_settings WHERE user_id = :uid"),
            {"uid": user["id"]},
        )
        cur_row = cur.fetchone()
        existing_token_enc = cur_row[0] if cur_row else None

    if "webhook_token" in body:
        raw_token = body.get("webhook_token")
        if raw_token in (None, ""):
            new_token_enc = None
        else:
            from backend.services.config_service import encrypt_secret
            new_token_enc = encrypt_secret(str(raw_token))
    else:
        new_token_enc = existing_token_enc

    async with get_db() as session:
        await session.execute(
            text(
                "INSERT INTO user_notification_settings "
                "(user_id, email_enabled, email_address, webhook_url, webhook_token, webhook_receiver_type, min_severity, updated_at) "
                "VALUES (:uid, :email_enabled, :email_address, :webhook_url, :webhook_token, :webhook_receiver_type, :min_severity, :now) "
                "ON CONFLICT(user_id) DO UPDATE SET "
                "email_enabled=excluded.email_enabled, email_address=excluded.email_address, "
                "webhook_url=excluded.webhook_url, webhook_token=excluded.webhook_token, "
                "webhook_receiver_type=excluded.webhook_receiver_type, "
                "min_severity=excluded.min_severity, updated_at=excluded.updated_at"
            ),
            {
                "uid": user["id"],
                "email_enabled": 1 if body.get("email_enabled") else 0,
                "email_address": body.get("email_address"),
                "webhook_url": body.get("webhook_url"),
                "webhook_token": new_token_enc,
                "webhook_receiver_type": body.get("webhook_receiver_type") or "custom",
                "min_severity": min_severity,
                "now": now,
            },
        )
        await session.commit()
    return Response(status_code=204)
