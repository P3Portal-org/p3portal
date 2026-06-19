# p3portal.org
"""PROJ-83: Router-Tests (Auth/RBAC/404-Gates, Services gemockt)."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.ansible_inventory import inventory as inv
from backend.features.ansible_inventory.router import router

app = FastAPI()
app.include_router(router)

_OP = create_access_token("op", auth_type="local", role="operator")
_ADMIN = create_access_token("admin", auth_type="local", role="admin")
_H_OP = {"Authorization": f"Bearer {_OP}"}
_H_ADMIN = {"Authorization": f"Bearer {_ADMIN}"}


@pytest.fixture(autouse=True)
def _data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


def _result(error=None, entries=None):
    r = inv.InventoryResult(scope="user", scope_ref=None)
    r.error = error
    r.entries = entries or []
    return r


@pytest.mark.asyncio
async def test_list_hosts_requires_auth(client):
    assert (await client.get("/api/ansible-inventory/hosts")).status_code == 401


@pytest.mark.asyncio
async def test_list_hosts_user_scope_ok(client):
    from backend.core.deps import CurrentUser, get_current_user
    e = inv.HostEntry("1:101:qemu", 1, "pve1", 101, "qemu", "managed", "10.0.0.1", "p3-ansible")
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        username="op", auth_type="local", role="operator", user_id=5
    )
    try:
        with patch.object(inv, "build_inventory", new=AsyncMock(return_value=_result(entries=[e]))):
            resp = await client.get("/api/ansible-inventory/hosts?scope=user", headers=_H_OP)
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 200
    body = resp.json()
    assert body["hosts"][0]["host_ref"] == "1:101:qemu"
    assert body["hosts"][0]["group"] == "managed"


@pytest.mark.asyncio
async def test_list_hosts_pool_scope_404_in_core(client):
    resp = await client.get("/api/ansible-inventory/hosts?scope=pool&scope_ref=1", headers=_H_OP)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_list_hosts_invalid_scope_422(client):
    resp = await client.get("/api/ansible-inventory/hosts?scope=bogus", headers=_H_OP)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_block_invalid_scope(client):
    resp = await client.get("/api/ansible-inventory/onboarding-block?scope=bogus", headers=_H_OP)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_onboarding_block_pool_404_in_core(client):
    resp = await client.get(
        "/api/ansible-inventory/onboarding-block?scope=pool&scope_ref=1", headers=_H_OP
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_reset_host_key_invalid_kind(client):
    resp = await client.post(
        "/api/ansible-inventory/hosts/1/bogus/101/reset-host-key", headers=_H_ADMIN
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_reset_host_key_admin_ok(client):
    with patch("backend.features.ansible_inventory.router.host_state.reset_host_key",
               new=AsyncMock(return_value=True)), \
         patch("backend.features.ansible_inventory.router.write_audit_log", new=AsyncMock()):
        resp = await client.post(
            "/api/ansible-inventory/hosts/1/qemu/101/reset-host-key", headers=_H_ADMIN
        )
    assert resp.status_code == 200
    assert resp.json()["detail"] == "reset"


@pytest.mark.asyncio
async def test_reset_host_key_non_owner_403(client):
    # operator ohne manage_ansible_inventory, kein Owner → 403
    with patch("backend.features.owners.service.is_owner", new=AsyncMock(return_value=False)):
        resp = await client.post(
            "/api/ansible-inventory/hosts/1/qemu/101/reset-host-key", headers=_H_OP
        )
    assert resp.status_code == 403
