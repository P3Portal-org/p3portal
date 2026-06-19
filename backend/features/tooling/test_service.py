# p3portal.org
"""PROJ-66: Tests für ToolingHealthService (Cache, Lock, Transition, Plus-Hook)."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.features.tooling.runners import CheckResult
from backend.features.tooling.schemas import ToolStatus
from backend.features.tooling.service import ToolingHealthService, _CORE_TOOLS


def _make_ready(tool: str) -> CheckResult:
    return CheckResult(
        status="ready",
        version="2.18.1" if tool == "ansible" else "1.11.2",
        stdout=f"=== {tool} --version ===\nok",
        stderr="",
        checked_at=datetime.now(timezone.utc),
    )


def _mock_runners(service: ToolingHealthService, results: dict) -> None:
    """Patcht die Runner-Funktionen im runners-Modul."""
    import backend.features.tooling.runners as _r

    async def _ansible():
        return results.get("ansible", _make_ready("ansible"))

    async def _packer():
        return results.get("packer", _make_ready("packer"))

    patch.object(_r, "run_ansible_check", _ansible).start()
    patch.object(_r, "run_packer_check", _packer).start()


@pytest.fixture
def svc():
    """Frische Service-Instanz je Test (kein Singleton)."""
    return ToolingHealthService()


# ── Initialer Status ─────────────────────────────────────────────────────────

def test_initial_status_is_unknown(svc):
    cache = svc.get_cached()
    for tool_id in _CORE_TOOLS:
        assert cache[tool_id].status == "unknown"


# ── Cache-Hit ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_cache_hit_skips_subprocess(svc):
    """Zweiter Aufruf innerhalb TTL darf keinen neuen Subprocess starten."""
    # Manuell Cache befüllen (als wäre erster Check gelaufen)
    svc._cache["ansible"] = ToolStatus(
        tool="ansible",
        status="ready",
        version="2.18.1",
        last_check=datetime.now(timezone.utc),
    )
    svc._cache["packer"] = ToolStatus(
        tool="packer",
        status="ready",
        version="1.11.2",
        last_check=datetime.now(timezone.utc),
    )

    import backend.features.tooling.runners as _r
    mock_ansible = AsyncMock(return_value=_make_ready("ansible"))

    with patch.object(_r, "run_ansible_check", mock_ansible), \
         patch.object(_r, "run_packer_check", AsyncMock(return_value=_make_ready("packer"))):
        await svc.run_all_checks(bypass_cache=False)

    # ansible-Cache-Hit → kein Subprocess-Aufruf
    mock_ansible.assert_not_called()


# ── Transition-Detect ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_transition_unknown_to_ready_not_audited(svc):
    """unknown → ready NICHT auditieren (AC-AUDIT-2)."""
    import backend.features.tooling.runners as _r

    with patch.object(_r, "run_ansible_check", AsyncMock(return_value=_make_ready("ansible"))), \
         patch.object(_r, "run_packer_check", AsyncMock(return_value=_make_ready("packer"))), \
         patch("backend.features.tooling.audit.write_audit_log", new_callable=AsyncMock) as mock_audit:
        await svc.run_all_checks()

    mock_audit.assert_not_called()


@pytest.mark.asyncio
async def test_transition_ready_to_down_audited(svc):
    """ready → down MUSS auditiert werden."""
    # Erst Cache mit ready befüllen
    svc._cache["ansible"] = ToolStatus(
        tool="ansible", status="ready", version="2.18.1",
        last_check=datetime.now(timezone.utc) - timedelta(seconds=800),
    )
    # Packer-Cache ebenfalls befüllen (damit kein packer-unknown→ready-Audit ausgelöst wird)
    svc._cache["packer"] = ToolStatus(
        tool="packer", status="ready", version="1.11.2",
        last_check=datetime.now(timezone.utc) - timedelta(seconds=800),
    )

    import backend.features.tooling.runners as _r
    down_result = CheckResult(
        status="down", version=None,
        stdout="", stderr="ansible: command not found",
        checked_at=datetime.now(timezone.utc),
    )
    packer_result = CheckResult(
        status="ready", version="1.11.2",
        stdout="ok", stderr="",
        checked_at=datetime.now(timezone.utc),
    )

    with patch.object(_r, "run_ansible_check", AsyncMock(return_value=down_result)), \
         patch.object(_r, "run_packer_check", AsyncMock(return_value=packer_result)), \
         patch("backend.features.tooling.audit.write_audit_log", new_callable=AsyncMock) as mock_audit:
        await svc.run_all_checks(bypass_cache=True)

    # Ansible sollte 1 Audit-Event erzeugen (ready→down)
    # Packer: ready→ready → KEIN Audit (kein Wechsel)
    calls = [c for c in mock_audit.call_args_list]
    assert len(calls) >= 1
    import json
    payloads = [json.loads(c.kwargs["detail"]) for c in calls]
    ansible_transition = [p for p in payloads if p["tool"] == "ansible"]
    assert len(ansible_transition) == 1
    assert ansible_transition[0]["from"] == "ready"
    assert ansible_transition[0]["to"] == "down"


# ── Rate-Limit ───────────────────────────────────────────────────────────────

def test_rate_limit_first_call_ok(svc):
    assert svc.check_rate_limit(42, "ansible") is None


def test_rate_limit_set_and_check(svc):
    svc._mark_rate_limit(42, "ansible")
    retry_after = svc.check_rate_limit(42, "ansible")
    assert retry_after is not None
    assert retry_after > 0


def test_rate_limit_different_user_ok(svc):
    svc._mark_rate_limit(42, "ansible")
    # User 99 hat sein eigenes Limit
    assert svc.check_rate_limit(99, "ansible") is None


def test_rate_limit_different_tool_ok(svc):
    svc._mark_rate_limit(42, "ansible")
    assert svc.check_rate_limit(42, "packer") is None


# ── Plus-Hook-Integration ────────────────────────────────────────────────────

def test_plus_hook_collision_core_wins(svc, monkeypatch):
    """Plus-Tool mit derselben ID wie 'ansible' wird verworfen (EC-12)."""
    from backend.core.plus_protocol import plus_behavior

    fake_extra = [{"tool_id": "ansible", "display_name": "Ansible Plus", "version_cmd": [], "probe_cmd": []}]
    monkeypatch.setattr(plus_behavior, "get_additional_tooling_checks", lambda: fake_extra)

    svc._init_tools()

    # Nur ansible + packer sollen bekannt sein
    assert svc._known_tools.count("ansible") == 1


def test_plus_hook_extra_tool_added(svc, monkeypatch):
    """Plus-Tool mit neuer ID wird zur Tool-Liste hinzugefügt."""
    from backend.core.plus_protocol import plus_behavior

    fake_extra = [{"tool_id": "terraform", "display_name": "Terraform", "version_cmd": [], "probe_cmd": []}]
    monkeypatch.setattr(plus_behavior, "get_additional_tooling_checks", lambda: fake_extra)

    svc._init_tools()

    assert "terraform" in svc._known_tools
    assert "terraform" in svc._cache


def test_plus_hook_failure_graceful(svc, monkeypatch):
    """Fehlerhafter Plus-Hook darf Service nicht zum Absturz bringen."""
    from backend.core.plus_protocol import plus_behavior

    monkeypatch.setattr(plus_behavior, "get_additional_tooling_checks", lambda: (_ for _ in ()).throw(RuntimeError("boom")))

    # Kein Exception erwartet
    svc._init_tools()
    assert "ansible" in svc._cache


# ── build_response ────────────────────────────────────────────────────────────

def test_build_response_includes_all_tools(svc):
    resp = svc.build_response()
    assert "ansible" in resp
    assert "packer" in resp


# ── PROJ-66 Phase 2: Plus-Runner-Dispatch + Rate-Limit-Verallgemeinerung ──────

def _make_tofu_result(status="ready"):
    return CheckResult(
        status=status,
        version="1.9.1",
        stdout="=== tofu version ===\nOpenTofu v1.9.1",
        stderr="",
        checked_at=datetime.now(timezone.utc),
    )


def _patch_tofu_hook(monkeypatch, runner):
    """Lässt den Plus-Hook eine Tofu-Config mit Runner-Callable liefern."""
    from backend.core.plus_protocol import plus_behavior

    cfg = [{"tool_id": "opentofu", "display_name": "OpenTofu", "runner": runner}]
    monkeypatch.setattr(plus_behavior, "get_additional_tooling_checks", lambda: cfg)


def test_extra_runner_registered_from_hook(svc, monkeypatch):
    """_init_tools() legt den Runner-Callable in _extra_runners ab (§B)."""
    async def fake(): return _make_tofu_result()

    _patch_tofu_hook(monkeypatch, fake)
    svc._init_tools()

    assert "opentofu" in svc._known_tools
    assert "opentofu" in svc._cache
    assert svc._extra_runners["opentofu"] is fake


@pytest.mark.asyncio
async def test_run_tool_dispatches_to_extra_runner(svc, monkeypatch):
    """_run_tool() führt für ein Plus-Tool den mitgebrachten Runner aus (AC-P2-DISPATCH-1)."""
    async def fake(): return _make_tofu_result("degraded")

    _patch_tofu_hook(monkeypatch, fake)
    svc._init_tools()

    result = await svc._run_tool("opentofu")
    assert result is not None
    assert result.status == "degraded"
    assert result.version == "1.9.1"


@pytest.mark.asyncio
async def test_core_dispatch_unchanged_with_plus_tool(svc, monkeypatch):
    """Core-Tools laufen weiter über _RUNNERS, unberührt vom Plus-Tool (AC-P2-DISPATCH-2)."""
    async def fake(): return _make_tofu_result()

    _patch_tofu_hook(monkeypatch, fake)
    _mock_runners(svc, {})
    await svc.run_all_checks(bypass_cache=True)

    assert svc._cache["ansible"].status == "ready"
    assert svc._cache["packer"].status == "ready"
    assert svc._cache["opentofu"].status == "ready"


def test_get_cached_includes_hook_tool(svc, monkeypatch):
    """get_cached() ruft _init_tools() → tofu erscheint (als unknown) vor erstem Check."""
    async def fake(): return _make_tofu_result()

    _patch_tofu_hook(monkeypatch, fake)
    cache = svc.get_cached()
    assert "opentofu" in cache
    assert cache["opentofu"].status == "unknown"


def test_known_tools_property_includes_hook_tool(svc, monkeypatch):
    async def fake(): return _make_tofu_result()

    _patch_tofu_hook(monkeypatch, fake)
    assert "opentofu" in svc.known_tools


@pytest.mark.asyncio
async def test_rate_limit_covers_tofu(svc, monkeypatch):
    """force_recheck markiert auch tofu → Recheck-Pfad rate-limited (AC-P2-DISPATCH-3)."""
    async def fake(): return _make_tofu_result()

    _patch_tofu_hook(monkeypatch, fake)
    _mock_runners(svc, {})

    await svc.force_recheck(user_id=42)
    # tofu wurde mit-markiert → zweiter Recheck innerhalb 30s ist limitiert
    assert svc.check_rate_limit(42, "opentofu") is not None
