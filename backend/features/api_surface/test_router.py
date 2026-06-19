# p3portal.org
"""Tests für PROJ-44: api_surface Router (GET /api/version + GET /api/scopes/manifest + GET /api/admin/external-calls)."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.api_surface.router import router as api_surface_router

app = FastAPI()
app.include_router(api_surface_router)

_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")
_OP_TOKEN = create_access_token("operator", auth_type="local", role="operator")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def patch_settings(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── GET /api/version ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_version_unauthenticated(client: AsyncClient):
    """GET /api/version ist öffentlich (kein Auth nötig)."""
    resp = await client.get("/api/version")
    assert resp.status_code == 200
    data = resp.json()
    assert "version" in data
    assert "api_compat_level" in data
    assert data["api_compat_level"] == "2"  # PROJ-97
    assert "edition" in data
    assert data["edition"] in ("core", "plus")


@pytest.mark.asyncio
async def test_version_authenticated(client: AsyncClient):
    resp = await client.get("/api/version", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["api_compat_level"] == "2"  # PROJ-97


# ── GET /api/scopes/manifest ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scopes_manifest_requires_auth(client: AsyncClient):
    resp = await client.get("/api/scopes/manifest")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_scopes_manifest_wrong_scheme_returns_401(client: AsyncClient):
    """BUG-44-1: 'Authorization: ApiKey ...' (falsches Schema) → 401, nicht 403."""
    resp = await client.get(
        "/api/scopes/manifest",
        headers={"Authorization": "ApiKey some_fake_key"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_scopes_manifest_admin(client: AsyncClient):
    resp = await client.get("/api/scopes/manifest", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    data = resp.json()
    assert "scopes" in data
    # Pflicht-Scopes aus dem Manifest vorhanden
    scope_names = {e["name"] for e in data["scopes"]}
    assert "cluster:read" in scope_names
    assert "jobs:read" in scope_names
    assert "jobs:write" in scope_names
    assert "packer:read" in scope_names
    assert "approvals:approve" in scope_names
    # allowed_scopes für JWT-User = [] (kein upk_-Key → kein Scope-Filter)
    assert "allowed_scopes" in data


@pytest.mark.asyncio
async def test_scopes_manifest_each_entry_has_required_fields(client: AsyncClient):
    resp = await client.get("/api/scopes/manifest", headers=_auth(_ADMIN_TOKEN))
    for entry in resp.json()["scopes"]:
        assert "name" in entry
        assert "description_key" in entry
        assert "endpoints" in entry
        assert isinstance(entry["endpoints"], list)


# ── GET /api/admin/external-calls ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_external_calls_requires_auth(client: AsyncClient):
    resp = await client.get("/api/admin/external-calls")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_external_calls_operator_forbidden(client: AsyncClient):
    resp = await client.get("/api/admin/external-calls", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_external_calls_admin_empty(client: AsyncClient):
    """Leere Tabelle → leere Liste, kein Fehler."""
    resp = await client.get("/api/admin/external-calls", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_external_calls_limit_param(client: AsyncClient):
    resp = await client.get("/api/admin/external-calls?limit=5", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
