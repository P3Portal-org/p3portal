# p3portal.org
"""PROJ-84: Onboarding bestehender Hosts (Core-Seite).

Deckt: host_state.set_managed (kein global_opt_in-Clobber), permissions.assert_owner_or_manage,
Core-Router mark-managed + test-connection, inventory.build_discovery (managed/unmanaged/in_run_scope
AC-RUN-2 / IP-nur-für-managed) + _node_run_scope_sets-Guard.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from backend.core.deps import CurrentUser, get_current_user
from backend.core.security import create_access_token
from backend.db.database import get_db, init_db
from backend.features.ansible_inventory import host_state as hs
from backend.features.ansible_inventory import inventory as inv
from backend.features.ansible_inventory import permissions as perms
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
async def db():
    await init_db()
    async with get_db() as s:
        await s.execute(text(
            "INSERT INTO nodes (id, name, url, proxmox_node, created_at) "
            "VALUES (1, 'n1', 'https://pve:8006', 'pve1', '2026-01-01')"
        ))
        await s.commit()
    yield


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── host_state.set_managed ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_set_managed_does_not_clobber_global(db):
    await hs.upsert_host_state(1, 100, "qemu", ssh_managed=False, global_opt_in=True)
    await hs.set_managed(1, 100, "qemu")  # global_opt_in=None → unberührt
    st = await hs.get_host_state(1, 100, "qemu")
    assert st["ssh_managed"] is True
    assert st["global_opt_in"] is True  # NICHT überschrieben


@pytest.mark.asyncio
async def test_set_managed_with_global(db):
    await hs.set_managed(1, 101, "qemu", global_opt_in=True)
    st = await hs.get_host_state(1, 101, "qemu")
    assert st["ssh_managed"] is True
    assert st["global_opt_in"] is True
    assert st["ansible_user"] == "p3-ansible"


@pytest.mark.asyncio
async def test_set_managed_creates_row(db):
    await hs.set_managed(1, 102, "lxc")
    st = await hs.get_host_state(1, 102, "lxc")
    assert st is not None and st["ssh_managed"] is True and st["global_opt_in"] is False


# ── permissions.assert_owner_or_manage ────────────────────────────────────────

@pytest.mark.asyncio
async def test_assert_owner_or_manage_invalid_kind():
    u = CurrentUser(username="admin", auth_type="local", role="admin")
    with pytest.raises(HTTPException) as ei:
        await perms.assert_owner_or_manage(u, 1, "bogus", 100)
    assert ei.value.status_code == 422


@pytest.mark.asyncio
async def test_assert_owner_or_manage_admin_ok():
    u = CurrentUser(username="admin", auth_type="local", role="admin")
    await perms.assert_owner_or_manage(u, 1, "qemu", 100)  # kein Raise


@pytest.mark.asyncio
async def test_assert_owner_or_manage_non_owner_403():
    u = CurrentUser(username="op", auth_type="local", role="operator", user_id=5)
    with patch("backend.features.owners.service.is_owner", new=AsyncMock(return_value=False)):
        with pytest.raises(HTTPException) as ei:
            await perms.assert_owner_or_manage(u, 1, "qemu", 100)
    assert ei.value.status_code == 403


# ── Core-Router: mark-managed ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_mark_managed_invalid_kind_422(client):
    resp = await client.post("/api/ansible-inventory/hosts/1/bogus/100/mark-managed", headers=_H_ADMIN)
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_mark_managed_admin_ok_in_run_scope(client):
    with patch.object(hs, "set_managed", new=AsyncMock()), \
         patch.object(inv, "_node_run_scope_sets", new=AsyncMock(return_value=(set(), set()))), \
         patch.object(hs, "get_host_state", new=AsyncMock(return_value={"global_opt_in": True})), \
         patch("backend.features.ansible_inventory.router.write_audit_log", new=AsyncMock()):
        resp = await client.post("/api/ansible-inventory/hosts/1/qemu/100/mark-managed", headers=_H_ADMIN)
    assert resp.status_code == 200
    body = resp.json()
    assert body["detail"] == "managed"
    assert body["host_ref"] == "1:100:qemu"
    assert body["in_run_scope"] is True


@pytest.mark.asyncio
async def test_mark_managed_non_owner_403(client):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        username="op", auth_type="local", role="operator", user_id=5
    )
    try:
        with patch("backend.features.owners.service.is_owner", new=AsyncMock(return_value=False)):
            resp = await client.post("/api/ansible-inventory/hosts/1/qemu/100/mark-managed", headers=_H_OP)
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 403


# ── Core-Router: test-connection ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_test_connection_no_ip(client):
    with patch("backend.services.nodes_service.get_node",
               new=AsyncMock(return_value=SimpleNamespace(url="https://pve:8006", verify_ssl=False))), \
         patch.object(inv, "_resolve_node_live", new=AsyncMock(return_value=({}, {}))), \
         patch.object(inv, "_fetch_host_ip", new=AsyncMock(return_value=None)), \
         patch("backend.features.ansible_inventory.router.write_audit_log", new=AsyncMock()):
        resp = await client.post("/api/ansible-inventory/hosts/1/qemu/100/test-connection", headers=_H_ADMIN)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False and body["reason"] == "no_ip"


@pytest.mark.asyncio
async def test_test_connection_owner_ok(client):
    from backend.features.ansible_inventory import runner as _runner
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        username="op", auth_type="local", role="operator", user_id=5
    )
    try:
        with patch("backend.services.nodes_service.get_node",
                   new=AsyncMock(return_value=SimpleNamespace(url="https://pve:8006", verify_ssl=False))), \
             patch.object(inv, "_resolve_node_live",
                          new=AsyncMock(return_value=({100: {"proxmox_node": "pve1", "type": "qemu"}}, {}))), \
             patch.object(inv, "_fetch_host_ip", new=AsyncMock(return_value="10.0.0.1")), \
             patch.object(hs, "get_host_state",
                          new=AsyncMock(return_value={"ansible_user": "p3-ansible", "host_key": None})), \
             patch("backend.features.owners.service.is_owner", new=AsyncMock(return_value=True)), \
             patch("backend.features.ansible_inventory.keys.get_user_private_key",
                   new=AsyncMock(return_value="PRIVATE")), \
             patch.object(_runner, "test_guest_connection", new=AsyncMock(return_value=(True, "ok"))), \
             patch("backend.features.ansible_inventory.router.write_audit_log", new=AsyncMock()):
            resp = await client.post("/api/ansible-inventory/hosts/1/qemu/100/test-connection", headers=_H_OP)
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "reason": "ok"}


@pytest.mark.asyncio
async def test_test_connection_non_owner_403(client):
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        username="op", auth_type="local", role="operator", user_id=5
    )
    try:
        with patch("backend.features.owners.service.is_owner", new=AsyncMock(return_value=False)):
            resp = await client.post("/api/ansible-inventory/hosts/1/qemu/100/test-connection", headers=_H_OP)
    finally:
        app.dependency_overrides.clear()
    assert resp.status_code == 403


# ── inventory.build_discovery + _node_run_scope_sets ──────────────────────────

@pytest.mark.asyncio
async def test_node_run_scope_sets_empty_and_guarded(db):
    # keine Owner, pool_members-Tabelle fehlt in Pure Core → beide leer, kein Crash
    owned, pooled = await inv._node_run_scope_sets(1)
    assert owned == set() and pooled == set()


@pytest.mark.asyncio
async def test_build_discovery_groups_and_run_scope(db):
    # 100 = managed + global_opt_in (→ in_run_scope) ; 101 = managed ohne Scope (AC-RUN-2) ; 102 = unmanaged
    await hs.set_managed(1, 100, "qemu", global_opt_in=True)
    await hs.set_managed(1, 101, "qemu")  # ssh_managed, aber global_opt_in=0, kein Owner/Pool
    resources = [
        {"vmid": 100, "node": "pve1", "type": "qemu", "name": "web", "status": "running"},
        {"vmid": 101, "node": "pve1", "type": "qemu", "name": "db", "status": "running"},
        {"vmid": 102, "node": "pve1", "type": "lxc", "name": "ct", "status": "stopped"},
    ]
    fake_client = SimpleNamespace(get_cluster_resources_v2=AsyncMock(return_value=resources))
    with patch("backend.services.nodes_service.get_node",
               new=AsyncMock(return_value=SimpleNamespace(url="https://pve:8006", verify_ssl=False))), \
         patch("backend.services.service_accounts._extract_token",
               return_value=SimpleNamespace(token_id="t", token_secret="s")), \
         patch("backend.services.proxmox.ProxmoxClient", return_value=fake_client), \
         patch.object(inv, "_fetch_host_ip", new=AsyncMock(return_value="10.0.0.9")):
        out = await inv.build_discovery(1)

    assert out["error"] is None
    by_vmid = {h["vmid"]: h for h in out["hosts"]}
    assert by_vmid[100]["managed"] is True and by_vmid[100]["in_run_scope"] is True
    assert by_vmid[100]["ip"] == "10.0.0.9"
    assert by_vmid[101]["managed"] is True and by_vmid[101]["in_run_scope"] is False  # AC-RUN-2
    assert by_vmid[102]["managed"] is False and by_vmid[102]["in_run_scope"] is False
    assert by_vmid[102]["ip"] is None  # IP nur für managed


@pytest.mark.asyncio
async def test_build_discovery_unknown_node(db):
    with patch("backend.services.nodes_service.get_node", new=AsyncMock(return_value=None)):
        out = await inv.build_discovery(999)
    assert out["error"] == inv.ERR_NODE_UNKNOWN and out["hosts"] == []
