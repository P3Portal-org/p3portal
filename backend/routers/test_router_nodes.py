# p3portal.org
"""Tests for PROJ-21 Admin Node-Management API."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from unittest.mock import AsyncMock, patch

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.nodes import router as nodes_router

app = FastAPI()
app.include_router(nodes_router)

_ADMIN_TOKEN  = create_access_token("admin", auth_type="local", role="admin")
_OP_TOKEN     = create_access_token("op",    auth_type="local", role="operator")
_VIEWER_TOKEN = create_access_token("viewer", auth_type="local", role="viewer")


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


_NODE_PAYLOAD = {
    "name": "Homelab",
    "url": "https://pve.example.com:8006",
    "proxmox_node": "pve",
    "verify_ssl": False,
    "token_id": "user@pam!mytoken",
    "token_secret": "supersecrettoken",
}


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
async def client_with_node(tmp_path):
    await init_db()
    from backend.services.nodes_service import create_node
    await create_node(**{k: v for k, v in _NODE_PAYLOAD.items()}, created_by="test")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── GET /api/admin/nodes ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_nodes_empty(client: AsyncClient):
    resp = await client.get("/api/admin/nodes", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_nodes_requires_admin(client: AsyncClient):
    resp = await client.get("/api/admin/nodes", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_list_nodes_returns_node(client_with_node: AsyncClient):
    resp = await client_with_node.get("/api/admin/nodes", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    node = data[0]
    assert node["name"] == "Homelab"
    assert node["url"] == "https://pve.example.com:8006"
    assert node["proxmox_node"] == "pve"
    assert node["is_default"] is True
    assert "token_secret" not in node  # secret never returned


# ── GET /api/admin/nodes/{id} ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_node_not_found(client: AsyncClient):
    resp = await client.get("/api/admin/nodes/99", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_node_by_id(client_with_node: AsyncClient):
    resp = await client_with_node.get("/api/admin/nodes/1", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["id"] == 1


# ── POST /api/admin/nodes ─────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_node_core_limited(client_with_node: AsyncClient, monkeypatch):
    """Core edition: cannot add a second node."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client_with_node.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"name": "Second"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_create_node_plus_allowed(client_with_node: AsyncClient, monkeypatch):
    """Plus edition: can add additional nodes."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
    resp = await client_with_node.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"name": "Second"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Second"


@pytest.mark.asyncio
async def test_create_node_first_is_default(client: AsyncClient, monkeypatch):
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD,
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    assert resp.json()["is_default"] is True


@pytest.mark.asyncio
async def test_create_node_invalid_url(client: AsyncClient, monkeypatch):
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"url": "not-a-url"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


# ── PUT /api/admin/nodes/{id} ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_node(client_with_node: AsyncClient):
    resp = await client_with_node.put(
        "/api/admin/nodes/1",
        json={"name": "Updated Name"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Updated Name"


@pytest.mark.asyncio
async def test_update_node_not_found(client: AsyncClient):
    resp = await client.put(
        "/api/admin/nodes/99",
        json={"name": "X"},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 404


# ── DELETE /api/admin/nodes/{id} ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_last_node_rejected(client_with_node: AsyncClient):
    """Cannot delete the only node."""
    resp = await client_with_node.delete("/api/admin/nodes/1", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 409


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_delete_second_node(client_with_node: AsyncClient, monkeypatch):
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
    # Add second node
    resp = await client_with_node.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"name": "Second"},
        headers=_auth(_ADMIN_TOKEN),
    )
    second_id = resp.json()["id"]

    # Delete second node
    resp = await client_with_node.delete(
        f"/api/admin/nodes/{second_id}", headers=_auth(_ADMIN_TOKEN)
    )
    assert resp.status_code == 204


# ── POST /api/admin/nodes/{id}/test ──────────────────────────────────────────

@pytest.mark.asyncio
async def test_test_connection_endpoint(client_with_node: AsyncClient):
    with patch(
        "backend.routers.nodes.test_connection",
        new=AsyncMock(return_value={"ok": True, "version": "8.1.4", "error": None}),
    ):
        resp = await client_with_node.post(
            "/api/admin/nodes/1/test",
            headers=_auth(_ADMIN_TOKEN),
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["version"] == "8.1.4"


@pytest.mark.asyncio
async def test_test_connection_not_found(client: AsyncClient):
    resp = await client.post("/api/admin/nodes/99/test", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 404


# ── POST /api/admin/nodes/default/{id} ───────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_set_default_node(client_with_node: AsyncClient, monkeypatch):
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
    # Create second node
    resp = await client_with_node.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"name": "Second"},
        headers=_auth(_ADMIN_TOKEN),
    )
    second_id = resp.json()["id"]

    # Make second node the default
    resp = await client_with_node.post(
        f"/api/admin/nodes/default/{second_id}",
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Verify
    nodes = (await client_with_node.get("/api/admin/nodes", headers=_auth(_ADMIN_TOKEN))).json()
    default_node = next(n for n in nodes if n["id"] == second_id)
    assert default_node["is_default"] is True


# ── Auth / role checks ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unauthenticated_rejected(client: AsyncClient):
    resp = await client.get("/api/admin/nodes")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_viewer_rejected(client: AsyncClient):
    resp = await client.get("/api/admin/nodes", headers=_auth(_VIEWER_TOKEN))
    assert resp.status_code == 403


# ── PROJ-26: cluster_nodes via API ────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_node_with_cluster_nodes(client: AsyncClient, monkeypatch):
    """POST /api/admin/nodes accepts and persists cluster_nodes."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"cluster_nodes": ["node-b", "node-c"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["cluster_nodes"] == ["node-b", "node-c"]


@pytest.mark.asyncio
async def test_list_nodes_returns_cluster_nodes(client: AsyncClient, monkeypatch):
    """GET /api/admin/nodes includes cluster_nodes in each entry."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"cluster_nodes": ["node-b"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    resp = await client.get("/api/admin/nodes", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    node = resp.json()[0]
    assert node["cluster_nodes"] == ["node-b"]


@pytest.mark.asyncio
async def test_create_node_without_cluster_nodes_returns_empty_list(client: AsyncClient, monkeypatch):
    """POST without cluster_nodes → cluster_nodes defaults to []."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD,
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    assert resp.json()["cluster_nodes"] == []


@pytest.mark.asyncio
async def test_update_node_sets_cluster_nodes(client_with_node: AsyncClient):
    """PUT /api/admin/nodes/{id} can set cluster_nodes on existing node."""
    resp = await client_with_node.put(
        "/api/admin/nodes/1",
        json={"cluster_nodes": ["node-b", "node-c"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["cluster_nodes"] == ["node-b", "node-c"]


@pytest.mark.asyncio
async def test_update_node_clears_cluster_nodes(client_with_node: AsyncClient):
    """PUT /api/admin/nodes/{id} can clear cluster_nodes."""
    # First set some
    await client_with_node.put(
        "/api/admin/nodes/1",
        json={"cluster_nodes": ["node-b"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    # Now clear
    resp = await client_with_node.put(
        "/api/admin/nodes/1",
        json={"cluster_nodes": []},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["cluster_nodes"] == []


@pytest.mark.asyncio
async def test_get_node_by_id_includes_cluster_nodes(client: AsyncClient, monkeypatch):
    """GET /api/admin/nodes/{id} includes cluster_nodes."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"cluster_nodes": ["node-b"]},
        headers=_auth(_ADMIN_TOKEN),
    )
    resp = await client.get("/api/admin/nodes/1", headers=_auth(_ADMIN_TOKEN))
    assert resp.status_code == 200
    assert resp.json()["cluster_nodes"] == ["node-b"]


# ── PROJ-27: manage_nodes permission tests ────────────────────────────────────

_MANAGE_NODES_TOKEN = create_access_token(
    "nodes_mgr", auth_type="local", role="operator",
    portal_permissions=["manage_nodes"],
)


@pytest.mark.asyncio
async def test_manage_nodes_can_list_nodes(client: AsyncClient):
    resp = await client.get("/api/admin/nodes", headers=_auth(_MANAGE_NODES_TOKEN))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_manage_nodes_can_create_node(client: AsyncClient):
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD,
        headers=_auth(_MANAGE_NODES_TOKEN),
    )
    assert resp.status_code == 201


@pytest.mark.asyncio
async def test_operator_without_manage_nodes_is_forbidden(client: AsyncClient):
    resp = await client.get("/api/admin/nodes", headers=_auth(_OP_TOKEN))
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_viewer_without_manage_nodes_is_forbidden(client: AsyncClient):
    resp = await client.get("/api/admin/nodes", headers=_auth(_VIEWER_TOKEN))
    assert resp.status_code == 403


# ── PROJ-33: poll_interval ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_node_default_poll_interval(client: AsyncClient, monkeypatch):
    """POST without poll_interval → defaults to 30."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD,
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    assert resp.json()["poll_interval"] == 30


@pytest.mark.asyncio
async def test_create_node_custom_poll_interval(client: AsyncClient, monkeypatch):
    """POST with custom poll_interval is stored."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"poll_interval": 60},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    assert resp.json()["poll_interval"] == 60


@pytest.mark.asyncio
async def test_update_node_poll_interval(client_with_node: AsyncClient):
    """PUT can update poll_interval."""
    resp = await client_with_node.put(
        "/api/admin/nodes/1",
        json={"poll_interval": 120},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["poll_interval"] == 120


@pytest.mark.asyncio
async def test_poll_interval_too_small_rejected(client: AsyncClient, monkeypatch):
    """poll_interval < 10 is rejected with 422."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"poll_interval": 5},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_poll_interval_too_large_rejected(client: AsyncClient, monkeypatch):
    """poll_interval > 300 is rejected with 422."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"poll_interval": 301},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_poll_interval_min_boundary_valid(client: AsyncClient, monkeypatch):
    """poll_interval=10 is the minimum valid value."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    resp = await client.post(
        "/api/admin/nodes",
        json=_NODE_PAYLOAD | {"poll_interval": 10},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 201
    assert resp.json()["poll_interval"] == 10


@pytest.mark.asyncio
async def test_poll_interval_max_boundary_via_update(client_with_node: AsyncClient):
    """poll_interval=300 is the maximum valid value (tested via PUT)."""
    resp = await client_with_node.put(
        "/api/admin/nodes/1",
        json={"poll_interval": 300},
        headers=_auth(_ADMIN_TOKEN),
    )
    assert resp.status_code == 200
    assert resp.json()["poll_interval"] == 300


# ── PUT /api/admin/nodes/reorder + reorder_nodes service ──────────────────────

_RN_KW = dict(verify_ssl=False, token_id="user@pam!t", token_secret="s", created_by="t")


@pytest.mark.asyncio
async def test_reorder_nodes_service():
    """Service setzt position=index und list_nodes liefert die neue Reihenfolge."""
    from backend.services.nodes_service import create_node, list_nodes, reorder_nodes
    await init_db()
    a = await create_node(name="A", url="https://a:8006", proxmox_node="a", **_RN_KW)
    b = await create_node(name="B", url="https://b:8006", proxmox_node="b", **_RN_KW)
    c = await create_node(name="C", url="https://c:8006", proxmox_node="c", **_RN_KW)
    await reorder_nodes([c.id, a.id, b.id])
    nodes = await list_nodes()
    assert [n.id for n in nodes] == [c.id, a.id, b.id]
    assert [n.position for n in nodes] == [0, 1, 2]


@pytest.mark.asyncio
async def test_reorder_nodes_default_order_preserved_when_unsorted():
    """position alle 0 → Fallback is_default DESC, id ASC (bisheriges Verhalten)."""
    from backend.services.nodes_service import create_node, list_nodes
    await init_db()
    a = await create_node(name="A", url="https://a:8006", proxmox_node="a", **_RN_KW)
    b = await create_node(name="B", url="https://b:8006", proxmox_node="b", **_RN_KW)
    nodes = await list_nodes()
    # a ist Default (erster Node) → bleibt vorne
    assert [n.id for n in nodes] == [a.id, b.id]


@pytest.mark.asyncio
async def test_reorder_nodes_validation_rejects_incomplete():
    from backend.services.nodes_service import create_node, reorder_nodes
    await init_db()
    a = await create_node(name="A", url="https://a:8006", proxmox_node="a", **_RN_KW)
    b = await create_node(name="B", url="https://b:8006", proxmox_node="b", **_RN_KW)
    with pytest.raises(ValueError):
        await reorder_nodes([a.id])           # b fehlt
    with pytest.raises(ValueError):
        await reorder_nodes([a.id, b.id, 9999])  # fremde id


@pytest.mark.asyncio
async def test_reorder_endpoint_forbidden_for_operator(client_with_node: AsyncClient):
    resp = await client_with_node.put(
        "/api/admin/nodes/reorder", json={"node_ids": [1]}, headers=_auth(_OP_TOKEN)
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_reorder_endpoint_admin_ok_and_conflict(client_with_node: AsyncClient):
    from backend.services.nodes_service import list_nodes
    ids = [n.id for n in await list_nodes()]
    resp = await client_with_node.put(
        "/api/admin/nodes/reorder", json={"node_ids": ids}, headers=_auth(_ADMIN_TOKEN)
    )
    assert resp.status_code == 200
    assert [n["id"] for n in resp.json()] == ids
    # falsche Menge → 409
    resp2 = await client_with_node.put(
        "/api/admin/nodes/reorder", json={"node_ids": ids + [9999]}, headers=_auth(_ADMIN_TOKEN)
    )
    assert resp2.status_code == 409
