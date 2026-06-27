# p3portal.org
"""Tests für PROJ-97: Default-Deny-Türsteher + Scope-Marker + Inventur.

Deckt ab:
- Scope-Marker an require_scope_for_upk (inkl. Alias-Auflösung)
- Inventur erkennt scope-tragende Routen (auch via dependencies=[...] und Pfad-Parameter)
- JWT → No-Op (Türsteher + Scope-Gate)
- upk_ mit/ohne Scope auf scope-tragender Route → erlaubt / 403
- Default-Deny: upk_ auf ungescopter, nicht-exempter Route → 403
- Ausnahmeliste: upk_ ohne Scope auf /api/version → erreichbar
- Edition-Reihenfolge: gültiger Scope + 404-im-Body → 404 (nicht 403)
"""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI, HTTPException, WebSocket
from httpx import ASGITransport, AsyncClient

from backend.core.deps import CurrentUser, get_current_user
from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.api_surface.deps import (
    UPK_SCOPE_MARKER_ATTR,
    require_scope_for_upk,
)
from backend.features.api_surface.default_deny import (
    EXEMPT_UPK_PATHS,
    NO_SCOPE_MARKER,
    _SCOPED_ENDPOINTS,
    build_scoped_endpoint_inventory,
    upk_doorman,
)


@pytest.fixture(autouse=True)
def patch_settings(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def db():
    await init_db()


def _make_app() -> FastAPI:
    """Kleine App mit globalem Türsteher: 1 scope-tragende, 1 ungescopte,
    1 exempte und 1 404-im-Body-Route."""
    app = FastAPI(dependencies=[Depends(upk_doorman)])

    @app.get("/scoped", dependencies=[Depends(require_scope_for_upk("widget:read"))])
    async def scoped(u: CurrentUser = Depends(get_current_user)):
        return {"auth_kind": u.auth_kind}

    @app.get("/scoped/{item_id}", dependencies=[Depends(require_scope_for_upk("widget:read"))])
    async def scoped_param(item_id: int, u: CurrentUser = Depends(get_current_user)):
        return {"item": item_id}

    @app.get("/unscoped")
    async def unscoped(u: CurrentUser = Depends(get_current_user)):
        return {"ok": True}

    @app.get("/api/version")
    async def version():
        return {"v": "test"}

    @app.get("/plusish", dependencies=[Depends(require_scope_for_upk("widget:read"))])
    async def plusish(u: CurrentUser = Depends(get_current_user)):
        # simuliert _check_plus(): Edition-Gate im Funktionskörper → 404
        raise HTTPException(status_code=404, detail="not_found")

    build_scoped_endpoint_inventory(app)
    return app


def _fake_upk(scopes: list[str]):
    def _dep():
        return CurrentUser(
            username="key-owner",
            role="operator",
            auth_type="local",
            auth_kind="upk",
            scopes=scopes,
            api_key_id=7,
            user_id=1,
        )
    return _dep


# ── Marker ───────────────────────────────────────────────────────────────────

def test_require_scope_sets_marker():
    dep = require_scope_for_upk("widget:read")
    assert getattr(dep, UPK_SCOPE_MARKER_ATTR) == "widget:read"


def test_require_scope_marker_resolves_alias():
    dep = require_scope_for_upk("jobs:start")
    assert getattr(dep, UPK_SCOPE_MARKER_ATTR) == "jobs:write"


# ── Inventur ─────────────────────────────────────────────────────────────────

def test_inventory_detects_scoped_routes():
    app = _make_app()
    paths = {r.path for r in app.routes if getattr(r, "endpoint", None) in _SCOPED_ENDPOINTS}
    assert "/scoped" in paths
    assert "/scoped/{item_id}" in paths
    assert "/plusish" in paths
    # ungescopte + exempte Routen sind NICHT erfasst
    assert "/unscoped" not in paths
    assert "/api/version" not in paths


# ── JWT = No-Op (Türsteher + Scope-Gate) ──────────────────────────────────────

@pytest.mark.asyncio
async def test_jwt_passes_unscoped_route(db):
    """JWT-Session: Türsteher ist No-Op auch auf ungescopten Routen."""
    app = _make_app()
    token = create_access_token("op", auth_type="proxmox", role="operator")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/unscoped", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_jwt_passes_scoped_route_without_scope(db):
    """JWT braucht keinen Scope (Scope-Gate No-Op)."""
    app = _make_app()
    token = create_access_token("op", auth_type="proxmox", role="operator")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/scoped", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["auth_kind"] == "jwt"


# ── upk_ auf scope-tragender Route ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_upk_with_scope_allowed(db):
    app = _make_app()
    app.dependency_overrides[get_current_user] = _fake_upk(["widget:read"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/scoped", headers={"Authorization": "Bearer upk_testtoken"})
    assert resp.status_code == 200
    assert resp.json()["auth_kind"] == "upk"


@pytest.mark.asyncio
async def test_upk_missing_scope_on_scoped_route_403(db):
    app = _make_app()
    app.dependency_overrides[get_current_user] = _fake_upk(["other:read"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/scoped", headers={"Authorization": "Bearer upk_testtoken"})
    assert resp.status_code == 403
    assert "scope" in resp.json()["detail"].lower()


# ── Default-Deny ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_default_deny_upk_on_unscoped_route(db):
    """upk_ auf einer Route OHNE Scope und nicht exempt → 403 (Türsteher)."""
    app = _make_app()
    # get_current_user wird NICHT überschrieben – der Türsteher feuert vor jeder Auth.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/unscoped", headers={"Authorization": "Bearer upk_testtoken"})
    assert resp.status_code == 403
    assert "scope" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_exempt_path_reachable_for_upk_without_scope(db):
    """Ausnahmeliste: upk_ ohne Scope auf /api/version → erreichbar."""
    assert "/api/version" in EXEMPT_UPK_PATHS
    app = _make_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/api/version", headers={"Authorization": "Bearer upk_testtoken"})
    assert resp.status_code == 200
    assert resp.json()["v"] == "test"


@pytest.mark.asyncio
@pytest.mark.parametrize("scheme", ["bearer", "BEARER", "BeArEr"])
async def test_default_deny_case_insensitive_bearer(db, scheme):
    """BUG-97-1: Default-Deny darf NICHT über case-insensitives Bearer-Scheme umgehbar sein.

    HTTPBearer akzeptiert das Scheme case-insensitiv – der Türsteher muss das ebenso
    tun, sonst erreicht ein `bearer upk_…` (klein) jede ungescopte Route.
    """
    app = _make_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/unscoped", headers={"Authorization": f"{scheme} upk_testtoken"})
    assert resp.status_code == 403, f"Bypass über Scheme {scheme!r}"
    assert "scope" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_case_insensitive_bearer_still_allows_scoped(db):
    """Gegenprobe: lowercase `bearer` bricht legitimen Scope-Zugriff NICHT (Türsteher aktiv,
    Route ist scoped → durch zum Scope-Gate)."""
    app = _make_app()
    app.dependency_overrides[get_current_user] = _fake_upk(["widget:read"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/scoped", headers={"Authorization": "bearer upk_testtoken"})
    assert resp.status_code == 200
    assert resp.json()["auth_kind"] == "upk"


@pytest.mark.asyncio
async def test_no_auth_header_is_noop(db):
    """Ohne Authorization-Header ist der Türsteher inaktiv (Route-Auth entscheidet)."""
    app = _make_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/api/version")  # exempt + keine Auth → 200
    assert resp.status_code == 200


# ── Edition-Reihenfolge (Tech-Design E/N) ─────────────────────────────────────

@pytest.mark.asyncio
async def test_valid_scope_then_404_in_body(db):
    """Gültiger Scope + 404 im Funktionskörper → 404 (nicht 403).

    Spiegelt einen Plus-Endpoint im Core-Mode mit gültigem Scope (Edition vor Wert).
    """
    app = _make_app()
    app.dependency_overrides[get_current_user] = _fake_upk(["widget:read"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/plusish", headers={"Authorization": "Bearer upk_testtoken"})
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_missing_scope_beats_404_body(db):
    """Falscher Scope → 403 noch vor dem 404-Body (Scope-Gate vor Funktionskörper)."""
    app = _make_app()
    app.dependency_overrides[get_current_user] = _fake_upk(["other:read"])
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        resp = await ac.get("/plusish", headers={"Authorization": "Bearer upk_testtoken"})
    assert resp.status_code == 403


def test_no_scope_marker_distinct():
    """Default-Deny-Audit-Marker ist von echten Scope-Namen unterscheidbar (AC-DENY-4)."""
    assert NO_SCOPE_MARKER == "<no-scope-declared>"
    assert ":" not in NO_SCOPE_MARKER.replace("<", "").replace(">", "")  # kein scope-artiger Name


# ── Manifest-Vollständigkeit der neuen Scopes (AC-SCOPE-1) ────────────────────

_NEW_SCOPES = {
    "backup_jobs:read": False, "backup_jobs:write": False,
    "networks:read": False, "networks:write": False,
    "sdn:read": False, "sdn:write": False,
    "firewall:read": False, "firewall:write": False,
    "vms:write": False,
    "ansible_inventory:read": False, "ansible_inventory:write": False,
    "packer_editor:read": True, "packer_editor:write": True,
    "ansible_editor:read": True, "ansible_editor:write": True,
}


def test_new_scopes_in_manifest_with_correct_plus_flag():
    from backend.features.api_surface.manifest import SCOPE_MANIFEST_BY_NAME
    for name, plus_only in _NEW_SCOPES.items():
        entry = SCOPE_MANIFEST_BY_NAME.get(name)
        assert entry is not None, f"Scope {name!r} fehlt im Manifest"
        assert entry.plus_only is plus_only, f"Scope {name!r} hat falsches plus_only ({entry.plus_only})"
        assert len(entry.endpoints) > 0, f"Scope {name!r} hat keine Endpoints"
        assert entry.curl_example, f"Scope {name!r} hat kein curl_example"


# ── WebSocket-Regression: Türsteher darf WS-Upgrades nicht abreißen ───────────
# Der app-globale upk_doorman wird von FastAPI auch auf WebSocket-Routen
# angewandt. Vor dem Fix verlangte er zwingend `request: Request`, das bei einem
# WS-Handshake nie injiziert wird → Dependency-Auflösung brach → JEDER WebSocket
# wurde abgewiesen (Job-Live-Logs, Stack-Deploy-Live-Log: „Warte auf Ausgabe…").

def _make_ws_app() -> FastAPI:
    app = FastAPI(dependencies=[Depends(upk_doorman)])

    @app.websocket("/ws")
    async def ws_echo(websocket: WebSocket):
        await websocket.accept()
        msg = await websocket.receive_text()
        await websocket.send_text(f"echo:{msg}")
        await websocket.close()

    return app


def test_websocket_upgrade_passes_doorman():
    """WS-Handshake gelingt trotz globalem upk_doorman (No-Op für WS)."""
    from fastapi.testclient import TestClient
    client = TestClient(_make_ws_app())
    with client.websocket_connect("/ws") as ws:
        ws.send_text("hello")
        assert ws.receive_text() == "echo:hello"
