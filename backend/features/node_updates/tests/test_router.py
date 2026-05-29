# p3portal.org
"""PROJ-73: Tests für den Node-Updates-Router (unit-level, services gemockt)."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.features.node_updates.router import router
from backend.features.node_updates.schemas import (
    MemberUpdateState,
    NodeUpdateResponse,
    NodeUpdateSummaryEntry,
    NodeUpdateSummaryResponse,
)

app = FastAPI()
app.include_router(router)

_VIEWER_TOKEN = create_access_token("viewer", role="viewer")
_ADMIN_TOKEN = create_access_token("admin", auth_type="local", role="admin")

_HDR_VIEWER = {"Authorization": f"Bearer {_VIEWER_TOKEN}"}
_HDR_ADMIN = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}


def _make_member(portal_node_id: int = 1, name: str = "pve1") -> MemberUpdateState:
    return MemberUpdateState(
        portal_node_id=portal_node_id,
        proxmox_node_name=name,
        last_check_at=None,
        last_success_at=None,
        last_error=None,
        packages=[],
        package_count=0,
        security_count=0,
        is_stale=True,
    )


def _make_node_response(portal_node_id: int = 1) -> NodeUpdateResponse:
    return NodeUpdateResponse(
        portal_node_id=portal_node_id,
        portal_node_name="test-node",
        members=[_make_member(portal_node_id)],
    )


def _make_summary_response() -> NodeUpdateSummaryResponse:
    return NodeUpdateSummaryResponse(
        entries=[
            NodeUpdateSummaryEntry(
                portal_node_id=1,
                portal_node_name="test-node",
                proxmox_node_name="pve1",
                package_count=3,
                security_count=1,
                last_success_at=None,
                last_check_at=None,
                last_error=None,
                is_stale=True,
            )
        ]
    )


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture
async def client():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# GET /api/nodes/updates/summary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_summary_requires_auth(client):
    resp = await client.get("/api/nodes/updates/summary")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_summary_returns_200(client):
    with patch(
        "backend.features.node_updates.router.get_summary_for_user",
        new_callable=AsyncMock,
        return_value=_make_summary_response(),
    ):
        resp = await client.get("/api/nodes/updates/summary", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    body = resp.json()
    assert "entries" in body
    assert len(body["entries"]) == 1
    assert body["entries"][0]["portal_node_id"] == 1


@pytest.mark.asyncio
async def test_summary_empty_when_no_nodes(client):
    with patch(
        "backend.features.node_updates.router.get_summary_for_user",
        new_callable=AsyncMock,
        return_value=NodeUpdateSummaryResponse(entries=[]),
    ):
        resp = await client.get("/api/nodes/updates/summary", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    assert resp.json()["entries"] == []


# ---------------------------------------------------------------------------
# GET /api/nodes/{portal_node_id}/updates
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_updates_requires_auth(client):
    resp = await client.get("/api/nodes/1/updates")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_get_updates_forbidden_when_cannot_view(client):
    with patch(
        "backend.features.node_updates.router._can_view",
        new_callable=AsyncMock,
        return_value=False,
    ):
        resp = await client.get("/api/nodes/1/updates", headers=_HDR_VIEWER)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_get_updates_404_when_node_missing(client):
    with (
        patch(
            "backend.features.node_updates.router._can_view",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "backend.features.node_updates.router.list_nodes",
            new_callable=AsyncMock,
            return_value=[],
        ),
    ):
        resp = await client.get("/api/nodes/99/updates", headers=_HDR_VIEWER)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_get_updates_returns_200(client):
    mock_node = AsyncMock()
    mock_node.id = 1

    with (
        patch(
            "backend.features.node_updates.router._can_view",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "backend.features.node_updates.router.list_nodes",
            new_callable=AsyncMock,
            return_value=[mock_node],
        ),
        patch(
            "backend.features.node_updates.router.get_updates_for_portal_node",
            new_callable=AsyncMock,
            return_value=_make_node_response(),
        ),
    ):
        resp = await client.get("/api/nodes/1/updates", headers=_HDR_VIEWER)
    assert resp.status_code == 200
    body = resp.json()
    assert body["portal_node_id"] == 1
    assert "members" in body


# ---------------------------------------------------------------------------
# POST /api/nodes/{portal_node_id}/updates/refresh
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_refresh_requires_auth(client):
    resp = await client.post("/api/nodes/1/updates/refresh")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_forbidden_when_cannot_refresh(client):
    with patch(
        "backend.features.node_updates.router._can_refresh",
        new_callable=AsyncMock,
        return_value=False,
    ):
        resp = await client.post("/api/nodes/1/updates/refresh", headers=_HDR_ADMIN)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_refresh_404_when_node_missing(client):
    with (
        patch(
            "backend.features.node_updates.router._can_refresh",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "backend.features.node_updates.router.list_nodes",
            new_callable=AsyncMock,
            return_value=[],
        ),
    ):
        resp = await client.post("/api/nodes/99/updates/refresh", headers=_HDR_ADMIN)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_refresh_returns_200(client):
    mock_node = AsyncMock()
    mock_node.id = 1

    with (
        patch(
            "backend.features.node_updates.router._can_refresh",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "backend.features.node_updates.router.list_nodes",
            new_callable=AsyncMock,
            return_value=[mock_node],
        ),
        patch(
            "backend.features.node_updates.router.refresh_portal_node",
            new_callable=AsyncMock,
            return_value=_make_node_response(),
        ),
    ):
        resp = await client.post("/api/nodes/1/updates/refresh", headers=_HDR_ADMIN)
    assert resp.status_code == 200
    body = resp.json()
    assert body["portal_node_id"] == 1


@pytest.mark.asyncio
async def test_refresh_409_when_lock_busy(client):
    mock_node = AsyncMock()
    mock_node.id = 1

    with (
        patch(
            "backend.features.node_updates.router._can_refresh",
            new_callable=AsyncMock,
            return_value=True,
        ),
        patch(
            "backend.features.node_updates.router.list_nodes",
            new_callable=AsyncMock,
            return_value=[mock_node],
        ),
        patch(
            "backend.features.node_updates.router.refresh_portal_node",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=409, detail="refresh_in_progress"),
        ),
    ):
        resp = await client.post("/api/nodes/1/updates/refresh", headers=_HDR_ADMIN)
    assert resp.status_code == 409
    assert resp.json()["detail"] == "refresh_in_progress"
