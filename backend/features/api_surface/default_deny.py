# p3portal.org
"""PROJ-97: Default-Deny-"Türsteher" für upk_-API-Keys.

Kehrt das Sicherheitsmodell um: Standard = verboten. Ein `upk_`-Key erreicht nur
noch Endpoints, die bewusst einen Scope deklarieren (über `require_scope_for_upk`),
plus eine kleine Ausnahmeliste reiner Meta-/Selbstauskunft.

Mechanik (Tech-Design A/B):
1. Beim Start läuft `build_scoped_endpoint_inventory(app)` einmal durch alle Routen
   und merkt sich die Endpoint-Funktionen, deren Dependency-Baum den
   `UPK_SCOPE_MARKER_ATTR`-Marker trägt → `_SCOPED_ENDPOINTS`.
2. `upk_doorman` ist eine globale Dependency. Sie greift NUR bei `Authorization:
   Bearer upk_…` (JWT/öffentliche EPs = No-Op). Trifft ein upk_-Request eine Route
   ohne Scope und nicht auf der Ausnahmeliste → 403 + Audit-Marker.

Die eigentliche *Scope-Wert*-Prüfung ("hat der Key genau firewall:write?") bleibt am
per-Endpoint-Gate (`require_scope_for_upk`). Beide Schichten ergänzen sich.
"""
from __future__ import annotations

import asyncio
import logging

from fastapi import HTTPException, Request, status

from backend.features.api_surface.deps import UPK_SCOPE_MARKER_ATTR

logger = logging.getLogger(__name__)

# Endpoints, die ein upk_-Key OHNE Scope erreichen darf (reine Meta-/Selbstauskunft,
# kein Ressourcenzugriff). Bewusst minimal (Tech-Design F). Pfade matchen exakt gegen
# request.url.path (Routen ohne Pfad-Parameter).
EXEMPT_UPK_PATHS: frozenset[str] = frozenset({
    "/api/version",
    "/api/scopes/manifest",
})

# Marker im audit-Event scope_required, der "Route deklariert gar keinen Scope"
# von einer echten Scope-Ablehnung unterscheidbar macht (AC-DENY-4, Tech-Design G).
NO_SCOPE_MARKER = "<no-scope-declared>"

# Beim Start befüllte Menge der scope-tragenden Endpoint-Funktionen.
# Starlette legt die getroffene Endpoint-Funktion unter scope["endpoint"] ab
# (siehe Route.matches → child_scope), daher Identitätsvergleich gegen route.endpoint.
_SCOPED_ENDPOINTS: set = set()


def _dependant_has_scope(dependant) -> bool:
    """Rekursiv: trägt irgendeine Dependency im Baum den Scope-Marker?"""
    call = getattr(dependant, "call", None)
    if call is not None and getattr(call, UPK_SCOPE_MARKER_ATTR, None) is not None:
        return True
    for sub in getattr(dependant, "dependencies", None) or []:
        if _dependant_has_scope(sub):
            return True
    return False


def build_scoped_endpoint_inventory(app) -> int:
    """Einmal beim Hochfahren aufrufen (nach allen include_router).

    Geht alle APIRoutes durch und merkt sich die Endpoint-Funktionen, deren
    Dependency-Baum eine `require_scope_for_upk`-Markierung enthält. Idempotent.
    Gibt die Anzahl der erfassten scope-tragenden Routen zurück.
    """
    from fastapi.routing import APIRoute

    _SCOPED_ENDPOINTS.clear()
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        dependant = getattr(route, "dependant", None)
        if dependant is not None and _dependant_has_scope(dependant):
            _SCOPED_ENDPOINTS.add(route.endpoint)
    logger.info("PROJ-97: Default-Deny aktiv – %d scope-tragende Routen erfasst", len(_SCOPED_ENDPOINTS))
    return len(_SCOPED_ENDPOINTS)


async def _audit_no_scope(token: str, request: Request) -> None:
    """Fire-and-forget: Default-Deny-Ablehnung protokollieren (Tech-Design G).

    Resolved den Key NICHT (kein DB-Hit auf dem Deny-Pfad); legt stattdessen das
    Anzeige-Präfix des Tokens als note ab, damit der Betreiber den Key über
    user_api_keys.key_prefix zuordnen kann.
    """
    from backend.features.api_surface.audit import record_scope_denied

    prefix = token[:12]  # "upk_" + 8 Zeichen = key_prefix in der DB
    await record_scope_denied(
        key_id=0,
        user_id=None,
        scope_required=NO_SCOPE_MARKER,
        endpoint=str(request.url.path),
        method=request.method,
        note=f"key_prefix={prefix}",
    )


async def upk_doorman(request: Request) -> None:
    """Globale Dependency: Default-Deny für upk_-Keys auf ungescopten Routen.

    No-Op für JWT-Sessions und öffentliche Endpoints (kein upk_-Token im Header).

    WICHTIG (BUG-97-1): Der Authorization-Header wird **identisch zu HTTPBearer**
    geparst – Scheme case-insensitiv (`scheme.lower() == "bearer"`, siehe
    fastapi/security/http.py), Credentials nach dem ersten Leerzeichen. Ein
    case-sensitiver `startswith("Bearer upk_")` würde sonst über ein
    kleingeschriebenes `bearer upk_…` umgangen, während get_current_user den Key
    via HTTPBearer trotzdem authentifiziert → Default-Deny-Bypass.
    """
    auth = request.headers.get("Authorization", "")
    # Gleiche Zerlegung wie HTTPBearer (get_authorization_scheme_param: partition(" ")).
    scheme, _, credentials = auth.partition(" ")
    if scheme.lower() != "bearer" or not credentials.startswith("upk_"):
        return  # JWT / öffentlich / kein upk_ → Türsteher inaktiv

    path = request.url.path
    if path in EXEMPT_UPK_PATHS:
        return

    endpoint = request.scope.get("endpoint")
    if endpoint is not None and endpoint in _SCOPED_ENDPOINTS:
        # Route deklariert einen Scope → der per-Endpoint-Gate prüft den Wert.
        return

    # Default-Deny: upk_ auf einer Route ohne Scope und nicht auf der Ausnahmeliste.
    asyncio.ensure_future(_audit_no_scope(credentials, request))
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This endpoint is not available to API keys (no scope declared)",
    )
