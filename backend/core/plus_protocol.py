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
  setzt ein Attribut direkt auf der Dispatcher-Instanz; das gepatchte
  Instance-Attribut überschattet die generierte Dispatcher-Methode.

PROJ-95 (Dispatcher-Refactor):
- Die früheren `__getattr__`-Magie + 5 handgeschriebene Lifecycle-Overrides sind
  durch **explizit generierte Methoden** ersetzt. Jede der 101 CorePlusBehavior-
  Methoden trägt einen Pflicht-Stempel `@gate` ODER `@lifecycle`; der Generator
  (`_build_dispatch_methods`) erzeugt daraus pro Methode genau einen von vier
  Wrappern (sync/async × gate/lifecycle). Eine unklassifizierte Methode bricht
  hart beim Import (RuntimeError) – „Lifecycle-Hook vergessen" (BUG-70-4) ist
  damit strukturell unmöglich.
- Der monkeypatch-Vorrang bleibt erhalten, weil generierte Methoden normale
  Non-Data-Descriptors sind: Instance-`__dict__` schlägt das Klassen-Attribut.
"""
from __future__ import annotations

import inspect
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
# PROJ-83 Datenmodell – Gast-Run-Scope (Pool/Global, Plus)
# ─────────────────────────────────────────────────────────────────────────────

class GuestScope(BaseModel):
    """Auflösung eines Pool-/Global-Scopes für einen In-Guest-Playbook-Run.

    Wird vom Plus-Mediator zurückgegeben. `private_key` ist der Klartext-Private-Key
    des Scopes (Pool- bzw. Global-Key) und bleibt IN-PROCESS – wird nie serialisiert
    oder in API-Responses/Logs ausgegeben (konsistent mit get_ssh_job_key_decrypted).
    """
    scope: str                                     # "pool" | "global"
    scope_ref: int | None = None                   # pool_id bei scope="pool"
    private_key: str                               # OpenSSH-Private-Key (in-process)
    candidate_hosts: list[tuple[int, int, str]] = []  # (portal_node_id, vmid, kind)


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
    def can_use_auto_snapshots(self) -> bool: ...
    def can_use_stacks(self) -> bool: ...
    def can_use_ansible_inventory(self) -> bool: ...
    def can_use_topology(self) -> bool: ...
    def can_use_packer_editor(self) -> bool: ...
    def can_use_ansible_editor(self) -> bool: ...

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
    async def check_pool_quota_bulk(
        self, user_id: int, pool_id: int, vm_count: int,
        total_cores: int, total_ram_mb: int, total_disk_gb: int,
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

    # ── Auto-Snapshots-Hooks (PROJ-77) ───────────────────────────────────────

    async def on_user_deleted_auto_snapshots(
        self, user_id: int, actor_username: str
    ) -> int: ...

    async def on_vm_lxc_deleted_auto_snapshots(
        self, portal_node_id: int, vmid: int, kind: str, actor_username: str
    ) -> int: ...

    async def on_node_deleted_auto_snapshots(
        self, node_id, actor_username: str
    ) -> int: ...

    def get_auto_snapshot_approval_action_types(self) -> list[str]: ...

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

    # ── PROJ-76: Stacks-Hooks ────────────────────────────────────────────────

    async def on_user_deleted_stacks(self, user_id: int) -> int: ...

    def get_stack_approval_action_types(self) -> list[str]: ...

    async def on_stack_deleted_cancel_approvals(self, stack_id: int) -> int: ...

    # ── PROJ-76 Phase 2b: Mutations-Block-Lookup ─────────────────────────────
    async def get_stack_for_vm(
        self, portal_node_id: int, vmid: int
    ) -> dict | None: ...

    def cancel_stack_job(self, stack_id: int) -> bool: ...

    # ── PROJ-91: stack-firewall mutations-block lookup ───────────────────────
    async def get_stack_firewall_for_vm(
        self, portal_node_id: int, vmid: int
    ) -> dict | None: ...

    # ── PROJ-83: Ansible-Inventory-Hooks ─────────────────────────────────────

    async def resolve_guest_scope(
        self, scope: str, scope_ref: int | None, user_id: int
    ) -> "GuestScope | None": ...

    async def get_injection_public_keys_extra(
        self, pool_id: int | None, global_opt_in: bool
    ) -> list[str]: ...

    # ── PROJ-96: VM-Abhängigkeiten & Aktions-Impact-Warnung ──────────────────

    def can_use_dependencies(self) -> bool: ...

    async def get_dependents_of_vm(
        self, portal_node_id: int, vmid: int
    ) -> list[dict]: ...

    async def on_vm_lxc_deleted_dependencies(
        self, portal_node_id: int, vmid: int, username: str
    ) -> int: ...

    async def on_cluster_refresh_vanished_resources_dependencies(
        self, still_visible_vmids: set, portal_node_id: int
    ) -> int: ...


# ─────────────────────────────────────────────────────────────────────────────
# PROJ-95: Dispatch-Klassifikation (Pflicht-Stempel, KEIN Default)
# ─────────────────────────────────────────────────────────────────────────────
#
# Jede CorePlusBehavior-Methode MUSS mit @gate ODER @lifecycle dekoriert sein.
# Der Generator (_build_dispatch_methods) liest diesen Stempel und erzeugt pro
# Methode eine explizite Dispatcher-Methode. Eine Methode OHNE Stempel führt zu
# einem harten Boot-Fehler (RuntimeError beim Import) – „Lifecycle-Hook vergessen"
# (BUG-70-4) wird damit strukturell unmöglich. Es gibt KEINEN sicheren Default:
# „Default = gate" würde einen vergessenen Lifecycle-Hook still zum Gate machen
# (BUG-70-4 kehrt zurück); „Default = lifecycle" würde einen vergessenen Gate-Hook
# im Core-Mode aktiv schalten (Lizenz-Bypass). Der Pflicht-Stempel eliminiert beide.
#
#   @gate      – Plus-Verhalten NUR mit gültiger Lizenz (is_plus_edition()),
#                sonst Core-Default. (~96 Feature-/Limit-/Cleanup-Hooks)
#   @lifecycle – aktive Impl. IMMER sobald registriert – edition-unabhängig,
#                läuft auch im Plus-Image OHNE Lizenz (Infrastruktur: DB-Setup,
#                Scheduled-Job-Runner/-Tasks/-Handler, OpenTofu-Tooling-Indikator).

def gate(func):
    """Stempelt eine CorePlusBehavior-Methode als Feature-Gate (lizenz-abhängig)."""
    func._plus_dispatch = "gate"
    return func


def lifecycle(func):
    """Stempelt eine CorePlusBehavior-Methode als Lifecycle-Hook (edition-unabhängig)."""
    func._plus_dispatch = "lifecycle"
    return func


# ─────────────────────────────────────────────────────────────────────────────
# CorePlusBehavior – vollständige Core-Edition-Defaults
# ─────────────────────────────────────────────────────────────────────────────

class CorePlusBehavior:
    """Konkrete Core-Default-Implementierung des PlusProtocol.

    Liefert für jede Methode den Core-Edition-Wert. Plus darf keine Methode
    aufrufen, ohne dass sie hier definiert ist.

    PROJ-95: Jede Methode trägt einen Pflicht-Stempel @gate ODER @lifecycle.
    """

    # ── Gate-Hooks ───────────────────────────────────────────────────────────

    @gate
    def can_use_alert_presets(self) -> bool:
        return False

    @gate
    def can_use_alerts_smtp(self) -> bool:
        return False

    @gate
    def can_use_theme_editor(self) -> bool:
        return False

    @gate
    def can_add_multiple_nodes(self) -> bool:
        return False

    @gate
    def can_set_default_node(self) -> bool:
        return False

    @gate
    def can_use_scheduled_jobs(self) -> bool:
        return False

    @gate
    def can_change_language(self) -> bool:
        return False

    @gate
    def can_use_cluster_resources(self) -> bool:
        return False

    @gate
    def can_use_multi_node_dashboard(self) -> bool:
        return False

    @gate
    def can_use_api_key_max_count_override(self) -> bool:
        return False

    @gate
    def can_use_api_key_scopes_full(self) -> bool:
        return False

    @gate
    def can_use_sidebar_pins_extended(self) -> bool:
        return False

    @gate
    def can_use_compute_alerting(self) -> bool:
        return False

    @gate
    def can_use_compute_scheduled_jobs(self) -> bool:
        return False

    @gate
    def can_use_approval_workflow(self) -> bool:
        return False

    @gate
    def can_use_help_global_overrides(self) -> bool:
        return False

    @gate
    def can_use_pools_quotas(self) -> bool:
        return False

    @gate
    def can_use_groups_unlimited(self) -> bool:
        return False

    @gate
    def can_use_node_assignments(self) -> bool:
        return False

    @gate
    def can_use_owners_unlimited(self) -> bool:
        return False

    @gate
    def can_use_git_sync(self) -> bool:
        return False

    @gate
    def can_use_config_snapshots(self) -> bool:
        return False

    @gate
    def can_use_auto_snapshots(self) -> bool:
        return False

    @gate
    def can_use_stacks(self) -> bool:
        return False

    @gate
    def can_use_ansible_inventory(self) -> bool:
        # PROJ-83: Pool-/Global-Scope + Key-Management sind Plus-only.
        return False

    @gate
    def can_use_topology(self) -> bool:
        # PROJ-75: Cluster-Topologie-Ansicht ist Plus-only.
        return False

    @gate
    def can_use_packer_editor(self) -> bool:
        # PROJ-92: Packer Visual Editor ist Plus-only.
        return False

    @gate
    def can_use_ansible_editor(self) -> bool:
        # PROJ-93: Ansible Visual Editor ist Plus-only.
        return False

    @gate
    def can_use_dependencies(self) -> bool:
        # PROJ-96: VM-Abhängigkeiten & Aktions-Impact-Warnung sind Plus-only.
        return False

    # ── Limit-Hooks ──────────────────────────────────────────────────────────

    @gate
    def get_max_users(self) -> int | None:
        return _license.CORE_MAX_USERS

    @gate
    def get_max_presets(self) -> int | None:
        return _license.CORE_MAX_PRESETS

    @gate
    def get_max_api_keys(self, user: dict) -> int:
        from backend.services.user_api_key_service import CORE_MAX_KEYS
        return CORE_MAX_KEYS

    @gate
    def get_max_groups(self) -> int | None:
        return _license.CORE_MAX_GROUPS

    @gate
    def get_max_pools(self) -> int | None:
        return _license.CORE_MAX_POOLS

    @gate
    def get_max_node_assignments(self) -> int | None:
        return _license.CORE_MAX_NODE_ASSIGNMENTS

    @gate
    def get_max_sidebar_pins(self) -> int:
        return _license.CORE_MAX_SIDEBAR_PINS

    @gate
    def get_max_ownerships(self) -> int | None:
        return _license.CORE_MAX_OWNERSHIPS

    @gate
    def get_max_approval_rules(self) -> int | None:
        return _license.CORE_MAX_APPROVAL_RULES

    @gate
    def allow_self_approval_supported(self) -> bool:
        return False

    @gate
    def get_max_help_overrides_per_user(self) -> int | None:
        return _license.CORE_MAX_HELP_OVERRIDES_PER_USER

    @gate
    def get_max_help_global_overrides(self) -> int | None:
        return _license.CORE_MAX_HELP_GLOBAL_OVERRIDES

    @gate
    def get_max_scheduled_jobs_per_user(self) -> int | None:
        return _license.CORE_MAX_SCHEDULED_JOBS_PER_USER

    # ── Feld-Filter-Hooks ────────────────────────────────────────────────────

    @gate
    def filter_alert_notification_fields(self, fields: dict) -> dict:
        return {
            **fields,
            "webhook_url": None,
            "webhook_token": None,
            "email_recipients": None,
        }

    @gate
    def get_packer_session_fields(self, data: dict) -> dict:
        return {}

    @gate
    def get_cluster_node_extra(self, node_data: dict) -> dict:
        return {}

    # ── Pool-Hooks (PROJ-62) ─────────────────────────────────────────────────

    @gate
    async def get_pool_permissions(self, user_id: int) -> list[PoolGrant]:
        return []

    @gate
    async def check_pool_quota(
        self, user_id: int, pool_id: int, deploy_request: dict
    ) -> QuotaResult:
        return QuotaResult(allowed=True)

    @gate
    async def check_pool_quota_bulk(
        self, user_id: int, pool_id: int, vm_count: int,
        total_cores: int, total_ram_mb: int, total_disk_gb: int,
    ) -> QuotaResult:
        return QuotaResult(allowed=True)

    @gate
    async def get_existing_pool_ids(self, candidate_ids: set[int]) -> set[int]:
        return set()

    @gate
    async def on_user_deleted_pools(self, user_id: int, actor_username: str) -> int:
        return 0

    @gate
    async def on_group_deleted_pools(self, group_id: int, actor_username: str) -> int:
        return 0

    @gate
    async def on_node_deleted_pools(self, node_id: int, actor_username: str) -> int:
        return 0

    @gate
    async def on_role_preset_deleted_pools(self, preset_id: int, actor_username: str) -> int:
        return 0

    @gate
    async def on_deploy_success_pool_hook(self, job_id: int) -> None:
        pass

    # ── Playbook-Permission-Hooks (PROJ-63) Core-Defaults ───────────────────

    @gate
    def can_use_playbook_permissions(self) -> bool:
        return False

    @gate
    async def can_user_execute_playbook(
        self, user_id: int, playbook_name: str
    ) -> PlaybookPermissionDecision:
        # Core hat keine Meinung → required_role-Fallback im Resolver
        return PlaybookPermissionDecision.FALLBACK

    @gate
    async def get_playbook_can_execute_map(
        self, user_id: int, playbook_names: list[str]
    ) -> dict[str, PlaybookPermissionDecision]:
        return {n: PlaybookPermissionDecision.FALLBACK for n in playbook_names}

    @gate
    async def get_my_allowed_playbooks(
        self, user_id: int
    ) -> list[AllowedPlaybookEntry]:
        return []

    @gate
    async def on_user_deleted_playbook_permissions(
        self, user_id: int, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_group_deleted_playbook_permissions(
        self, group_id: int, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_playbook_deleted_playbook_permissions(
        self, playbook_name: str, actor_username: str
    ) -> int:
        return 0

    @gate
    async def cleanup_stale_playbook_permissions(
        self, known_playbooks: set[str]
    ) -> int:
        return 0

    @gate
    def get_extra_portal_permissions(self) -> list[str]:
        # generischer Permission-Whitelist-Hook (PROJ-63 §C); in Plus via _PlusGateBehavior
        # erweitert (PROJ-64 kann hier z.B. "approve_jobs" hinzufügen)
        return []

    @lifecycle
    def ensure_plus_db_tables(self) -> None:
        # Core-Edition: keine Plus-Tabellen nötig – No-Op.
        # Lifecycle: läuft auch im Plus-Image ohne Lizenz (DB-Schema-Setup, PROJ-70).
        return

    # ── Approval-Workflow-Hooks (PROJ-64) Core-Defaults ─────────────────────

    @gate
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

    @gate
    async def is_approval_workflow_enabled(self) -> bool:
        return False

    @gate
    async def get_approval_blocked_scheduled_job_ids(
        self, candidate_ids: set[str]
    ) -> set[str]:
        # Core: kein Filter, alle Kandidaten laufen durch
        return set()

    @gate
    async def sync_meta_yaml_approval_rule(
        self,
        action_type: str,
        action_target: str,
        approval_block: dict | None,
    ) -> None:
        return

    @gate
    async def on_user_deleted_approval_workflow(
        self, user_id: int, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_group_deleted_approval_workflow(
        self, group_id: int, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_playbook_deleted_approval_workflow(
        self, playbook_name: str, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_packer_template_deleted_approval_workflow(
        self, template_name: str, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_vm_lxc_deleted_approval_workflow(
        self, node_id: str, vmid: int, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_approval_rule_updated(
        self, rule_id: int, old: dict, new: dict, actor: str
    ) -> int:
        # Wird nur aus Plus-Code gerufen; Core-Default für Test-Mocking
        return 0

    @gate
    def register_approval_celery_tasks(self, celery_app) -> None:
        # Core: kein expire_overdue-Task
        return

    # ── Tooling-Health-Hooks (PROJ-66) Core-Defaults ────────────────────────

    @lifecycle
    def get_additional_tooling_checks(self) -> list:
        # TODO PROJ-66 Phase 2: Terraform, kubectl, sudo, …
        # Plus überschreibt dies und gibt list[ToolCheckConfig] zurück.
        # Lifecycle: binary-gekoppelt, läuft auch im Plus-Image ohne Lizenz.
        return []

    # ── Scheduled-Jobs-Hooks (PROJ-70) Core-Defaults ────────────────────────

    @lifecycle
    async def start_scheduled_job_runner(self) -> None:
        # Core: kein Runner starten (Scheduled Jobs sind Plus-only)
        # Lifecycle: Runner-Infrastruktur, läuft auch im Plus-Image ohne Lizenz.
        return

    @lifecycle
    def register_scheduled_job_celery_tasks(self, celery_app) -> None:
        # Core: kein Beat-Schedule, keine execute-Tasks
        # Lifecycle: Celery-Task-Registrierung, edition-unabhängig.
        return

    @lifecycle
    def get_scheduled_job_action_handlers(self) -> dict:
        # Core: kein Handler-Dict (Scheduled Jobs nicht verfügbar)
        # Lifecycle: Handler-Registry wird vom Runner gebraucht, auch in Core-Mode.
        return {}

    @gate
    async def on_user_deleted_scheduled_jobs(
        self, user_id: int, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_playbook_deleted_scheduled_jobs(
        self, playbook_name: str, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_node_deleted_scheduled_jobs(
        self, node_id, actor_username: str
    ) -> int:
        return 0

    # ── Auto-Snapshots-Hooks (PROJ-77) Core-Defaults ────────────────────────

    @gate
    async def on_user_deleted_auto_snapshots(
        self, user_id: int, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_vm_lxc_deleted_auto_snapshots(
        self, portal_node_id: int, vmid: int, kind: str, actor_username: str
    ) -> int:
        return 0

    @gate
    async def on_node_deleted_auto_snapshots(
        self, node_id, actor_username: str
    ) -> int:
        return 0

    @gate
    def get_auto_snapshot_approval_action_types(self) -> list[str]:
        # Core: keine Approval-Integration für Auto-Snapshots
        return []

    # ── PROJ-74: Config-Snapshot Lifecycle-Hooks (Core: no-ops) ─────────────

    @gate
    async def on_vm_lxc_deleted_config_snapshots(
        self, portal_node_id, proxmox_node, vmid, kind, vm_name, username
    ) -> int:
        return 0

    @gate
    async def on_user_deleted_config_snapshots(self, user_id: int) -> None:
        return

    @gate
    async def on_cluster_refresh_vanished_resources_config_snapshots(
        self, still_visible_vmids, portal_node_id
    ) -> None:
        return

    @gate
    async def on_config_snapshot_deleted_cancel_approvals(
        self, snapshot_id: str
    ) -> int:
        return 0

    # ── PROJ-76: Stacks-Hooks (Core: no-ops) ────────────────────────────────

    @gate
    async def on_user_deleted_stacks(self, user_id: int) -> int:
        return 0

    @gate
    def get_stack_approval_action_types(self) -> list[str]:
        return []

    @gate
    async def on_stack_deleted_cancel_approvals(self, stack_id: int) -> int:
        return 0

    # ── PROJ-76 Phase 2b: Mutations-Block-Lookup (Core: None, no-op) ─────────
    @gate
    async def get_stack_for_vm(
        self, portal_node_id: int, vmid: int
    ) -> dict | None:
        return None

    @gate
    def cancel_stack_job(self, stack_id: int) -> bool:
        return False

    # ── PROJ-91: stack-firewall mutations-block lookup (Core: None, no-op) ────
    @gate
    async def get_stack_firewall_for_vm(
        self, portal_node_id: int, vmid: int
    ) -> dict | None:
        return None

    # ── PROJ-83: Ansible-Inventory-Hooks (Core-Defaults) ─────────────────────

    @gate
    async def resolve_guest_scope(
        self, scope: str, scope_ref: int | None, user_id: int
    ) -> "GuestScope | None":
        # Core kennt nur den User-Scope (lokal aufgelöst). Pool/Global sind Plus.
        return None

    @gate
    async def get_injection_public_keys_extra(
        self, pool_id: int | None, global_opt_in: bool
    ) -> list[str]:
        # Core: keine Pool-/Global-Pubkeys (nur der User-Key, den der Resolver selbst ergänzt).
        return []

    # ── PROJ-96: VM-Abhängigkeiten (Core: keine Warnung, keine Kanten) ────────

    @gate
    async def get_dependents_of_vm(
        self, portal_node_id: int, vmid: int
    ) -> list[dict]:
        # Core: kein Abhängigkeits-Konzept → keine Warnung (Hook No-Op, AC-IMPACT-6).
        return []

    @gate
    async def on_vm_lxc_deleted_dependencies(
        self, portal_node_id: int, vmid: int, username: str
    ) -> int:
        return 0

    @gate
    async def on_cluster_refresh_vanished_resources_dependencies(
        self, still_visible_vmids: set, portal_node_id: int
    ) -> int:
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# Dispatcher – schaltet pro Aufruf zwischen Core und Plus
# ─────────────────────────────────────────────────────────────────────────────

class _PlusBehaviorDispatcher:
    """Proxy: wählt pro Methodenaufruf Core- oder Plus-Implementierung.

    Dispatcher-Instanz ist das öffentliche `plus_behavior`-Singleton.

    PROJ-95: Die Dispatch-Methoden werden via `_build_dispatch_methods()` aus den
    @gate/@lifecycle-gestempelten CorePlusBehavior-Methoden generiert und direkt
    als Klassen-Attribute gesetzt (kein `__getattr__` mehr). monkeypatch setzt
    Attribute direkt auf der Instanz; ein Instance-Attribut überschattet die
    generierte Klassen-Methode (Non-Data-Descriptor-Lookup-Reihenfolge), daher
    bleibt der monkeypatch-Vorrang ohne Sonder-Logik erhalten.
    """

    def __init__(self, core: CorePlusBehavior) -> None:
        self._core = core
        self._active = None

    def _resolve_gate(self):
        """Gate-Routing: aktive Plus-Impl NUR mit gültiger Lizenz, sonst Core-Default.

        is_plus_edition() wird PRO AUFRUF ausgewertet → Lizenz-Upload/-Deaktivierung
        mid-session schaltet Gate-Methoden sofort ohne Neustart um.
        """
        active = self._active
        return active if (active is not None and is_plus_edition()) else self._core

    def _resolve_lifecycle(self):
        """Lifecycle-Routing: aktive Impl. wenn registriert, edition-unabhängig.

        Läuft auch im Plus-Image ohne Lizenz (Infrastruktur-Hooks, z.B. DB-Setup,
        Scheduled-Job-Runner, OpenTofu-Tooling-Indikator). Reines Core-Image
        (kein backend.plus, _active is None) → Core-Default.
        """
        active = self._active
        return active if active is not None else self._core

    def _set_active(self, impl) -> None:
        self._active = impl


# ─────────────────────────────────────────────────────────────────────────────
# Dispatch-Methoden-Generator (PROJ-95)
# ─────────────────────────────────────────────────────────────────────────────

def _make_dispatch_method(name: str, kind: str, is_async: bool):
    """Erzeugt einen dünnen Wrapper für genau eine Dispatcher-Methode.

    Vier Varianten (sync/async × gate/lifecycle). Late-Binding-frei: `name`,
    `kind`, `is_async` sind Funktions-Parameter → eigene Closure-Zelle pro Aufruf.
    """
    if kind == "gate":
        if is_async:
            async def wrapper(self, *args, **kwargs):
                impl = self._resolve_gate()
                return await getattr(impl, name)(*args, **kwargs)
        else:
            def wrapper(self, *args, **kwargs):
                impl = self._resolve_gate()
                return getattr(impl, name)(*args, **kwargs)
    elif kind == "lifecycle":
        if is_async:
            async def wrapper(self, *args, **kwargs):
                impl = self._resolve_lifecycle()
                return await getattr(impl, name)(*args, **kwargs)
        else:
            def wrapper(self, *args, **kwargs):
                impl = self._resolve_lifecycle()
                return getattr(impl, name)(*args, **kwargs)
    else:  # pragma: no cover – unmöglich (vom Generator geprüft)
        raise RuntimeError(f"plus_protocol: unbekannte Dispatch-Klasse {kind!r}")

    wrapper.__name__ = name
    wrapper.__qualname__ = f"_PlusBehaviorDispatcher.{name}"
    wrapper._plus_dispatch = kind  # für Introspektion/Konformitätstests
    return wrapper


def _build_dispatch_methods(dispatcher_cls, core_cls) -> None:
    """Generiert für jede CorePlusBehavior-Methode eine explizite Dispatcher-Methode.

    PROJ-95 AC-STRUCT-1/2: Jede public Methode MUSS via @gate/@lifecycle
    klassifiziert sein – eine unklassifizierte Methode führt zu einem harten
    Boot-Fehler (RuntimeError beim Import), NICHT zu stillem Falsch-Routing.

    Läuft genau einmal beim Modul-Import. Generierte Methoden sind normale
    Non-Data-Descriptors → der monkeypatch-Instance-Attribut-Vorrang bleibt erhalten.
    """
    for name, member in vars(core_cls).items():
        if name.startswith("_") or not inspect.isfunction(member):
            continue
        kind = getattr(member, "_plus_dispatch", None)
        if kind not in ("gate", "lifecycle"):
            raise RuntimeError(
                f"plus_protocol: CorePlusBehavior.{name} ist nicht klassifiziert. "
                f"Jede Plus-Behavior-Methode MUSS mit @gate oder @lifecycle dekoriert "
                f"sein (PROJ-95 AC-STRUCT-2). Aktueller Stempel: {kind!r}."
            )
        is_async = inspect.iscoroutinefunction(member)
        setattr(dispatcher_cls, name, _make_dispatch_method(name, kind, is_async))


# Pflicht-Pass: generiert alle Dispatcher-Methoden ODER bricht beim Import hart ab.
_build_dispatch_methods(_PlusBehaviorDispatcher, CorePlusBehavior)


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
    "auto_snapshots":                 "can_use_auto_snapshots",
    "stacks":                         "can_use_stacks",
    "ansible_inventory":              "can_use_ansible_inventory",
    "topology":                       "can_use_topology",
    # PROJ-92: Packer Visual Editor
    "packer_editor":                  "can_use_packer_editor",
    # PROJ-93: Ansible Visual Editor
    "ansible_editor":                 "can_use_ansible_editor",
    # PROJ-96: VM-Abhängigkeiten & Aktions-Impact-Warnung
    "vm_dependencies":                "can_use_dependencies",
    # PROJ-64: Self-Approval-Gate (sync, editions-abhängig)
    "allow_self_approval_supported":  "allow_self_approval_supported",
}
# Hinweis: is_approval_workflow_enabled ist async (DB-Zugriff) und daher NICHT in
# CAPABILITIES – der Master-Toggle-Status kommt via GET /api/admin/approval-workflow.
