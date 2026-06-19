# p3portal.org
"""PROJ-44: require_scope_for_upk() – Scope-Vor-Filter für upk_-Aufrufe.

Pattern: Scope = Vor-Filter · RBAC = Endschranke (Tech-Design C).
Für JWT-Sessions ist diese Dependency ein No-Op.
"""
from __future__ import annotations

import asyncio

from fastapi import Depends, HTTPException, Request, status

from backend.core.deps import CurrentUser, get_current_user
from backend.features.api_surface.manifest import SCOPE_ALIASES

# PROJ-97: Marker-Attribut, das jede von require_scope_for_upk() erzeugte Dependency
# trägt. Der Default-Deny-"Türsteher" (default_deny.py) liest dieses Attribut beim
# Start-Inventar aus, um scope-tragende Routen zu erkennen. Wert = kanonischer Scope.
UPK_SCOPE_MARKER_ATTR = "_upk_scope_required"


def require_scope_for_upk(scope: str):
    """Factory: gibt eine FastAPI-Dependency zurück, die den Scope *scope* erzwingt,
    aber nur wenn der Request via upk_ authentifiziert wurde (auth_kind='upk').

    Für JWT-Sessions ist es ein No-Op (AC-5).
    Alias-Mapping: jobs:start ≙ jobs:write, packer:start ≙ packer:write (Tech-Design C).
    """
    # Kanonischer Scope-Name (falls Alias übergeben wurde)
    canonical = SCOPE_ALIASES.get(scope, scope)

    async def _check(
        request: Request,
        current_user: CurrentUser = Depends(get_current_user),
    ) -> CurrentUser:
        if current_user.auth_kind != "upk":
            # JWT-Session: No-Op
            return current_user

        # Aufgelöste Key-Scopes (mit Alias-Mapping)
        user_scopes = current_user.scopes or []
        resolved_scopes = {SCOPE_ALIASES.get(s, s) for s in user_scopes}

        if canonical not in resolved_scopes:
            # Scope-Denied: fire-and-forget Audit-Event
            from backend.features.api_surface.audit import record_scope_denied
            asyncio.ensure_future(
                record_scope_denied(
                    key_id=current_user.api_key_id or 0,
                    user_id=current_user.user_id,
                    scope_required=canonical,
                    endpoint=str(request.url.path),
                    method=request.method,
                )
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient scope – '{canonical}' required",
            )

        return current_user

    # PROJ-97: Markierung für den Default-Deny-Türsteher (siehe default_deny.py).
    # Bestehende Endpoints, die das Gate nutzen, werden dadurch automatisch als
    # "scope-tragend" erkannt – ohne dass sie angefasst werden müssen.
    setattr(_check, UPK_SCOPE_MARKER_ATTR, canonical)
    return _check
