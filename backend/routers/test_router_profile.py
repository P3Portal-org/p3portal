# p3portal.org
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.admin import router as admin_router
from backend.routers.auth import router as auth_router
from backend.routers.profile import router as profile_router

app = FastAPI()
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(profile_router)

_LOCAL_TOKEN  = create_access_token("localuser",  auth_type="local",   role="operator")
_ADMIN_TOKEN  = create_access_token("admin",       auth_type="local",   role="admin")
_PROXMOX_TOKEN = create_access_token("px@pam",     auth_type="proxmox", role="operator")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client(tmp_path):
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def client_with_user(tmp_path):
    await init_db()
    from backend.services.local_auth import create_user
    await create_user("localuser", "Password1234", "operator")
    await create_user("admin", "AdminPass1234", "admin")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── GET /api/me/profile ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_profile_local(client: AsyncClient):
    resp = await client.get("/api/me", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 200
    data = resp.json()
    assert data["username"] == "localuser"
    assert data["auth_type"] == "local"
    assert data["must_change_pw"] is False


@pytest.mark.asyncio
async def test_get_profile_unauthorized(client: AsyncClient):
    resp = await client.get("/api/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_profile_proxmox(client: AsyncClient):
    resp = await client.get("/api/me", headers=_auth(_PROXMOX_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["auth_type"] == "proxmox"


# ── SSH Key ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_ssh_key_empty(client: AsyncClient):
    resp = await client.get("/api/me/ssh-key", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["key"] is None


@pytest.mark.asyncio
async def test_set_and_get_ssh_key(client: AsyncClient):
    key = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA test-key"
    resp = await client.put("/api/me/ssh-key", json={"key": key}, headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 204

    resp = await client.get("/api/me/ssh-key", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["key"] == key


@pytest.mark.asyncio
async def test_set_ssh_key_invalid_format(client: AsyncClient):
    resp = await client.put(
        "/api/me/ssh-key",
        json={"key": "not-a-valid-key"},
        headers=_auth(_LOCAL_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_delete_ssh_key(client: AsyncClient):
    key = "ssh-rsa AAAAB3NzaC1yc2EAAAA test"
    await client.put("/api/me/ssh-key", json={"key": key}, headers=_auth(_LOCAL_TOKEN))
    resp = await client.delete("/api/me/ssh-key", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 204
    resp = await client.get("/api/me/ssh-key", headers=_auth(_LOCAL_TOKEN))
    assert resp.json()["key"] is None


# ── SSH keys (multi) ─────────────────────────────────────────────────────────

_VALID_KEY_1 = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA key-one"
_VALID_KEY_2 = "ssh-rsa AAAAB3NzaC1yc2EAAAA key-two"


@pytest.mark.asyncio
async def test_list_ssh_keys_empty(client: AsyncClient):
    resp = await client.get("/api/me/ssh-keys", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_add_ssh_key(client: AsyncClient):
    resp = await client.post(
        "/api/me/ssh-keys",
        json={"label": "Laptop", "key": _VALID_KEY_1},
        headers=_auth(_LOCAL_TOKEN),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["label"] == "Laptop"
    assert data["public_key"] == _VALID_KEY_1
    assert "id" in data
    assert "created_at" in data


@pytest.mark.asyncio
async def test_add_multiple_ssh_keys(client: AsyncClient):
    await client.post("/api/me/ssh-keys", json={"label": "Laptop", "key": _VALID_KEY_1}, headers=_auth(_LOCAL_TOKEN))
    await client.post("/api/me/ssh-keys", json={"label": "Desktop", "key": _VALID_KEY_2}, headers=_auth(_LOCAL_TOKEN))

    resp = await client.get("/api/me/ssh-keys", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 200
    keys = resp.json()
    assert len(keys) == 2
    labels = {k["label"] for k in keys}
    assert labels == {"Laptop", "Desktop"}


@pytest.mark.asyncio
async def test_add_ssh_key_invalid_format(client: AsyncClient):
    resp = await client.post(
        "/api/me/ssh-keys",
        json={"label": "Test", "key": "not-a-valid-key"},
        headers=_auth(_LOCAL_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_add_ssh_key_empty_label(client: AsyncClient):
    resp = await client.post(
        "/api/me/ssh-keys",
        json={"label": "", "key": _VALID_KEY_1},
        headers=_auth(_LOCAL_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_add_ssh_key_duplicate_label(client: AsyncClient):
    await client.post("/api/me/ssh-keys", json={"label": "Laptop", "key": _VALID_KEY_1}, headers=_auth(_LOCAL_TOKEN))
    resp = await client.post(
        "/api/me/ssh-keys",
        json={"label": "Laptop", "key": _VALID_KEY_2},
        headers=_auth(_LOCAL_TOKEN),
    )
    # AC-SSH-1: doppeltes Label → 409 (nicht 500), dialect-portabel SQLite+PostgreSQL
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_delete_ssh_key_entry(client: AsyncClient):
    r = await client.post("/api/me/ssh-keys", json={"label": "Work", "key": _VALID_KEY_1}, headers=_auth(_LOCAL_TOKEN))
    key_id = r.json()["id"]

    resp = await client.delete(f"/api/me/ssh-keys/{key_id}", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 204

    resp = await client.get("/api/me/ssh-keys", headers=_auth(_LOCAL_TOKEN))
    assert resp.json() == []


@pytest.mark.asyncio
async def test_delete_ssh_key_not_found(client: AsyncClient):
    resp = await client.delete("/api/me/ssh-keys/9999", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_other_users_key(client: AsyncClient):
    r = await client.post("/api/me/ssh-keys", json={"label": "Mine", "key": _VALID_KEY_1}, headers=_auth(_LOCAL_TOKEN))
    key_id = r.json()["id"]

    # Admin tries to delete localuser's key via the /me endpoint
    resp = await client.delete(f"/api/me/ssh-keys/{key_id}", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 404


# ── Password change ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_change_password_success(client_with_user: AsyncClient):
    token = create_access_token("localuser", auth_type="local", role="operator")
    resp = await client_with_user.patch(
        "/api/me/password",
        json={"current_password": "Password1234", "new_password": "NewSecure5678"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert "access_token" in resp.json()


@pytest.mark.asyncio
async def test_change_password_wrong_current(client_with_user: AsyncClient):
    token = create_access_token("localuser", auth_type="local", role="operator")
    resp = await client_with_user.patch(
        "/api/me/password",
        json={"current_password": "WrongPassword", "new_password": "NewSecure5678"},
        headers=_auth(token),
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_change_password_too_short(client_with_user: AsyncClient):
    token = create_access_token("localuser", auth_type="local", role="operator")
    resp = await client_with_user.patch(
        "/api/me/password",
        json={"current_password": "Password1234", "new_password": "short"},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_change_password_proxmox_forbidden(client: AsyncClient):
    resp = await client.patch(
        "/api/me/password",
        json={"current_password": "anything", "new_password": "NewSecure5678"},
        headers=_auth(_PROXMOX_TOKEN),
    )
    assert resp.status_code == 403


# ── Sessions ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_sessions_empty(client: AsyncClient):
    resp = await client.get("/api/me/sessions", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_sessions_created_after_login(client_with_user: AsyncClient):
    resp = await client_with_user.post(
        "/api/auth/login/local",
        json={"username": "localuser", "password": "Password1234"},
    )
    assert resp.status_code == 200
    token = resp.json()["access_token"]

    resp = await client_with_user.get("/api/me/sessions", headers=_auth(token))
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) >= 1
    current = [s for s in sessions if s["is_current"]]
    assert len(current) == 1


@pytest.mark.asyncio
async def test_revoke_unknown_session(client: AsyncClient):
    resp = await client.delete("/api/me/sessions/nonexistent", headers=_auth(_LOCAL_TOKEN))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_revoke_other_sessions(client_with_user: AsyncClient):
    # Login twice to create two sessions
    r1 = await client_with_user.post(
        "/api/auth/login/local", json={"username": "localuser", "password": "Password1234"}
    )
    r2 = await client_with_user.post(
        "/api/auth/login/local", json={"username": "localuser", "password": "Password1234"}
    )
    token2 = r2.json()["access_token"]

    # Revoke all except current (token2)
    resp = await client_with_user.delete("/api/me/sessions", headers=_auth(token2))
    assert resp.status_code == 204

    # token1 should now be revoked
    token1 = r1.json()["access_token"]
    resp = await client_with_user.get("/api/me/sessions", headers=_auth(token1))
    assert resp.status_code == 401
