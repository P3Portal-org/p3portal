# p3portal.org
"""PROJ-34: Tests für den /api/alerts Router."""
from __future__ import annotations

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch, AsyncMock

from backend.core.security import create_access_token
from backend.db.database import init_db
from backend.routers.alerts import router, smtp_router

app = FastAPI()
app.include_router(router)
app.include_router(smtp_router)

_VIEWER_TOKEN  = create_access_token("viewer",   role="viewer")
_OPERATOR_TOKEN = create_access_token("operator", role="operator")
_ADMIN_TOKEN   = create_access_token("admin",    auth_type="local", role="admin")
_AUTH_HEADERS  = {"Authorization": f"Bearer {_ADMIN_TOKEN}"}
_USER_HEADERS  = {"Authorization": f"Bearer {_VIEWER_TOKEN}"}


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest.fixture(autouse=True)
def patch_core_edition(monkeypatch):
    """Default: Core edition (no Plus). Patch reicht für hooks-Proxy + Service."""
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
    monkeypatch.setattr("backend.core.license.is_plus_edition", lambda: False)


async def _seed_node():
    """Insert a test node so FK constraints on alert_rules.node_id pass."""
    from sqlalchemy import text
    from backend.db.database import get_db
    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO nodes (id, name, url, proxmox_node, is_default, created_at, created_by)
                   VALUES (1, 'test-node', 'https://proxmox.test:8006', 'pve', 1, '2026-01-01T00:00:00+00:00', 'system')
                   ON CONFLICT DO NOTHING"""
            )
        )
        await session.commit()


@pytest_asyncio.fixture
async def client():
    await init_db()
    await _seed_node()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest_asyncio.fixture
async def plus_client(monkeypatch):
    monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
    monkeypatch.setattr("backend.core.license.is_plus_edition", lambda: True)
    await init_db()
    await _seed_node()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


# ── Unauthenticated ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_global_rules_unauthenticated(client):
    r = await client.get("/api/alerts/rules")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_states_unauthenticated(client):
    r = await client.get("/api/alerts/states")
    assert r.status_code == 401


# ── Non-admin cannot manage global rules ─────────────────────────────────────

@pytest.mark.asyncio
async def test_create_global_rule_operator_forbidden(client):
    r = await client.post(
        "/api/alerts/rules",
        json={"name": "CPU High", "metric": "cpu_percent", "critical_threshold": 90.0},
        headers={"Authorization": f"Bearer {_OPERATOR_TOKEN}"},
    )
    assert r.status_code == 403


# ── Global Rules CRUD ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_global_rules_empty(client):
    r = await client.get("/api/alerts/rules", headers=_AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_create_and_list_global_rule(client):
    r = await client.post(
        "/api/alerts/rules",
        json={
            "name": "CPU Critical",
            "metric": "cpu_percent",
            "critical_threshold": 90.0,
            "sustained_polls": 2,
        },
        headers=_AUTH_HEADERS,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "CPU Critical"
    assert body["metric"] == "cpu_percent"
    assert body["critical_threshold"] == 90.0
    assert body["warning_threshold"] is None
    assert body["sustained_polls"] == 2
    assert body["scope"] == "global"
    rule_id = body["id"]

    # List should show one rule
    r2 = await client.get("/api/alerts/rules", headers=_AUTH_HEADERS)
    assert r2.status_code == 200
    assert len(r2.json()) == 1
    assert r2.json()[0]["id"] == rule_id


@pytest.mark.asyncio
async def test_create_rule_both_thresholds(client):
    r = await client.post(
        "/api/alerts/rules",
        json={
            "name": "RAM Alert",
            "metric": "mem_percent",
            "warning_threshold": 70.0,
            "critical_threshold": 90.0,
        },
        headers=_AUTH_HEADERS,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["warning_threshold"] == 70.0
    assert body["critical_threshold"] == 90.0


@pytest.mark.asyncio
async def test_create_rule_no_threshold_fails(client):
    r = await client.post(
        "/api/alerts/rules",
        json={"name": "Bad Rule", "metric": "cpu_percent"},
        headers=_AUTH_HEADERS,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_create_rule_warning_gte_critical_fails(client):
    r = await client.post(
        "/api/alerts/rules",
        json={
            "name": "Bad Rule",
            "metric": "cpu_percent",
            "warning_threshold": 90.0,
            "critical_threshold": 70.0,
        },
        headers=_AUTH_HEADERS,
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_update_global_rule(client):
    # Create
    r1 = await client.post(
        "/api/alerts/rules",
        json={"name": "Rule X", "metric": "mem_percent", "critical_threshold": 80.0},
        headers=_AUTH_HEADERS,
    )
    rule_id = r1.json()["id"]

    # Update
    r2 = await client.put(
        f"/api/alerts/rules/{rule_id}",
        json={"name": "Rule X Updated", "enabled": False},
        headers=_AUTH_HEADERS,
    )
    assert r2.status_code == 200
    assert r2.json()["name"] == "Rule X Updated"
    assert r2.json()["enabled"] is False


@pytest.mark.asyncio
async def test_delete_global_rule(client):
    r1 = await client.post(
        "/api/alerts/rules",
        json={"name": "Delete Me", "metric": "cpu_percent", "warning_threshold": 80.0},
        headers=_AUTH_HEADERS,
    )
    rule_id = r1.json()["id"]

    r2 = await client.delete(f"/api/alerts/rules/{rule_id}", headers=_AUTH_HEADERS)
    assert r2.status_code == 204

    r3 = await client.get("/api/alerts/rules", headers=_AUTH_HEADERS)
    assert len(r3.json()) == 0


@pytest.mark.asyncio
async def test_delete_nonexistent_rule(client):
    r = await client.delete("/api/alerts/rules/9999", headers=_AUTH_HEADERS)
    assert r.status_code == 404


# ── VM-specific Rules ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_vm_rule(client):
    r = await client.post(
        "/api/alerts/vm/1/100/rules",
        json={
            "name": "VM CPU Alert",
            "metric": "cpu_percent",
            "warning_threshold": 60.0,
            "critical_threshold": 90.0,
        },
        headers=_AUTH_HEADERS,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["scope"] == "vm"
    assert body["vmid"] == "100"
    assert body["node_id"] == 1


@pytest.mark.asyncio
async def test_vm_alert_summary_empty(client):
    r = await client.get("/api/alerts/vm/1/100", headers=_AUTH_HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["vmid"] == "100"
    assert body["node_id"] == 1
    assert body["vm_rules"] == []
    assert body["preset"] is None


# ── Alert States ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_alert_states_empty(client):
    r = await client.get("/api/alerts/states", headers=_AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == []


# ── Alert Events ──────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_alert_events_empty(client):
    r = await client.get("/api/alerts/events", headers=_AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.asyncio
async def test_acknowledge_nonexistent_event(client):
    r = await client.post("/api/alerts/events/9999/acknowledge", headers=_AUTH_HEADERS)
    assert r.status_code == 404


# ── Presets (Plus-only) ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_presets_core_forbidden(client):
    r = await client.get("/api/alerts/presets", headers=_AUTH_HEADERS)
    assert r.status_code == 403


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_create_preset_plus(plus_client):
    r = await plus_client.post(
        "/api/alerts/presets",
        json={
            "name": "Production Preset",
            "description": "Standard production alerts",
            "rules": [
                {
                    "name": "High CPU",
                    "metric": "cpu_percent",
                    "warning_threshold": 70.0,
                    "critical_threshold": 90.0,
                }
            ],
        },
        headers=_AUTH_HEADERS,
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "Production Preset"
    assert body["rule_count"] == 1
    assert len(body["rules"]) == 1


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_assign_preset_plus(plus_client):
    # Create preset first
    r1 = await plus_client.post(
        "/api/alerts/presets",
        json={"name": "Test Preset", "rules": [{"name": "CPU", "metric": "cpu_percent", "critical_threshold": 90.0}]},
        headers=_AUTH_HEADERS,
    )
    preset_id = r1.json()["id"]

    # Assign to VM
    r2 = await plus_client.post(
        f"/api/alerts/presets/{preset_id}/assign",
        json={"vmid": "200", "node_id": 1},
        headers=_AUTH_HEADERS,
    )
    assert r2.status_code == 201
    assert r2.json()["vmid"] == "200"
    assert r2.json()["preset_id"] == preset_id


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_delete_preset_plus(plus_client):
    r1 = await plus_client.post(
        "/api/alerts/presets",
        json={"name": "To Delete", "rules": [{"name": "R", "metric": "cpu_percent", "critical_threshold": 90.0}]},
        headers=_AUTH_HEADERS,
    )
    preset_id = r1.json()["id"]

    r2 = await plus_client.delete(f"/api/alerts/presets/{preset_id}", headers=_AUTH_HEADERS)
    assert r2.status_code == 204


# ── SMTP Config (Plus-only) ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_smtp_config_core_forbidden(client):
    r = await client.get("/api/admin/alerts/smtp", headers=_AUTH_HEADERS)
    assert r.status_code == 403


@pytest.mark.asyncio
@pytest.mark.plus_only
async def test_get_smtp_config_plus_unconfigured(plus_client):
    with patch("backend.services.alert_rule_service.get_smtp_config", new=AsyncMock(return_value={
        "host": None, "port": None, "username": None, "use_tls": True,
        "from_address": None, "configured": False,
    })):
        r = await plus_client.get("/api/admin/alerts/smtp", headers=_AUTH_HEADERS)
    assert r.status_code == 200
    assert r.json()["configured"] is False


# ── Status metric (special) ───────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_status_rule(client):
    r = await client.post(
        "/api/alerts/rules",
        json={
            "name": "VM Down",
            "metric": "status",
            "critical_threshold": 90.0,  # For status metric, value is actually target status
        },
        headers=_AUTH_HEADERS,
    )
    # status metric: warning_threshold not allowed
    assert r.status_code == 201


@pytest.mark.asyncio
async def test_create_status_rule_with_warning_fails(client):
    r = await client.post(
        "/api/alerts/rules",
        json={
            "name": "VM Down",
            "metric": "status",
            "warning_threshold": 50.0,
            "critical_threshold": 90.0,
        },
        headers=_AUTH_HEADERS,
    )
    assert r.status_code == 422
