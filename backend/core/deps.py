# p3portal.org
from dataclasses import dataclass, field

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError

from backend.core.security import decode_access_token
from backend.services.proxmox_audit_service import portal_user_var

# auto_error=False: FastAPI's default wirft 403 bei falschem Schema (z.B. "ApiKey" statt "Bearer").
# Wir werfen selbst 401 (BUG-44-1).
_bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    username: str
    auth_type: str       # "proxmox" | "local"
    role: str            # "admin" | "operator" | "viewer"
    jti: str | None = field(default=None)
    must_change_pw: bool = field(default=False)
    portal_permissions: list = field(default_factory=list)  # e.g. ["view_logs"]
    user_id: int | None = field(default=None)  # PROJ-49: local_users.id (None für Proxmox-Auth)
    # PROJ-44: Auth-Quelle + Key-Scopes (nur bei upk_, sonst None)
    auth_kind: str = field(default="jwt")     # "jwt" | "upk"
    scopes: list[str] | None = field(default=None)
    api_key_id: int | None = field(default=None)


def _db_not_ready(exc: Exception) -> bool:
    """True, wenn die Exception ein 'Tabelle/Relation existiert nicht' ist
    (uninitialisierte DB / Tests), sonst False (echter DB-Fehler).

    Code-Review #6 (Option A): trennt den erwarteten Test-/Bootstrap-Fall vom
    echten DB-Fehler, damit der Session-Revocation-Check nur im ersten Fall
    fail-open ist und sonst fail-closed (siehe get_current_user).
    """
    m = str(exc).lower()
    return (
        "no such table" in m            # SQLite – Tabelle fehlt
        or "does not exist" in m        # PostgreSQL (relation ... does not exist)
        or "undefinedtable" in m        # PostgreSQL Fehlerklasse
        or "nicht initialisiert" in m   # database.get_db() vor init_db() (Bootstrap/Tests)
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    """FastAPI dependency – returns the authenticated user with role info."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = credentials.credentials

    # PROJ-24 / PROJ-44: User API Key authentication (upk_ prefix = personal user token)
    if token.startswith("upk_"):
        import asyncio
        from backend.services.user_api_key_service import (
            authenticate_user_key,
            touch_last_used,
        )
        try:
            key_info = await authenticate_user_key(token)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(exc),
                headers={"WWW-Authenticate": "Bearer"},
            )
        if key_info is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or missing API key",
                headers={"WWW-Authenticate": "Bearer"},
            )
        asyncio.ensure_future(touch_last_used(key_info["key_id"]))

        # PROJ-44: portal_permissions aus DB-Stammdaten (nicht aus Key-Scopes) lesen.
        # Scopes = was das Tool darf; portal_permissions = was der Mensch darf.
        upk_portal_perms: list = []
        upk_user_id: int | None = key_info.get("user_id")
        if upk_user_id is not None:
            try:
                import json as _json
                from backend.db.database import get_db as _get_db
                from sqlalchemy import text as _text
                async with _get_db() as _db:
                    _prow = await _db.execute(
                        _text("SELECT portal_permissions FROM local_users WHERE id = :uid"),
                        {"uid": upk_user_id},
                    )
                    _pr = _prow.fetchone()
                    if _pr and _pr[0]:
                        upk_portal_perms = _json.loads(_pr[0])
            except Exception:
                pass

        # PROJ-44: first-use Tracking (fire-and-forget)
        from backend.features.api_surface.audit import record_first_use
        asyncio.ensure_future(record_first_use(key_info["key_id"], upk_user_id))

        user = CurrentUser(
            username=key_info["username"],
            auth_type="local",
            role=key_info["role"],
            jti=None,
            must_change_pw=False,
            portal_permissions=upk_portal_perms,
            user_id=upk_user_id,
            auth_kind="upk",
            scopes=key_info["scopes"],
            api_key_id=key_info["key_id"],
        )
        portal_user_var.set(user.username)
        return user

    try:
        payload = decode_access_token(token)
        username: str | None = payload.get("sub")
        if not username:
            raise JWTError("missing sub")
        auth_type = payload.get("auth_type", "proxmox")
        role = payload.get("role", "operator")
        jti: str | None = payload.get("jti")
        must_change_pw: bool = bool(payload.get("must_change_pw", False))
        portal_permissions: list = payload.get("portal_permissions", [])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Session revocation check – only for tokens that carry a jti
    if jti:
        from backend.services.session_service import is_jti_revoked
        try:
            if await is_jti_revoked(jti):
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Session revoked",
                    headers={"WWW-Authenticate": "Bearer"},
                )
        except HTTPException:
            raise
        except Exception as exc:
            # Code-Review #6 (Option A): NUR den erwarteten "DB/Tabelle noch nicht da"-
            # Fall (uninitialisierte DB / Tests) durchlassen. Bei jedem anderen
            # DB-Fehler fail-closed: eine evtl. widerrufene Session darf nicht
            # ungeprüft weiterlaufen → 503 (Client retried, statt ausgeloggt zu
            # werden, da es ein transienter Server-/DB-Fehler ist).
            if not _db_not_ready(exc):
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Session konnte nicht verifiziert werden",
                )
            # sonst: Tabelle existiert noch nicht → wie bisher erlauben

    # PROJ-49: resolve local_users.id so permission checks can use user_id
    user_id: int | None = None
    if auth_type == "local":
        try:
            from backend.db.database import get_db
            from sqlalchemy import text as _text
            async with get_db() as _db:
                _row = await _db.execute(
                    _text("SELECT id FROM local_users WHERE username = :u"),
                    {"u": username},
                )
                _r = _row.fetchone()
                if _r:
                    user_id = _r[0]
        except Exception:
            pass  # DB not yet available (tests without full schema) – allow

    user = CurrentUser(
        username=username,
        auth_type=auth_type,
        role=role,
        jti=jti,
        must_change_pw=must_change_pw,
        portal_permissions=portal_permissions,
        user_id=user_id,
    )
    # PROJ-23: propagate portal username into the asyncio context so the httpx
    # audit event hook can include it when PROXMOX_AUDIT_DEBUG_USER is set.
    portal_user_var.set(user.username)
    return user


async def require_admin(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency: requires role == admin."""
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


async def require_operator(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency: requires role admin or operator (not viewer)."""
    if current_user.role not in ("admin", "operator"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operator privileges required",
        )
    return current_user


async def require_logs_access(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency: allows admins and users with view_logs portal permission."""
    if current_user.role == "admin":
        return current_user
    if "view_logs" in current_user.portal_permissions:
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Logs access required",
    )


async def require_not_restricted(
    current_user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Dependency: blocks restricted-role users from portal-wide features.

    restricted users may only access VM/LXC resources via RBAC assignments.
    """
    if current_user.auth_type == "local" and current_user.role == "restricted":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Restricted users cannot access this resource",
        )
    return current_user


def require_admin_or(permission: str):
    """Factory: returns a dependency that allows admin role OR the given portal permission."""
    async def _check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if current_user.role == "admin":
            return current_user
        if permission in current_user.portal_permissions:
            return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return _check
