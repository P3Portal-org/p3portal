# p3portal.org
"""PROJ-60: Tests für plus_protocol.py – AC-24.

Testet:
- CorePlusBehavior liefert alle Core-Defaults korrekt
- Dispatcher schaltet zwischen Core und Plus je nach is_plus_edition()
- Loader-Selbstregistrierung (set_plus_behavior) setzt active-Slot
- monkeypatch direkt auf plus_behavior funktioniert
- CAPABILITIES-Map ist vollständig und alle Methoden aufrufbar
"""
import asyncio
import inspect

import pytest

from backend.core.license import CORE_MAX_PRESETS, CORE_MAX_USERS
from backend.core.plus_protocol import (
    CAPABILITIES,
    CorePlusBehavior,
    PlusProtocol,
    _PlusBehaviorDispatcher,
    _build_dispatch_methods,
    gate,
    lifecycle,
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

    def test_additional_tooling_checks_override_runs_active_in_core_mode(self, monkeypatch):
        """PROJ-66 Phase 2: Hook ist binary-gekoppelt → aktive Impl läuft auch
        bei is_plus_edition()=False (Lifecycle-Override, [[feedback_lifecycle_hooks_override]])."""
        class MockPlus:
            def get_additional_tooling_checks(self):
                return [{"tool_id": "opentofu", "display_name": "OpenTofu", "runner": object()}]
            def __getattr__(self, name): return getattr(CorePlusBehavior(), name)

        d = _PlusBehaviorDispatcher(core=CorePlusBehavior())
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        d._set_active(MockPlus())
        # Trotz Core-Mode wird die aktive Impl gerufen (kein Gate)
        cfgs = d.get_additional_tooling_checks()
        assert len(cfgs) == 1 and cfgs[0]["tool_id"] == "opentofu"

    def test_additional_tooling_checks_falls_back_to_core_empty(self, monkeypatch):
        """Kein active (reines Core-Image) → Core-Default []."""
        d = _PlusBehaviorDispatcher(core=CorePlusBehavior())
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        assert d.get_additional_tooling_checks() == []

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
            # PROJ-77: Auto-Snapshots
            "auto_snapshots",
            # PROJ-76: Stacks (deklaratives Infrastructure-Modell)
            "stacks",
            # PROJ-83: Ansible-Inventory (Pool-/Global-Scope + Key-Management)
            "ansible_inventory",
            # PROJ-75: Cluster-Topologie-Ansicht
            "topology",
            # PROJ-92: Packer Visual Editor
            "packer_editor",
            # PROJ-93: Ansible Visual Editor
            "ansible_editor",
            # PROJ-96: VM-Abhängigkeiten & Aktions-Impact-Warnung
            "vm_dependencies",
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

    def test_dispatcher_carries_all_protocol_methods_directly(self):
        # PROJ-95 (§H): kein __getattr__ mehr – jede Protocol-Methode ist eine echte,
        # explizit generierte Methode direkt auf der Dispatcher-Klasse (IDE-auffindbar).
        dispatcher_methods = _public_methods(_PlusBehaviorDispatcher)
        protocol_methods = _public_methods(PlusProtocol)
        assert dispatcher_methods == protocol_methods
        assert "__getattr__" not in vars(_PlusBehaviorDispatcher), \
            "__getattr__ darf nach PROJ-95 nicht mehr existieren"
        for method_name in CAPABILITIES.values():
            assert hasattr(plus_behavior, method_name)


# ─────────────────────────────────────────────────────────────────────────────
# PROJ-95: Struktureller Klassifikations-Zwang + Verhaltensmatrix
# ─────────────────────────────────────────────────────────────────────────────

def _public_methods(cls) -> set[str]:
    """Public (nicht-_) Funktionsmethoden direkt auf der Klasse."""
    return {
        n for n, v in vars(cls).items()
        if inspect.isfunction(v) and not n.startswith("_")
    }


def _classified(cls, kind: str) -> set[str]:
    return {
        n for n, v in vars(cls).items()
        if getattr(v, "_plus_dispatch", None) == kind
    }


_KNOWN_LIFECYCLE = {
    "ensure_plus_db_tables",
    "start_scheduled_job_runner",
    "register_scheduled_job_celery_tasks",
    "get_scheduled_job_action_handlers",
    "get_additional_tooling_checks",
}


class TestDispatchClassificationGuard:
    """PROJ-95 AC-STRUCT: jede Methode ist klassifiziert; Unklassifiziertes bricht hart."""

    def test_every_core_method_is_classified(self):
        # AC-STRUCT-1: genau eine Klassifikation pro Methode.
        for name in _public_methods(CorePlusBehavior):
            stamp = getattr(getattr(CorePlusBehavior, name), "_plus_dispatch", None)
            assert stamp in ("gate", "lifecycle"), f"{name} ist nicht klassifiziert"

    def test_protocol_core_classification_sets_are_consistent(self):
        # AC-DECLARE-3 + AC-STRUCT-1: {Protocol} == {Core} == {gate ⊎ lifecycle}.
        core = _public_methods(CorePlusBehavior)
        proto = _public_methods(PlusProtocol)
        assert core == proto, f"Protocol↔Core-Drift: +{proto - core} -{core - proto}"
        gates = _classified(CorePlusBehavior, "gate")
        lifecycles = _classified(CorePlusBehavior, "lifecycle")
        assert gates.isdisjoint(lifecycles)
        assert gates | lifecycles == core

    def test_lifecycle_set_is_exactly_the_five_known_hooks(self):
        # AC-STRUCT-4: das Lifecycle-Set ist genau die 5 bekannten Hooks – ein neuer
        # Hook, der versehentlich als lifecycle markiert wird, fällt hier auf.
        assert _classified(CorePlusBehavior, "lifecycle") == _KNOWN_LIFECYCLE

    def test_unclassified_method_breaks_build(self):
        # AC-STRUCT-2/3 + Edge 2: eine Methode OHNE @gate/@lifecycle bricht den
        # Generator hart ab (Boot-Fehler), KEIN stilles Falsch-Routing.
        class BadCore:
            @gate
            def ok(self):
                return False

            def forgot_stamp(self):   # absichtlich kein Stempel
                return False

        class _D(_PlusBehaviorDispatcher):
            pass

        with pytest.raises(RuntimeError, match="nicht klassifiziert"):
            _build_dispatch_methods(_D, BadCore)

    def test_sixth_lifecycle_hook_must_be_stamped(self):
        # AC-STRUCT-3 / Edge 1+2: würde man einen 6. Lifecycle-Hook ergänzen ohne
        # Stempel, bricht der Build; korrekt gestempelt wird er als lifecycle erkannt.
        class CoreWithStampedHook:
            @lifecycle
            def new_lifecycle_hook(self):
                return None

        class _D(_PlusBehaviorDispatcher):
            pass

        # korrekt gestempelt → kein Fehler
        _build_dispatch_methods(_D, CoreWithStampedHook)
        assert getattr(
            CoreWithStampedHook.new_lifecycle_hook, "_plus_dispatch"
        ) == "lifecycle"

    def test_capabilities_values_are_core_methods(self):
        # PROJ-95 §G + Edge 6: jeder CAPABILITIES-Zielmethodenname existiert auf Core
        # (Drift-Wächter; ein Tippfehler in der Map fällt hier auf).
        core = _public_methods(CorePlusBehavior)
        for key, method_name in CAPABILITIES.items():
            assert method_name in core, \
                f"CAPABILITIES['{key}'] zeigt auf nicht existierende Methode {method_name}"


class TestDispatchBehaviorMatrix:
    """PROJ-95 AC-BEHAVIOR: gate vs. lifecycle × {kein active / Core-Mode / Plus} × sync/async."""

    @staticmethod
    def _mini():
        """Mini-Core (4 klassifizierte Methoden sync/async × gate/lifecycle) + Plus-Stub + Dispatcher-Subklasse."""
        class MiniCore:
            @gate
            def gsync(self):
                return "core"

            @gate
            async def gasync(self):
                return "core"

            @lifecycle
            def lsync(self):
                return "core"

            @lifecycle
            async def lasync(self):
                return "core"

        class StubPlus:
            def gsync(self):
                return "plus"

            async def gasync(self):
                return "plus"

            def lsync(self):
                return "plus"

            async def lasync(self):
                return "plus"

        class _D(_PlusBehaviorDispatcher):
            pass

        _build_dispatch_methods(_D, MiniCore)
        return _D, MiniCore, StubPlus

    def test_no_active_all_core(self, monkeypatch):
        # AC-BEHAVIOR-5: kein active → alle Methoden = Core-Default (auch bei Plus-Edition).
        D, MiniCore, _ = self._mini()
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        d = D(MiniCore())
        assert d.gsync() == "core"
        assert asyncio.run(d.gasync()) == "core"
        assert d.lsync() == "core"
        assert asyncio.run(d.lasync()) == "core"

    def test_active_core_mode_gate_core_lifecycle_plus(self, monkeypatch):
        # AC-BEHAVIOR-1/2: active + is_plus_edition()=False → gate→core, lifecycle→plus.
        D, MiniCore, StubPlus = self._mini()
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        d = D(MiniCore())
        d._set_active(StubPlus())
        assert d.gsync() == "core"                  # gate: Lizenz fehlt → Core
        assert asyncio.run(d.gasync()) == "core"
        assert d.lsync() == "plus"                  # lifecycle: edition-unabhängig
        assert asyncio.run(d.lasync()) == "plus"

    def test_active_plus_mode_all_plus(self, monkeypatch):
        # AC-BEHAVIOR-1/2: active + is_plus_edition()=True → alles Plus.
        D, MiniCore, StubPlus = self._mini()
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        d = D(MiniCore())
        d._set_active(StubPlus())
        assert d.gsync() == "plus"
        assert asyncio.run(d.gasync()) == "plus"
        assert d.lsync() == "plus"
        assert asyncio.run(d.lasync()) == "plus"

    def test_mid_session_license_flip(self, monkeypatch):
        # AC-BEHAVIOR-3 + Edge 4: is_plus_edition() wird PRO AUFRUF ausgewertet – ein
        # Lizenz-Flip mid-session schaltet Gate-Methoden ohne Neustart um; Lifecycle bleibt.
        D, MiniCore, StubPlus = self._mini()
        d = D(MiniCore())
        d._set_active(StubPlus())

        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: True)
        assert d.gsync() == "plus"
        assert d.lsync() == "plus"

        # Lizenz deaktiviert mitten in der Session (PROJ-94 deactivate)
        monkeypatch.setattr("backend.core.plus_protocol.is_plus_edition", lambda: False)
        assert d.gsync() == "core"      # Gate flippt sofort zurück
        assert d.lsync() == "plus"      # Lifecycle läuft weiter aktiv

    def test_async_signature_preserved(self):
        # AC-BEHAVIOR-4: async-Methoden behalten ihre coroutine-Signatur auf dem Dispatcher,
        # sync-Methoden bleiben sync. (Generator wählt Variante via iscoroutinefunction.)
        assert inspect.iscoroutinefunction(
            _PlusBehaviorDispatcher.is_approval_workflow_enabled
        )
        assert not inspect.iscoroutinefunction(
            _PlusBehaviorDispatcher.can_use_alert_presets
        )


class TestDispatchInstanceAttributePrecedence:
    """PROJ-95 AC-TEST-1 + Edge 3: monkeypatch-Instance-Attribut schlägt gate UND lifecycle."""

    def test_monkeypatch_overrides_gate_method(self, monkeypatch):
        monkeypatch.setattr(plus_behavior, "can_use_scheduled_jobs", lambda: True)
        assert plus_behavior.can_use_scheduled_jobs() is True

    def test_monkeypatch_overrides_lifecycle_method(self, monkeypatch):
        # Edge 3: auch eine Lifecycle-Methode lässt sich per Instance-Attribut patchen.
        sentinel = object()
        monkeypatch.setattr(plus_behavior, "ensure_plus_db_tables", lambda: sentinel)
        assert plus_behavior.ensure_plus_db_tables() is sentinel

    def test_unknown_method_raises_attribute_error(self):
        # AC-DECLARE-2: ein Tippfehler-Methodenname schlägt klar fehl (kein stilles None).
        with pytest.raises(AttributeError):
            plus_behavior.this_method_does_not_exist()
