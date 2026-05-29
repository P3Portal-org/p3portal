# p3portal.org
"""PROJ-60: Plus-Proxy-Pattern (Mediator / Inversion of Control).

Community-Code importiert ausschließlich dieses Modul, nie `backend.plus`.
Plus-Code registriert sich beim App-Start via `set_plus_behavior()`.

Nutzung in Routern und Feature-Modulen:

    from backend.core.plus_protocol import plus_behavior

    if plus_behavior.can_use_alert_presets(): ...
    limited = plus_behavior.get_max_users()

Warum Dispatcher statt statischem Singleton?
- `is_plus_edition()` wird zur Laufzeit ausgewertet (Lizenz-Upload mid-session).
- Edge Case 6: Plus-Code vorhanden, Lizenz abgelaufen → Dispatcher schaltet
  automatisch auf Core-Defaults zurück, ohne Boilerplate in jedem Mixin.
- monkeypatch funktioniert unverändert: `setattr(plus_behavior, "method", ...)`
  setzt ein Attribut direkt auf der Dispatcher-Instanz; `__getattr__` wird
  nur gerufen, wenn das Attribut *nicht* im __dict__ ist.
"""
from __future__ import annotations

import logging
from datetime import datetime
from enum import Enum
from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel

from backend.core import license as _license
from backend.core.license import is_plus_edition

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# PROJ-63 Datenmodelle – Playbook-Permission-Entscheidung
# ─────────────────────────────────────────────────────────────────────────────

class PlaybookPermissionDecision(str, Enum):
    """3-Wert-Enum für Playbook-Ausführungs-Entscheidung (PROJ-63 Tech-Design §C).

    ALLOW   – Plus sagt explizit ja (Whitelist-Treffer oder Admin-Kurzschluss).
    DENY    – Plus sagt explizit nein (Whitelist aktiv, User nicht drin / restricted-Mode).
    FALLBACK– Plus hat keine Meinung → Core soll required_role aus meta.yaml prüfen.

    Core-Default ist immer FALLBACK, sodass Pure-Core das Pre-PROJ-49-Verhalten erhält.
    """
    ALLOW    = "allow"
    DENY     = "deny"
    FALLBACK = "fallback"


class AllowedPlaybookEntry(BaseModel):
    """Eintrag in der Liste der für einen User erlaubten Playbooks (PROJ-63 §C)."""
    playbook_name: str
    category: str | None = None
    source: Literal["direct", "group", "default_mode_open", "admin"]
    group_name: str | None = None   # nur bei source="group"


# ─────────────────────────────────────────────────────────────────────────────
# PROJ-62 Datenmodelle – Pool-Berechtigungen + Quota-Ergebnis
# ─────────────────────────────────────────────────────────────────────────────

class PoolGrant(BaseModel):
    """Eine durch Pool-Mitgliedschaft gewährte Ressourcen-Berechtigung."""
    pool_id: int
    node_id: int
    vmid: int | None = None       # None = alle VMs/LXC auf dem Node
    resource_type: str            # "vm" | "lxc" | "node"
    permissions: list[str] = []


class QuotaResult(BaseModel):
    """Ergebnis eines Pool-Quota-Checks vor dem Job-Start."""
    allowed: bool
    exceeded: list[str] = []     # z.B. ["max_vms", "max_cpu_cores"]
    current: dict = {}           # aktuelle Nutzung pro Ressource
    requested: dict = {}         # was der Job anfragt
    limit: dict = {}             # Pool-Limits
    pool_id: int | None = None


# ─────────────────────────────────────────────────────────────────────────────
# PROJ-64 Datenmodell – Approval-Entscheidung
# ─────────────────────────────────────────────────────────────────────────────

class ApprovalDecision(BaseModel):
    """Rückgabe von requires_approval() wenn eine Aktion Freigabe benötigt (PROJ-64 §C).

    Wird als HTTP-202-Body serialisiert. `None` bedeutet: sofort ausführen.
    """
    approval_id: str        # appr_<25-char-ulid>
    action_type: str        # playbook_run | packer_build | vm_delete | …
    action_target: str
    expires_at: datetime
    poll_url: str           # /api/approvals/{approval_id}


# ─────────────────────────────────────────────────────────────────────────────
# Protocol (Schnittstelle) – definiert alle Plus-Capability-Methoden
# ─────────────────────────────────────────────────────────────────────────────

@runtime_checkable
class PlusProtocol(Protocol):
    """Alle Plus-Capability-Methoden als typing.Protocol.

    Neue Plus-Features: Methode hier ergänzen, CorePlusBehavior-Default setzen,
    dann die Methode in einem `*_plus.py`-Mixin überschreiben.
    """

    # ── Gate-Hooks (bool) ────────────────────────────────────────────────────

    def can_use_alert_presets(self) -> bool: ...
    def can_use_alerts_smtp(self) -> bool: ...
    def can_use_theme_editor(self) -> bool: ...
    def can_add_multiple_nodes(self) -> bool: ...
    def can_set_default_node(self) -> bool: ...
    def can_use_scheduled_jobs(self) -> bool: ...
    def can_change_language(self) -> bool: ...
    def can_use_cluster_resources(self) -> bool: ...
    def can_use_multi_node_dashboard(self) -> bool: ...
    def can_use_api_key_max_count_override(self) -> bool: ...
    def can_use_api_key_scopes_full(self) -> bool: ...
    def can_use_sidebar_pins_extended(self) -> bool: ...
    def can_use_compute_alerting(self) -> bool: ...
    def can_use_compute_scheduled_jobs(self) -> bool: ...
    def can_use_approval_workflow(self) -> bool: ...
    def can_use_help_global_overrides(self) -> bool: ...
    def can_use_pools_quotas(self) -> bool: ...
    def can_use_groups_unlimited(self) -> bool: ...
    def can_use_node_assignments(self) -> bool: ...
    def can_use_owners_unlimited(self) -> bool: ...
    def can_use_git_sync(self) -> bool: ...
    def can_use_config_snapshots(self) -> bool: ...

    # ── Limit-Hooks (int | None) ─────────────────────────────────────────────

    def get_max_users(self) -> int | None: ...
    def get_max_presets(self) -> int | None: ...
    def get_max_api_keys(self, user: dict) -> int: ...
    def get_max_groups(self) -> int | None: ...
    def get_max_pools(self) -> int | None: ...
    def get_max_node_assignments(self) -> int | None: ...
    def get_max_sidebar_pins(self) -> int: ...
    def get_max_ownerships(self) -> int | None: ...
    def get_max_approval_rules(self) -> int | None: ...
    def allow_self_approval_supported(self) -> bool: ...
    def get_max_help_overrides_per_user(self) -> int | None: ...
    def get_max_help_global_overrides(self) -> int | None: ...
    def get_max_scheduled_jobs_per_user(self) -> int | None: ...

    # ── Feld-Filter-Hooks (dict → dict) ─────────────────────────────────────

    def filter_alert_notification_fields(self, fields: dict) -> dict: ...
    def get_packer_session_fields(self, data: dict) -> dict: ...
    def get_cluster_node_extra(self, node_data: dict) -> dict: ...

    # ── Pool-Hooks (PROJ-62) ─────────────────────────────────────────────────

    async def get_pool_permissions(self, user_id: int) -> list[PoolGrant]: ...
    async def check_pool_quota(
        self, user_id: int, pool_id: int, deploy_request: dict
    ) -> QuotaResult: ...
    async def get_existing_pool_ids(self, candidate_ids: set[int]) -> set[int]: ...
    async def on_user_deleted_pools(self, user_id: int, actor_username: str) -> int: ...
    async def on_group_deleted_pools(self, group_id: int, actor_username: str) -> int: ...
    async def on_node_deleted_pools(self, node_id: int, actor_username: str) -> int: ...
    async def on_role_preset_deleted_pools(self, preset_id: int, actor_username: str) -> int: ...
    async def on_deploy_success_pool_hook(self, job_id: int) -> None: ...

    # ── Playbook-Permission-Hooks (PROJ-63) ───────────────────────────────────

    def can_use_playbook_permissions(self) -> bool: ...

    async def can_user_execute_playbook(
        self, user_id: int, playbook_name: str
    ) -> PlaybookPermissionDecision: ...

    async def get_playbook_can_execute_map(
        self, user_id: int, playbook_names: list[str]
    ) -> dict[str, PlaybookPermissionDecision]: ...

    async def get_my_allowed_playbooks(
        self, user_id: int
    ) -> list[AllowedPlaybookEntry]: ...

    async def on_user_deleted_playbook_permissions(
        self, user_id: int, actor_username: str
    ) -> int: ...

    async def on_group_deleted_playbook_permissions(
        self, group_id: int, actor_username: str
    ) -> int: ...

    async def on_playbook_deleted_playbook_permissions(
        self, playbook_name: str, actor_username: str
    ) -> int: ...

    async def cleanup_stale_playbook_permissions(
        self, known_playbooks: set[str]
    ) -> int: ...

    def get_extra_portal_permissions(self) -> list[str]: ...

    def ensure_plus_db_tables(self) -> None: ...

    # ── Approval-Workflow-Hooks (PROJ-64) ────────────────────────────────────

    async def requires_approval(
        self,
        action_type: str,
        payload: dict,
        user_id: int,
        username: str,
        meta_fields: list[dict] | None = None,
    ) -> ApprovalDecision | None: ...

    async def is_approval_workflow_enabled(self) -> bool: ...

    async def get_approval_blocked_scheduled_job_ids(
        self, candidate_ids: set[str]
    ) -> set[str]: ...

    async def sync_meta_yaml_approval_rule(
        self,
        action_type: str,
        action_target: str,
        approval_block: dict | None,
    ) -> None: ...

    async def on_user_deleted_approval_workflow(
        self, user_id: int, actor_username: str
    ) -> int: ...

    async def on_group_deleted_approval_workflow(
        self, group_id: int, actor_username: str
    ) -> int: ...

    async def on_playbook_deleted_approval_workflow(
        self, playbook_name: str, actor_username: str
    ) -> int: ...

    async def on_packer_template_deleted_approval_workflow(
        self, template_name: str, actor_username: str
    ) -> int: ...

    async def on_vm_lxc_deleted_approval_workflow(
        self, node_id: str, vmid: int, actor_username: str
    ) -> int: ...

    async def on_approval_rule_updated(
        self, rule_id: int, old: dict, new: dict, actor: str
    ) -> int: ...

    def register_approval_celery_tasks(self, celery_app) -> None: ...

    # ── Tooling-Health-Hooks (PROJ-66) ───────────────────────────────────────

    def get_additional_tooling_checks(self) -> list: ...
    """TODO PROJ-66 Phase 2: Terraform, kubectl, sudo, ...
    Erwartet list[ToolCheckConfig] aus backend.features.tooling.schemas.
    Core-Default gibt [] zurück (nur Ansible+Packer hardcoded).
    """

    # ── Scheduled-Jobs-Hooks (PROJ-70) ──────────────────────────────────────

    async def start_scheduled_job_runner(self) -> None: ...

    def register_scheduled_job_celery_tasks(self, celery_app) -> None: ...

    def get_scheduled_job_action_handlers(self) -> dict: ...

    async def on_user_deleted_scheduled_jobs(
        self, user_id: int, actor_username: str
    ) -> int: ...

    async def on_playbook_deleted_scheduled_jobs(
        self, playbook_name: str, actor_username: str
    ) -> int: ...

    async def on_node_deleted_scheduled_jobs(
        self, node_id, actor_username: str
    ) -> int: ...

    # ── PROJ-74: Config-Snapshot Lifecycle-Hooks ─────────────────────────────

    async def on_vm_lxc_deleted_config_snapshots(
        self,
        portal_node_id: int,
        proxmox_node: str,
        vmid: int,
        kind: str,
        vm_name,
        username: str,
    ) -> int: ...

    async def on_user_deleted_config_snapshots(self, user_id: int) -> None: ...

    async def on_cluster_refresh_vanished_resources_config_snapshots(
        self,
        still_visible_vmids: set,
        portal_node_id: int,
    ) -> None: ...

    async def on_config_snapshot_deleted_cancel_approvals(
        self, snapshot_id: str
    ) -> int: ...


# ─────────────────────────────────────────────────────────────────────────────
# CorePlusBehavior – vollständige Core-Edition-Defaults
# ─────────────────────────────────────────────────────────────────────────────

class CorePlusBehavior:
    """Konkrete Core-Default-Implementierung des PlusProtocol.

    Liefert für jede Methode den Core-Edition-Wert. Plus darf keine Methode
    aufrufen, ohne dass sie hier definiert ist.
    """

    # ── Gate-Hooks ───────────────────────────────────────────────────────────

    def can_use_alert_presets(self) -> bool:
        return False

    def can_use_alerts_smtp(self) -> bool:
        return False

    def can_use_theme_editor(self) -> bool:
        return False

    def can_add_multiple_nodes(self) -> bool:
        return False

    def can_set_default_node(self) -> bool:
        return False

    def can_use_scheduled_jobs(self) -> bool:
        return False

    def can_change_language(self) -> bool:
        return False

    def can_use_cluster_resources(self) -> bool:
        return False

    def can_use_multi_node_dashboard(self) -> bool:
        return False

    def can_use_api_key_max_count_override(self) -> bool:
        return False

    def can_use_api_key_scopes_full(self) -> bool:
        return False

    def can_use_sidebar_pins_extended(self) -> bool:
        return False

    def can_use_compute_alerting(self) -> bool:
        return False

    def can_use_compute_scheduled_jobs(self) -> bool:
        return False

    def can_use_approval_workflow(self) -> bool:
        return False

    def can_use_help_global_overrides(self) -> bool:
        return False

    def can_use_pools_quotas(self) -> bool:
        return False

    def can_use_groups_unlimited(self) -> bool:
        return False

    def can_use_node_assignments(self) -> bool:
        return False

    def can_use_owners_unlimited(self) -> bool:
        return False

    def can_use_git_sync(self) -> bool:
        return False

    def can_use_config_snapshots(self) -> bool:
        return False

    # ── Limit-Hooks ──────────────────────────────────────────────────────────

    def get_max_users(self) -> int | None:
        return _license.CORE_MAX_USERS

    def get_max_presets(self) -> int | None:
        return _license.CORE_MAX_PRESETS

    def get_max_api_keys(self, user: dict) -> int:
        from backend.services.user_api_key_service import CORE_MAX_KEYS
        return CORE_MAX_KEYS

    def get_max_groups(self) -> int | None:
        return _license.CORE_MAX_GROUPS

    def get_max_pools(self) -> int | None:
        return _license.CORE_MAX_POOLS

    def get_max_node_assignments(self) -> int | None:
        return _license.CORE_MAX_NODE_ASSIGNMENTS

    def get_max_sidebar_pins(self) -> int:
        return _license.CORE_MAX_SIDEBAR_PINS

    def get_max_ownerships(self) -> int | None:
        return _license.CORE_MAX_OWNERSHIPS

    def get_max_approval_rules(self) -> int | None:
        return _license.CORE_MAX_APPROVAL_RULES

    def allow_self_approval_supported(self) -> bool:
        return False

    def get_max_help_overrides_per_user(self) -> int | None:
        return _license.CORE_MAX_HELP_OVERRIDES_PER_USER

    def get_max_help_global_overrides(self) -> int | None:
        return _license.CORE_MAX_HELP_GLOBAL_OVERRIDES

    def get_max_scheduled_jobs_per_user(self) -> int | None:
        return _license.CORE_MAX_SCHEDULED_JOBS_PER_USER

    # ── Feld-Filter-Hooks ────────────────────────────────────────────────────

    def filter_alert_notification_fields(self, fields: dict) -> dict:
        return {
            **fields,
            "webhook_url": None,
            "webhook_token": None,
            "email_recipients": None,
        }

    def get_packer_session_fields(self, data: dict) -> dict:
        return {}

    def get_cluster_node_extra(self, node_data: dict) -> dict:
        return {}

    # ── Pool-Hooks (PROJ-62) ─────────────────────────────────────────────────

    async def get_pool_permissions(self, user_id: int) -> list[PoolGrant]:
        return []

    async def check_pool_quota(
        self, user_id: int, pool_id: int, deploy_request: dict
    ) -> QuotaResult:
        return QuotaResult(allowed=True)

    async def get_existing_pool_ids(self, candidate_ids: set[int]) -> set[int]:
        return set()

    async def on_user_deleted_pools(self, user_id: int, actor_username: str) -> int:
        return 0

    async def on_group_deleted_pools(self, group_id: int, actor_username: str) -> int:
        return 0

    async def on_node_deleted_pools(self, node_id: int, actor_username: str) -> int:
        return 0

    async def on_role_preset_deleted_pools(self, preset_id: int, actor_username: str) -> int:
        return 0

    async def on_deploy_success_pool_hook(self, job_id: int) -> None:
        pass

    # ── Playbook-Permission-Hooks (PROJ-63) Core-Defaults ───────────────────

    def can_use_playbook_permissions(self) -> bool:
        return False

    async def can_user_execute_playbook(
        self, user_id: int, playbook_name: str
    ) -> PlaybookPermissionDecision:
        # Core hat keine Meinung → required_role-Fallback im Resolver
        return PlaybookPermissionDecision.FALLBACK

    async def get_playbook_can_execute_map(
        self, user_id: int, playbook_names: list[str]
    ) -> dict[str, PlaybookPermissionDecision]:
        return {n: PlaybookPermissionDecision.FALLBACK for n in playbook_names}

    async def get_my_allowed_playbooks(
        self, user_id: int
    ) -> list[AllowedPlaybookEntry]:
        return []

    async def on_user_deleted_playbook_permissions(
        self, user_id: int, actor_username: str
    ) -> int:
        return 0

    async def on_group_deleted_playbook_permissions(
        self, group_id: int, actor_username: str
    ) -> int:
        return 0

    async def on_playbook_deleted_playbook_permissions(
        self, playbook_name: str, actor_username: str
    ) -> int:
        return 0

    async def cleanup_stale_playbook_permissions(
        self, known_playbooks: set[str]
    ) -> int:
        return 0

    def get_extra_portal_permissions(self) -> list[str]:
        # generischer Permission-Whitelist-Hook (PROJ-63 §C); in Plus via _PlusGateBehavior
        # erweitert (PROJ-64 kann hier z.B. "approve_jobs" hinzufügen)
        return []

    def ensure_plus_db_tables(self) -> None:
        # Core-Edition: keine Plus-Tabellen nötig – No-Op.
        return

    # ── Approval-Workflow-Hooks (PROJ-64) Core-Defaults ─────────────────────

    async def requires_approval(
        self,
        action_type: str,
        payload: dict,
        user_id: int,
        username: str,
        meta_fields: list[dict] | None = None,
    ) -> ApprovalDecision | None:
        # Core: immer sofort ausführen, kein Approval-Konzept
        return None

    async def is_approval_workflow_enabled(self) -> bool:
        return False

    async def get_approval_blocked_scheduled_job_ids(
        self, candidate_ids: set[str]
    ) -> set[str]:
        # Core: kein Filter, alle Kandidaten laufen durch
        return set()

    async def sync_meta_yaml_approval_rule(
        self,
        action_type: str,
        action_target: str,
        approval_block: dict | None,
    ) -> None:
        return

    async def on_user_deleted_approval_workflow(
        self, user_id: int, actor_username: str
    ) -> int:
        return 0

    async def on_group_deleted_approval_workflow(
        self, group_id: int, actor_username: str
    ) -> int:
        return 0

    async def on_playbook_deleted_approval_workflow(
        self, playbook_name: str, actor_username: str
    ) -> int:
        return 0

    async def on_packer_template_deleted_approval_workflow(
        self, template_name: str, actor_username: str
    ) -> int:
        return 0

    async def on_vm_lxc_deleted_approval_workflow(
        self, node_id: str, vmid: int, actor_username: str
    ) -> int:
        return 0

    async def on_approval_rule_updated(
        self, rule_id: int, old: dict, new: dict, actor: str
    ) -> int:
        # Wird nur aus Plus-Code gerufen; Core-Default für Test-Mocking
        return 0

    def register_approval_celery_tasks(self, celery_app) -> None:
        # Core: kein expire_overdue-Task
        return

    # ── Tooling-Health-Hooks (PROJ-66) Core-Defaults ────────────────────────

    def get_additional_tooling_checks(self) -> list:
        # TODO PROJ-66 Phase 2: Terraform, kubectl, sudo, …
        # Plus überschreibt dies und gibt list[ToolCheckConfig] zurück.
        return []

    # ── Scheduled-Jobs-Hooks (PROJ-70) Core-Defaults ────────────────────────

    async def start_scheduled_job_runner(self) -> None:
        # Core: kein Runner starten (Scheduled Jobs sind Plus-only)
        return

    def register_scheduled_job_celery_tasks(self, celery_app) -> None:
        # Core: kein Beat-Schedule, keine execute-Tasks
        return

    def get_scheduled_job_action_handlers(self) -> dict:
        # Core: kein Handler-Dict (Scheduled Jobs nicht verfügbar)
        return {}

    async def on_user_deleted_scheduled_jobs(
        self, user_id: int, actor_username: str
    ) -> int:
        return 0

    async def on_playbook_deleted_scheduled_jobs(
        self, playbook_name: str, actor_username: str
    ) -> int:
        return 0

    async def on_node_deleted_scheduled_jobs(
        self, node_id, actor_username: str
    ) -> int:
        return 0

    # ── PROJ-74: Config-Snapshot Lifecycle-Hooks (Core: no-ops) ─────────────

    async def on_vm_lxc_deleted_config_snapshots(
        self, portal_node_id, proxmox_node, vmid, kind, vm_name, username
    ) -> int:
        return 0

    async def on_user_deleted_config_snapshots(self, user_id: int) -> None:
        return

    async def on_cluster_refresh_vanished_resources_config_snapshots(
        self, still_visible_vmids, portal_node_id
    ) -> None:
        return

    async def on_config_snapshot_deleted_cancel_approvals(
        self, snapshot_id: str
    ) -> int:
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher – schaltet pro Aufruf zwischen Core und Plus
# ─────────────────────────────────────────────────────────────────────────────

class _PlusBehaviorDispatcher:
    """Proxy: wählt pro Methodenaufruf Core- oder Plus-Implementierung.

    Dispatcher-Instanz ist das öffentliche `plus_behavior`-Singleton.
    monkeypatch setzt Attribute direkt auf dieser Instanz; `__getattr__`
    greift nur, wenn das Attribut *nicht* im Instance-Dict ist.
    """

    def __init__(self, core: CorePlusBehavior) -> None:
        object.__setattr__(self, "_core", core)
        object.__setattr__(self, "_active", None)

    def __getattr__(self, name: str):
        active = object.__getattribute__(self, "_active")
        core = object.__getattribute__(self, "_core")
        impl = active if (active is not None and is_plus_edition()) else core
        return getattr(impl, name)

    def ensure_plus_db_tables(self) -> None:
        """Lifecycle-Methode – läuft IMMER auf der aktiven Impl., unabhängig von is_plus_edition().

        ensure_plus_db_tables ist kein Feature-Gate sondern DB-Schema-Setup.
        PROJ-70: scheduled_jobs wurde aus dem Core-Schema entfernt; auch Core-Nutzer
        (Plus-Build ohne Lizenz) brauchen die Tabelle → kein is_plus_edition()-Gate.
        """
        active = object.__getattribute__(self, "_active")
        if active is not None:
            active.ensure_plus_db_tables()
        else:
            core = object.__getattribute__(self, "_core")
            core.ensure_plus_db_tables()

    async def start_scheduled_job_runner(self) -> None:
        """Lifecycle-Hook – läuft IMMER auf der aktiven Impl.

        PROJ-70: Scheduled Jobs sind in Core mit Limit 3/User unterstützt.
        Der Runner-Loop ist Infrastruktur, kein Feature-Gate. Das Limit selbst
        kommt weiterhin über get_max_scheduled_jobs_per_user (geht durch __getattr__).
        """
        active = object.__getattribute__(self, "_active")
        if active is not None:
            await active.start_scheduled_job_runner()
        else:
            core = object.__getattribute__(self, "_core")
            await core.start_scheduled_job_runner()

    def register_scheduled_job_celery_tasks(self, celery_app) -> None:
        """Lifecycle-Hook – läuft IMMER auf der aktiven Impl. (siehe start_scheduled_job_runner)."""
        active = object.__getattribute__(self, "_active")
        if active is not None:
            active.register_scheduled_job_celery_tasks(celery_app)
        else:
            core = object.__getattribute__(self, "_core")
            core.register_scheduled_job_celery_tasks(celery_app)

    def get_scheduled_job_action_handlers(self) -> dict:
        """Lifecycle-Hook – Handler-Registry wird vom Runner gebraucht, auch in Core-Mode."""
        active = object.__getattribute__(self, "_active")
        if active is not None:
            return active.get_scheduled_job_action_handlers()
        core = object.__getattribute__(self, "_core")
        return core.get_scheduled_job_action_handlers()

    def _set_active(self, impl) -> None:
        object.__setattr__(self, "_active", impl)


# ─────────────────────────────────────────────────────────────────────────────
# Öffentliches Singleton + Loader-API
# ─────────────────────────────────────────────────────────────────────────────

_dispatcher = _PlusBehaviorDispatcher(core=CorePlusBehavior())

# Einziges öffentliches Tor zu Plus-Verhalten für Community-Code:
plus_behavior: PlusProtocol = _dispatcher  # type: ignore[assignment]


def set_plus_behavior(impl) -> None:
    """Registriert die Plus-Implementierung. Wird nur von backend.plus.__init__ gerufen."""
    _dispatcher._set_active(impl)
    logger.info("Plus-Behavior registriert: %s", type(impl).__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Capabilities-Map (Source-of-Truth für /api/capabilities)
# ─────────────────────────────────────────────────────────────────────────────

# Mapping: Capability-Key → Methode auf plus_behavior.
# Der /api/capabilities-Endpoint ruft jede Methode auf und liefert {key: bool}.
CAPABILITIES: dict[str, str] = {
    "alert_presets":              "can_use_alert_presets",
    "alerts_smtp":                "can_use_alerts_smtp",
    "theme_editor":               "can_use_theme_editor",
    "multiple_nodes":             "can_add_multiple_nodes",
    "default_node":               "can_set_default_node",
    "scheduled_jobs":             "can_use_scheduled_jobs",
    "language_change":            "can_change_language",
    "cluster_resources_packer":   "can_use_cluster_resources",
    "multi_node_dashboard":       "can_use_multi_node_dashboard",
    "api_key_max_count_override": "can_use_api_key_max_count_override",
    "api_key_scopes_full":        "can_use_api_key_scopes_full",
    "sidebar_pins_extended":      "can_use_sidebar_pins_extended",
    "compute_alerting":           "can_use_compute_alerting",
    "compute_scheduled_jobs":     "can_use_compute_scheduled_jobs",
    "approval_workflow":              "can_use_approval_workflow",
    "help_global_overrides":          "can_use_help_global_overrides",
    "pools_quotas":                   "can_use_pools_quotas",
    "groups_unlimited":               "can_use_groups_unlimited",
    "node_assignments":               "can_use_node_assignments",
    "owners_unlimited":               "can_use_owners_unlimited",
    "playbook_permissions":           "can_use_playbook_permissions",
    "config_snapshots":               "can_use_config_snapshots",
    # PROJ-64: Self-Approval-Gate (sync, editions-abhängig)
    "allow_self_approval_supported":  "allow_self_approval_supported",
}
# Hinweis: is_approval_workflow_enabled ist async (DB-Zugriff) und daher NICHT in
# CAPABILITIES – der Master-Toggle-Status kommt via GET /api/admin/approval-workflow.
