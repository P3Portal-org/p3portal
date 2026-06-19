# p3portal.org
"""PROJ-34: Unit-Tests für alert_rule_service Merge-Logik und alert_check_service State-Machine."""
from __future__ import annotations

import pytest
import pytest_asyncio

from backend.db.database import init_db
from backend.services import alert_rule_service as svc


@pytest.fixture(autouse=True)
def patch_data_dir(tmp_path, monkeypatch):
    from backend.core.config import settings
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    await init_db()
    # Seed a test node so FK constraints pass for vm-scope rules
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


# ── CRUD: Global Rules ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_and_get_global_rule():
    rule = await svc.create_rule(
        scope="global",
        name="CPU High",
        metric="cpu_percent",
        critical_threshold=90.0,
        created_by="admin",
    )
    assert rule["id"] is not None
    assert rule["scope"] == "global"
    assert rule["name"] == "CPU High"
    assert rule["critical_threshold"] == 90.0
    assert rule["warning_threshold"] is None

    fetched = await svc.get_rule_by_id(rule["id"])
    assert fetched is not None
    assert fetched["id"] == rule["id"]


@pytest.mark.asyncio
async def test_update_rule():
    rule = await svc.create_rule(
        scope="global", name="R1", metric="mem_percent",
        warning_threshold=70.0, created_by="admin",
    )
    updated = await svc.update_rule(rule["id"], {"name": "Updated", "enabled": False})
    assert updated["name"] == "Updated"
    assert updated["enabled"] is False
    assert updated["warning_threshold"] == 70.0  # unchanged


@pytest.mark.asyncio
async def test_delete_rule():
    rule = await svc.create_rule(
        scope="global", name="R2", metric="cpu_percent",
        critical_threshold=80.0, created_by="admin",
    )
    found = await svc.delete_rule(rule["id"])
    assert found is True
    assert await svc.get_rule_by_id(rule["id"]) is None


@pytest.mark.asyncio
async def test_delete_nonexistent_rule():
    found = await svc.delete_rule(9999)
    assert found is False


# ── CRUD: Presets ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_preset_with_rules():
    preset = await svc.create_preset(
        name="Production",
        description="Prod alerts",
        created_by="admin",
        rules=[
            {"name": "CPU", "metric": "cpu_percent", "critical_threshold": 90.0,
             "sustained_polls": 3, "enabled": True, "notify_recovery": True},
        ],
    )
    assert preset["name"] == "Production"
    assert preset["rule_count"] == 1
    assert len(preset["rules"]) == 1
    assert preset["rules"][0]["metric"] == "cpu_percent"


@pytest.mark.asyncio
async def test_update_preset_name():
    preset = await svc.create_preset("P1", None, "admin")
    updated = await svc.update_preset(preset["id"], name="P1 Updated")
    assert updated["name"] == "P1 Updated"


@pytest.mark.asyncio
async def test_delete_preset():
    preset = await svc.create_preset("P2", None, "admin")
    found = await svc.delete_preset(preset["id"])
    assert found is True
    assert await svc.get_preset_by_id(preset["id"]) is None


# ── Preset Assignments ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_assign_and_get_preset():
    preset = await svc.create_preset("Assign Test", None, "admin")
    assignment = await svc.assign_preset(preset["id"], "100", 1)
    assert assignment["vmid"] == "100"
    assert assignment["preset_id"] == preset["id"]

    vm_preset = await svc.get_vm_preset("100", 1)
    assert vm_preset is not None
    assert vm_preset["id"] == preset["id"]


@pytest.mark.asyncio
async def test_remove_assignment():
    preset = await svc.create_preset("Remove Test", None, "admin")
    await svc.assign_preset(preset["id"], "200", 1)
    found = await svc.remove_assignment(preset["id"], "200", 1)
    assert found is True
    assert await svc.get_vm_preset("200", 1) is None


@pytest.mark.asyncio
async def test_reassign_preset_replaces_existing():
    """A VM can have at most one preset; reassigning replaces the previous one."""
    p1 = await svc.create_preset("P-A", None, "admin")
    p2 = await svc.create_preset("P-B", None, "admin")

    await svc.assign_preset(p1["id"], "300", 1)
    await svc.assign_preset(p2["id"], "300", 1)

    vm_preset = await svc.get_vm_preset("300", 1)
    assert vm_preset["id"] == p2["id"]


# ── Merge Logic ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_merge_global_rules_no_preset():
    """Without a preset, only global rules apply."""
    await svc.create_rule(
        scope="global", name="Global CPU", metric="cpu_percent",
        critical_threshold=90.0, created_by="admin",
    )
    effective = await svc.get_effective_rules("999", 1, is_plus=False)
    assert len(effective) == 1
    assert effective[0]["source"] == "global"
    assert effective[0]["metric"] == "cpu_percent"
    # BUG-34-6: ensure shape matches EffectiveRule schema (rule_id present, id retained for downstream check_service).
    from backend.models.alerts import EffectiveRule
    assert effective[0]["rule_id"] == effective[0]["id"]
    EffectiveRule(**effective[0])


@pytest.mark.asyncio
async def test_merge_vm_rule_overrides_global():
    """VM-specific rule wins over global rule for the same metric."""
    await svc.create_rule(
        scope="global", name="Global CPU", metric="cpu_percent",
        critical_threshold=90.0, created_by="admin",
    )
    await svc.create_rule(
        scope="vm", name="VM CPU Override", metric="cpu_percent",
        critical_threshold=70.0, node_id=1, vmid="100", created_by="user",
    )
    effective = await svc.get_effective_rules("100", 1, is_plus=False)
    assert len(effective) == 1
    assert effective[0]["source"] == "vm"
    assert effective[0]["critical_threshold"] == 70.0


@pytest.mark.asyncio
async def test_merge_preset_overrides_global(monkeypatch):
    """Preset rule wins over global rule for the same metric (Plus only)."""
    monkeypatch.setattr("backend.core.license.is_plus_edition", lambda: True)

    await svc.create_rule(
        scope="global", name="Global CPU", metric="cpu_percent",
        critical_threshold=90.0, created_by="admin",
    )
    preset = await svc.create_preset(
        "Prod",
        None,
        "admin",
        rules=[{"name": "Preset CPU", "metric": "cpu_percent", "critical_threshold": 75.0,
                "sustained_polls": 1, "enabled": True, "notify_recovery": True}],
    )
    await svc.assign_preset(preset["id"], "500", 1)

    effective = await svc.get_effective_rules("500", 1, is_plus=True)
    assert len(effective) == 1
    assert effective[0]["source"] == "preset"
    assert effective[0]["critical_threshold"] == 75.0


@pytest.mark.asyncio
async def test_merge_vm_beats_preset(monkeypatch):
    """VM-specific rule wins over preset rule for the same metric."""
    monkeypatch.setattr("backend.core.license.is_plus_edition", lambda: True)

    preset = await svc.create_preset(
        "Prod2",
        None,
        "admin",
        rules=[{"name": "Preset CPU", "metric": "cpu_percent", "critical_threshold": 75.0,
                "sustained_polls": 1, "enabled": True, "notify_recovery": True}],
    )
    await svc.assign_preset(preset["id"], "600", 1)
    await svc.create_rule(
        scope="vm", name="VM CPU Override", metric="cpu_percent",
        critical_threshold=50.0, node_id=1, vmid="600", created_by="user",
    )

    effective = await svc.get_effective_rules("600", 1, is_plus=True)
    cpu_rules = [r for r in effective if r["metric"] == "cpu_percent"]
    assert len(cpu_rules) == 1
    assert cpu_rules[0]["source"] == "vm"
    assert cpu_rules[0]["critical_threshold"] == 50.0


@pytest.mark.asyncio
async def test_merge_threshold_override_applied(monkeypatch):
    """Threshold override is applied on top of preset rule."""
    monkeypatch.setattr("backend.core.license.is_plus_edition", lambda: True)

    preset = await svc.create_preset(
        "Override Test",
        None,
        "admin",
        rules=[{"name": "Preset Mem", "metric": "mem_percent", "critical_threshold": 85.0,
                "sustained_polls": 1, "enabled": True, "notify_recovery": True}],
    )
    await svc.assign_preset(preset["id"], "700", 1)

    # Get the preset rule id
    preset_rules = await svc.list_preset_rules(preset["id"])
    rule_id = preset_rules[0]["id"]

    # Apply override: raise critical to 95
    await svc.upsert_overrides("700", 1, [{"rule_id": rule_id, "critical_threshold": 95.0}])

    effective = await svc.get_effective_rules("700", 1, is_plus=True)
    mem_rules = [r for r in effective if r["metric"] == "mem_percent"]
    assert len(mem_rules) == 1
    assert mem_rules[0]["critical_threshold"] == 95.0
    assert mem_rules[0]["override_applied"] is True


# ── State Machine (alert_check_service) ──────────────────────────────────────

@pytest.mark.asyncio
async def test_check_node_no_rules():
    """check_node should not crash with no rules configured."""
    from backend.services.alert_check_service import check_node
    vms = [{"vmid": 100, "name": "vm1", "type": "qemu", "cpu": 0.95, "mem": 1000, "maxmem": 2000}]
    # Should not raise
    await check_node(1, vms)


@pytest.mark.asyncio
async def test_check_node_creates_state():
    """Alert state should be created when threshold is exceeded (sustained_polls=1)."""
    from backend.services.alert_check_service import check_node

    # Create a global rule: cpu_percent critical at 80%
    await svc.create_rule(
        scope="global", name="CPU Alert", metric="cpu_percent",
        critical_threshold=80.0, sustained_polls=1, created_by="admin",
    )

    # VM with 95% CPU
    vms = [{"vmid": 100, "name": "vm1", "type": "qemu", "cpu": 0.95, "maxmem": 2000, "mem": 1000}]
    await check_node(1, vms)

    # State should be "critical"
    states = await svc.list_alert_states(is_admin=True, active_only=False)
    assert len(states) >= 1
    critical_states = [s for s in states if s["state"] == "critical"]
    assert len(critical_states) >= 1


@pytest.mark.asyncio
async def test_check_node_pending_before_sustained():
    """With sustained_polls=3, state should be 'pending' before 3 consecutive polls."""
    from backend.services.alert_check_service import check_node

    await svc.create_rule(
        scope="global", name="RAM High", metric="mem_percent",
        critical_threshold=70.0, sustained_polls=3, created_by="admin",
    )

    # VM with 90% memory (75% of maxmem)
    vms = [{"vmid": 200, "name": "vm2", "type": "qemu", "cpu": 0.1, "mem": 15000, "maxmem": 20000}]
    await check_node(1, vms)

    states = await svc.list_alert_states(is_admin=True, active_only=False)
    pending = [s for s in states if s["state"] == "pending" and s["vmid"] == "200"]
    assert len(pending) >= 1
    assert pending[0]["pending_count"] == 1


@pytest.mark.asyncio
async def test_metric_extraction_cpu():
    """CPU metric should be extracted as cpu * 100."""
    from backend.services.alert_check_service import _extract_metric
    results = _extract_metric({"cpu": 0.75, "maxmem": 1000, "mem": 500}, "cpu_percent", None)
    assert len(results) == 1
    assert results[0][1] == pytest.approx(75.0)


@pytest.mark.asyncio
async def test_metric_extraction_mem():
    """Memory metric should be mem/maxmem * 100."""
    from backend.services.alert_check_service import _extract_metric
    results = _extract_metric({"mem": 1500, "maxmem": 2000, "cpu": 0.1}, "mem_percent", None)
    assert len(results) == 1
    assert results[0][1] == pytest.approx(75.0)


@pytest.mark.asyncio
async def test_metric_extraction_status():
    """Status metric should return the raw status string."""
    from backend.services.alert_check_service import _extract_metric
    results = _extract_metric({"status": "stopped", "cpu": 0.0}, "status", None)
    assert len(results) == 1
    assert results[0][1] == "stopped"


# ── BUG-34-4: list_alert_events allowed_vmids filter ─────────────────────────

@pytest.mark.asyncio
async def test_list_alert_events_allowed_vmids_empty_set_returns_empty():
    """allowed_vmids={} (viewer with assignments but none matching) → empty list."""
    result = await svc.list_alert_events(allowed_vmids=set())
    assert result == []


@pytest.mark.asyncio
async def test_list_alert_events_allowed_vmids_none_returns_all():
    """allowed_vmids=None (admin/operator) → no restriction, returns all events."""
    # Seed a rule + event
    rule = await svc.create_rule(
        scope="global", name="CPU High", metric="cpu_percent",
        critical_threshold=90.0, created_by="admin",
    )
    from sqlalchemy import text
    from backend.db.database import get_db
    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO alert_events (rule_id, rule_name, vmid, node_id, metric, state, value, threshold, severity, timestamp)
                   VALUES (:rid, 'CPU High', '101', 1, 'cpu_percent', 'firing', '95.0', '90.0', 'critical', '2026-01-01T00:00:00+00:00')"""
            ),
            {"rid": rule["id"]},
        )
        await session.commit()

    result = await svc.list_alert_events(allowed_vmids=None)
    assert any(e["vmid"] == "101" for e in result)


@pytest.mark.asyncio
async def test_list_alert_events_allowed_vmids_filters_by_vmid():
    """allowed_vmids={'102'} → only events for vmid '102' returned, '103' excluded."""
    rule = await svc.create_rule(
        scope="global", name="RAM High", metric="mem_percent",
        critical_threshold=80.0, created_by="admin",
    )
    from sqlalchemy import text
    from backend.db.database import get_db
    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO alert_events (rule_id, rule_name, vmid, node_id, metric, state, value, threshold, severity, timestamp)
                   VALUES (:rid, 'RAM High', '102', 1, 'mem_percent', 'firing', '85.0', '80.0', 'critical', '2026-01-01T00:00:00+00:00')"""
            ),
            {"rid": rule["id"]},
        )
        await session.execute(
            text(
                """INSERT INTO alert_events (rule_id, rule_name, vmid, node_id, metric, state, value, threshold, severity, timestamp)
                   VALUES (:rid, 'RAM High', '103', 1, 'mem_percent', 'firing', '82.0', '80.0', 'critical', '2026-01-01T00:00:00+00:00')"""
            ),
            {"rid": rule["id"]},
        )
        await session.commit()

    result = await svc.list_alert_events(allowed_vmids={"102"})
    vmids = {e["vmid"] for e in result}
    assert "102" in vmids
    assert "103" not in vmids
