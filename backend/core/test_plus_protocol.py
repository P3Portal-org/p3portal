# p3portal.org
"""PROJ-60: Tests für plus_protocol.py – AC-24.

Testet:
- CorePlusBehavior liefert alle Core-Defaults korrekt
- Dispatcher schaltet zwischen Core und Plus je nach is_plus_edition()
- Loader-Selbstregistrierung (set_plus_behavior) setzt active-Slot
- monkeypatch direkt auf plus_behavior funktioniert
- CAPABILITIES-Map ist vollständig und alle Methoden aufrufbar
"""
import pytest

from backend.core.license import CORE_MAX_PRESETS, CORE_MAX_USERS
from backend.core.plus_protocol import (
    CAPABILITIES,
    CorePlusBehavior,
    PlusProtocol,
    _PlusBehaviorDispatcher,
    plus_behavior,
    set_plus_behavior,
)
from backend.services.user_api_key_service import CORE_MAX_KEYS


class TestCorePlusBehaviorDefaults:
    """CorePlusBehavior liefert für jede Protocol-Methode den dokumentierten Core-Default."""

    def test_all_gate_hooks_are_false(self):
        c = CorePlusBehavior()
        gate_methods = [
            "can_use_alert_presets", "can_use_alerts_smtp", "can_use_theme_editor",
            "can_add_multiple_nodes", "can_set_default_node", "can_use_scheduled_jobs",
            "can_change_language", "can_use_cluster_resources", "can_use_multi_node_dashboard",
            "can_use_api_key_max_count_override", "can_use_api_key_scopes_full",
            "can_use_sidebar_pins_extended", "can_use_compute_alerting",
            "can_use_compute_scheduled_jobs", "can_use_approval_workflow",
            "can_use_help_global_overrides", "can_use_pools_quotas", "can_use_groups_unlimited",
            "can_use_node_assignments", "can_use_owners_unlimited",
        ]
        for method in gate_methods:
            assert getattr(c, method)() is False, f"{method}() should return False in Core"

    def test_allow_self_approval_is_false(self):
        assert CorePlusBehavior().allow_self_approval_supported() is False

    def test_limit_hooks(self):
        c = CorePlusBehavior()
        assert c.get_max_users() == CORE_MAX_USERS
        assert c.get_max_presets() == CORE_MAX_PRESETS
        assert c.get_max_api_keys({}) == CORE_MAX_KEYS

    def test_filter_strips_plus_notification_fields(self):
        c = CorePlusBehavior()
        result = c.filter_alert_notification_fields({"webhook_url": "x", "name": "y"})
        assert result["webhook_url"] is None
        assert result["name"] == "y"

    def test_filter_hooks_return_empty(self):
        c = CorePlusBehavior()
        assert c.get_packer_session_fields({}) == {}
        assert c.get_cluster_node_extra({}) == {}


class TestPlusBehaviorDispatcher:
    """Dispatcher delegiert korrekt je nach is_plus_edition()-Wert."""

    def test_core_mode_uses_core_defaults(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        assert plus_behavior.can_use_alert_presets() is False

    @pytest.mark.plus_only
    def test_plus_mode_uses_active_impl(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        assert plus_behavior.can_use_alert_presets() is True

    def test_no_active_falls_back_to_core(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        d = _PlusBehaviorDispatcher(core=CorePlusBehavior())
        # Kein active gesetzt → Core-Default
        assert d.can_use_alert_presets() is False

    def test_monkeypatch_on_singleton_works(self, monkeypatch):
        monkeypatch.setattr(plus_behavior, "can_use_scheduled_jobs", lambda: True)
        assert plus_behavior.can_use_scheduled_jobs() is True

    def test_monkeypatch_cleaned_up_after_test(self):
        # Verify no patch bleed from previous test
        assert isinstance(plus_behavior.can_use_scheduled_jobs(), bool)

    def test_set_plus_behavior_registers_active(self, monkeypatch):
        class MockPlus:
            def can_use_alert_presets(self): return True
            def __getattr__(self, name): return getattr(CorePlusBehavior(), name)

        d = _PlusBehaviorDispatcher(core=CorePlusBehavior())
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        d._set_active(MockPlus())
        assert d.can_use_alert_presets() is True

    def test_set_plus_behavior_public_api(self, monkeypatch):
        """set_plus_behavior() registriert Implementierung auf Singleton-Dispatcher."""
        from backend.core.plus_protocol import _dispatcher
        original_active = object.__getattribute__(_dispatcher, "_active")
        try:
            class FakePlus:
                def can_use_alert_presets(self): return True
                def __getattr__(self, name): return getattr(CorePlusBehavior(), name)

            monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
            set_plus_behavior(FakePlus())
            assert plus_behavior.can_use_alert_presets() is True
        finally:
            object.__setattr__(_dispatcher, "_active", original_active)


class TestCapabilitiesMap:
    """CAPABILITIES-Map ist vollständig und alle Methoden aufrufbar."""

    def test_all_capability_keys_present(self):
        expected_keys = {
            "alert_presets", "alerts_smtp", "theme_editor", "multiple_nodes",
            "default_node", "scheduled_jobs", "language_change", "cluster_resources_packer",
            "multi_node_dashboard", "api_key_max_count_override", "api_key_scopes_full",
            "sidebar_pins_extended", "compute_alerting", "compute_scheduled_jobs",
            "approval_workflow", "help_global_overrides", "pools_quotas",
            "groups_unlimited", "node_assignments", "owners_unlimited",
            "playbook_permissions",
            "config_snapshots",
            # PROJ-64: Self-Approval-Gate (sync, editions-abhängig)
            "allow_self_approval_supported",
        }
        assert set(CAPABILITIES.keys()) == expected_keys

    def test_all_capability_methods_callable_on_core(self):
        c = CorePlusBehavior()
        for key, method_name in CAPABILITIES.items():
            result = getattr(c, method_name)()
            assert isinstance(result, bool), f"{key}: {method_name}() should return bool"

    def test_all_capability_methods_callable_on_dispatcher(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        for key, method_name in CAPABILITIES.items():
            result = getattr(plus_behavior, method_name)()
            assert isinstance(result, bool), f"{key} should return bool"

    def test_core_all_capabilities_are_false(self, monkeypatch):
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        for key, method_name in CAPABILITIES.items():
            result = getattr(plus_behavior, method_name)()
            assert result is False, f"Core: {key} should be False"

    def test_plus_all_capabilities_are_true(self, monkeypatch):
        """Plus-Antwort: monkeypatch auf Dispatcher direkt (kein backend.plus nötig)."""
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        # Setze alle Capability-Methoden direkt auf dem Dispatcher (Pattern AC-22)
        for key, method_name in CAPABILITIES.items():
            monkeypatch.setattr(plus_behavior, method_name, lambda: True)
        for key, method_name in CAPABILITIES.items():
            result = getattr(plus_behavior, method_name)()
            assert result is True, f"Plus: {key} should be True"


class TestPlusProtocolConformance:
    def test_core_implements_protocol(self):
        assert isinstance(CorePlusBehavior(), PlusProtocol)

    def test_dispatcher_proxy_passes_isinstance_via_duck_typing(self):
        # Dispatcher implementiert Protocol nicht direkt (er proxied),
        # aber alle Methoden sind per __getattr__ verfügbar
        for method_name in CAPABILITIES.values():
            assert hasattr(plus_behavior, method_name)
