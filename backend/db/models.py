# p3portal.org
"""PROJ-25: SQLAlchemy Table() definitions – DB-agnostic schema (SQLite + PostgreSQL).

Replaces schema.sql as the canonical schema source. SQLAlchemy generates
correct dialect-specific DDL automatically (AUTOINCREMENT for SQLite, SERIAL for PostgreSQL).
"""
from __future__ import annotations

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)

metadata = MetaData()

# ── jobs ──────────────────────────────────────────────────────────────────────

jobs = Table(
    "jobs", metadata,
    Column("id", String, primary_key=True),
    Column("type", String(20), nullable=False, server_default="ansible"),
    Column("playbook", Text, nullable=False),
    Column("status", String(10), nullable=False, server_default="pending"),
    Column("created_at", String, nullable=False),
    Column("started_at", String),
    Column("finished_at", String),
    Column("username", String, nullable=False),
    Column("params", Text, nullable=False, server_default="{}"),
    Column("log_path", Text),
    Column("api_key_id", Integer),       # PROJ-9
    Column("callback_url", Text),        # PROJ-9
    Column("auto_owner_user_id", Integer),   # PROJ-48: wenn gesetzt → Owner nach Erfolg eintragen
    Column("deploy_category", String(20)),   # PROJ-48: vm_deployment | lxc_deployment | NULL
    Column("pool_id", Integer),              # PROJ-62: Pool-Kontext für Auto-Member-Add + Quota-Check
    Column("ansible_manage", Integer),       # PROJ-83: Deploy-Opt-out-Haken „Für Ansible verwalten"
    Column("ansible_global_opt_in", Integer),  # PROJ-83: Global-Key beim Deploy mit-injizieren
    CheckConstraint(
        "status IN ('pending', 'running', 'success', 'failed')",
        name="ck_jobs_status",
    ),
)

Index("idx_jobs_username",   jobs.c.username)
Index("idx_jobs_status",     jobs.c.status)
Index("idx_jobs_created_at", jobs.c.created_at)

# ── local_users ───────────────────────────────────────────────────────────────

local_users = Table(
    "local_users", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("username", String, nullable=False, unique=True),
    Column("password_hash", Text, nullable=False),
    Column("role", String(20), nullable=False, server_default="operator"),
    Column("active", Integer, nullable=False, server_default="1"),
    Column("created_at", String, nullable=False),
    Column("must_change_password", Integer, nullable=False, server_default="0"),
    Column("last_login_at", String),
    Column("last_login_ip", String),
    Column("portal_permissions", Text, nullable=False, server_default="[]"),
    Column("api_keys_enabled", Integer, nullable=False, server_default="0"),    # PROJ-24
    Column("api_keys_allowed_scopes", Text),                                    # PROJ-24
    Column("api_keys_max_count", Integer),                                      # PROJ-24
    CheckConstraint(
        "role IN ('admin', 'operator', 'viewer', 'restricted')",
        name="ck_local_users_role",
    ),
)

Index("idx_local_users_username", local_users.c.username)
Index("idx_local_users_active",   local_users.c.active)

# ── settings ──────────────────────────────────────────────────────────────────

settings_table = Table(
    "settings", metadata,
    Column("key", String, primary_key=True),
    Column("value", Text, nullable=False),
    Column("updated_at", String, nullable=False),
    Column("updated_by", String, nullable=False),
)

# ── role_presets ──────────────────────────────────────────────────────────────

role_presets = Table(
    "role_presets", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String, nullable=False, unique=True),
    Column("description", Text, nullable=False, server_default=""),
    Column("permissions", Text, nullable=False, server_default="[]"),
    Column("node_actions", Text, nullable=False, server_default="[]"),  # PROJ-47
    Column("created_at", String, nullable=False),
    Column("created_by", String, nullable=False),
)

Index("idx_role_presets_name", role_presets.c.name)

# ── resource_assignments ──────────────────────────────────────────────────────

resource_assignments = Table(
    "resource_assignments", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("local_users.id", ondelete="CASCADE"), nullable=False),
    Column("resource_type", String(10), nullable=False),
    Column("resource_id", Integer, nullable=False),
    Column("portal_node_id", Integer, ForeignKey("nodes.id", ondelete="SET NULL"), nullable=True),
    Column("preset_id", Integer, ForeignKey("role_presets.id"), nullable=False),
    Column("created_at", String, nullable=False),
    Column("created_by", String, nullable=False),
    UniqueConstraint("user_id", "resource_type", "portal_node_id", "resource_id", name="uq_resource_assignments"),
    CheckConstraint(
        "resource_type IN ('vm', 'lxc')",
        name="ck_resource_assignments_type",
    ),
)

Index("idx_resource_assignments_user_id",   resource_assignments.c.user_id)
Index("idx_resource_assignments_preset_id", resource_assignments.c.preset_id)

# Partial-Unique-Index für den NULL-Fall: SQLite und PostgreSQL behandeln beide
# NULL ≠ NULL in UNIQUE-Constraints, d.h. uq_resource_assignments greift nicht wenn
# portal_node_id IS NULL (Singleton-Installation ohne Multi-Node).
# Semantik: (user_id, resource_type, resource_id) WHERE portal_node_id IS NULL → kein Duplikat.
# Der bestehende Constraint uq_resource_assignments bleibt und deckt den Multi-Node-Fall ab.
Index(
    "uq_resource_assignments_no_node",
    resource_assignments.c.user_id,
    resource_assignments.c.resource_type,
    resource_assignments.c.resource_id,
    unique=True,
    sqlite_where=resource_assignments.c.portal_node_id.is_(None),
    postgresql_where=resource_assignments.c.portal_node_id.is_(None),
)

# ── user_profiles ─────────────────────────────────────────────────────────────

user_profiles = Table(
    "user_profiles", metadata,
    Column("username", String, primary_key=True),
    Column("auth_type", String(20), nullable=False, server_default="local"),
    Column("ssh_public_key", Text),
    Column("last_login_at", String),
    Column("last_login_ip", String),
    Column("theme_preference", String),  # PROJ-18
    Column("lang_preference", String),   # PROJ-18
)

# ── user_sessions ─────────────────────────────────────────────────────────────

user_sessions = Table(
    "user_sessions", metadata,
    Column("id", String, primary_key=True),
    Column("username", String, nullable=False),
    Column("jti", String, nullable=False, unique=True),
    Column("created_at", String, nullable=False),
    Column("expires_at", String, nullable=False),
    Column("ip_address", String),
    Column("user_agent", Text),
    Column("revoked", Integer, nullable=False, server_default="0"),
)

Index("idx_user_sessions_username",   user_sessions.c.username)
Index("idx_user_sessions_jti",        user_sessions.c.jti)
Index("idx_user_sessions_expires_at", user_sessions.c.expires_at)

# ── themes (PROJ-18) ──────────────────────────────────────────────────────────

themes = Table(
    "themes", metadata,
    Column("id", String, primary_key=True),
    Column("name", String, nullable=False),
    Column("author", String, nullable=False, server_default=""),
    Column("is_builtin", Integer, nullable=False, server_default="0"),
    Column("file_path", String),
    Column("created_at", String, nullable=False),
)

Index("idx_themes_is_builtin", themes.c.is_builtin)

# ── audit_logs (PROJ-23) ──────────────────────────────────────────────────────

audit_logs = Table(
    "audit_logs", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("event_type", String, nullable=False),
    Column("username", String),
    Column("auth_type", String),
    Column("ip_address", String),
    Column("user_agent", Text),
    Column("detail", Text),
    Column("created_at", String, nullable=False),
)

Index("idx_audit_logs_created_at", audit_logs.c.created_at)
Index("idx_audit_logs_event_type", audit_logs.c.event_type)
Index("idx_audit_logs_username",   audit_logs.c.username)

# ── portal_config (PROJ-21) ───────────────────────────────────────────────────

portal_config = Table(
    "portal_config", metadata,
    Column("key", String, primary_key=True),
    Column("value", Text, nullable=False),
    Column("is_secret", Integer, nullable=False, server_default="0"),
    Column("updated_at", String, nullable=False),
    Column("updated_by", String, nullable=False, server_default="system"),
)

# ── nodes (PROJ-21) ───────────────────────────────────────────────────────────

nodes = Table(
    "nodes", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String, nullable=False),
    Column("url", String, nullable=False),
    Column("proxmox_node", String, nullable=False),
    Column("verify_ssl", Integer, nullable=False, server_default="1"),
    Column("token_id", String, nullable=False, server_default=""),
    Column("token_secret", String, nullable=False, server_default=""),
    Column("viewer_token_id", String, nullable=False, server_default=""),
    Column("viewer_token_secret", String, nullable=False, server_default=""),
    Column("operator_token_id", String, nullable=False, server_default=""),
    Column("operator_token_secret", String, nullable=False, server_default=""),
    Column("admin_token_id", String, nullable=False, server_default=""),
    Column("admin_token_secret", String, nullable=False, server_default=""),
    Column("packer_token_id", String, nullable=False, server_default=""),
    Column("packer_token_secret", String, nullable=False, server_default=""),
    # PROJ-76 Phase 2a: 5. OpenTofu-Token-Tier (optional je Node, wie packer)
    Column("tofu_token_id", String, nullable=False, server_default=""),
    Column("tofu_token_secret", String, nullable=False, server_default=""),
    Column("cluster_nodes", String, nullable=False, server_default=""),  # PROJ-26
    Column("poll_interval", Integer, nullable=False, server_default="30"),  # PROJ-33
    # Globale Anzeige-Reihenfolge der Installationen (Admin-konfigurierbar).
    # 0 = noch nicht sortiert → Fallback auf is_default/id (bestehende Reihenfolge).
    Column("position", Integer, nullable=False, server_default="0"),
    Column("is_default", Integer, nullable=False, server_default="0"),
    Column("created_at", String, nullable=False),
    Column("created_by", String, nullable=False, server_default="system"),
)

Index("idx_nodes_is_default", nodes.c.is_default)

# ── user_ssh_keys ─────────────────────────────────────────────────────────────

user_ssh_keys = Table(
    "user_ssh_keys", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("username", String, nullable=False),
    Column("label", String, nullable=False),
    Column("public_key", Text, nullable=False),
    Column("created_at", String, nullable=False),
    UniqueConstraint("username", "label", name="uq_user_ssh_keys"),
)

Index("idx_user_ssh_keys_username", user_ssh_keys.c.username)

# ── api_keys (PROJ-9) ─────────────────────────────────────────────────────────

api_keys = Table(
    "api_keys", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String, nullable=False),
    Column("description", Text),
    Column("key_hash", String, nullable=False, unique=True),
    Column("key_prefix", String, nullable=False),
    Column("scopes", Text, nullable=False, server_default="[]"),
    Column("created_at", String, nullable=False),
    Column("expires_at", String),
    Column("revoked_at", String),
    Column("last_used_at", String),
)

Index("idx_api_keys_key_hash", api_keys.c.key_hash)
Index("idx_api_keys_revoked",  api_keys.c.revoked_at)

# ── external_api_log (PROJ-9) ─────────────────────────────────────────────────

external_api_log = Table(
    "external_api_log", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("api_key_id", Integer, ForeignKey("api_keys.id")),
    Column("api_key_name", String, nullable=False),
    Column("scope_used", String, nullable=False),
    Column("method", String, nullable=False),
    Column("endpoint", String, nullable=False),
    Column("status_code", Integer),
    Column("job_id", String),
    Column("playbook", String),
    Column("node", String),
    Column("callback_url", Text),
    Column("called_at", String, nullable=False),
    # PROJ-44: upk_-Auth Audit-Erweiterungen
    Column("user_id", Integer),
    Column("auth_kind", String, server_default="'m2m'"),
    Column("endpoint_class", String, server_default="'v1'"),
)

Index("idx_external_api_log_called_at",  external_api_log.c.called_at)
Index("idx_external_api_log_api_key_id", external_api_log.c.api_key_id)

# ── user_api_keys (PROJ-24) ───────────────────────────────────────────────────

user_api_keys = Table(
    "user_api_keys", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("local_users.id", ondelete="CASCADE"), nullable=False),
    Column("name", String, nullable=False),
    Column("key_hash", String, nullable=False, unique=True),
    Column("key_prefix", String, nullable=False),
    Column("scopes", Text, nullable=False, server_default="[]"),
    Column("expires_at", String),
    Column("last_used_at", String),
    Column("first_used_at", String),             # PROJ-44: einmaliges first-use Event
    Column("is_active", Integer, nullable=False, server_default="1"),
    Column("created_at", String, nullable=False),
)

Index("idx_user_api_keys_user_id",  user_api_keys.c.user_id)
Index("idx_user_api_keys_key_hash", user_api_keys.c.key_hash)
Index("idx_user_api_keys_active",   user_api_keys.c.is_active)

# ── announcements (PROJ-28, PROJ-65: type→severity rename) ───────────────────

announcements = Table(
    "announcements", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("message", Text, nullable=False),
    Column("severity", String(10), nullable=False, server_default="info"),
    Column("active", Integer, nullable=False, server_default="1"),
    Column("expires_at", String),
    Column("created_by", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
    CheckConstraint(
        "severity IN ('info', 'warn', 'critical', 'success')",
        name="ck_announcements_severity",
    ),
)

Index("idx_announcements_active", announcements.c.active)

# ── notification_reads (PROJ-65) ──────────────────────────────────────────────
# Composite PK: (user_id, source, source_id) – per SQLAlchemy-Konvention via primary_key=True

notification_reads = Table(
    "notification_reads", metadata,
    Column("user_id", Integer, ForeignKey("local_users.id", ondelete="CASCADE"),
           nullable=False, primary_key=True),
    Column("source", String(20), nullable=False, primary_key=True),
    Column("source_id", String(500), nullable=False, primary_key=True),
    Column("read_at", String, nullable=False),
    CheckConstraint(
        "source IN ('alert', 'announcement', 'event')",
        name="ck_notification_reads_source",
    ),
)

Index("idx_notification_reads_user_read",
      notification_reads.c.user_id, notification_reads.c.read_at)
Index("idx_notification_reads_source",
      notification_reads.c.source, notification_reads.c.source_id)

# ── user_notification_settings (PROJ-36) ──────────────────────────────────────

user_notification_settings = Table(
    "user_notification_settings", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("local_users.id", ondelete="CASCADE"), nullable=False),
    Column("email_enabled", Integer, nullable=False, server_default="0"),
    Column("email_address", Text),
    Column("webhook_url", Text),
    Column("webhook_token", Text),                                            # encrypted Bearer/App token
    Column("webhook_receiver_type", String(20), server_default="'custom'"),  # custom | gotify
    Column("webhook_verify_ssl", Integer, nullable=False, server_default="1"),  # PROJ-67 BUG-67-1
    Column("min_severity", String(10), nullable=False, server_default="high"),
    Column("updated_at", String, nullable=False),
    UniqueConstraint("user_id", name="uq_user_notification_settings_user"),
    CheckConstraint(
        "min_severity IN ('low', 'medium', 'high', 'critical')",
        name="ck_user_notification_min_severity",
    ),
)

# ── alert_presets (PROJ-34, Plus) ─────────────────────────────────────────────

alert_presets = Table(
    "alert_presets", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String, nullable=False, unique=True),
    Column("description", Text),
    Column("created_by", String, nullable=False),
    Column("created_at", String, nullable=False),
)

# ── alert_rules (PROJ-34) ─────────────────────────────────────────────────────

alert_rules = Table(
    "alert_rules", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    # scope: global | preset | vm
    Column("scope", String(10), nullable=False),
    Column("preset_id", Integer, ForeignKey("alert_presets.id", ondelete="CASCADE")),
    # vm-scope: vmid + node_id reference
    Column("vmid", String),
    Column("node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE")),
    Column("name", String, nullable=False),
    # metric: cpu_percent | mem_percent | disk_percent | status
    Column("metric", String(20), nullable=False),
    Column("warning_threshold", String),   # JSON-encoded float or null
    Column("critical_threshold", String),  # JSON-encoded float or null
    Column("sustained_polls", Integer, nullable=False, server_default="1"),
    Column("enabled", Integer, nullable=False, server_default="1"),
    Column("notify_recovery", Integer, nullable=False, server_default="1"),
    Column("filesystem", String),          # for disk_percent only
    # Plus: webhook/email per rule
    Column("webhook_url", Text),              # encrypted
    Column("webhook_token", Text),            # encrypted bearer/app token
    Column("webhook_receiver_type", String(20), server_default="'custom'"),  # custom | gotify
    Column("webhook_verify_ssl", Integer, nullable=False, server_default="1"),  # PROJ-67 BUG-67-1
    Column("email_recipients", Text),         # comma-separated
    Column("created_by", String, nullable=False),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
    CheckConstraint(
        "scope IN ('global', 'preset', 'vm')",
        name="ck_alert_rules_scope",
    ),
    CheckConstraint(
        "metric IN ('cpu_percent', 'mem_percent', 'disk_percent', 'status')",
        name="ck_alert_rules_metric",
    ),
)

Index("idx_alert_rules_scope",     alert_rules.c.scope)
Index("idx_alert_rules_preset_id", alert_rules.c.preset_id)
Index("idx_alert_rules_vmid",      alert_rules.c.vmid)
Index("idx_alert_rules_node_id",   alert_rules.c.node_id)
Index("idx_alert_rules_enabled",   alert_rules.c.enabled)

# ── alert_preset_assignments (PROJ-34, Plus) ──────────────────────────────────

alert_preset_assignments = Table(
    "alert_preset_assignments", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("preset_id", Integer, ForeignKey("alert_presets.id", ondelete="CASCADE"), nullable=False),
    Column("vmid", String, nullable=False),
    Column("node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
    Column("assigned_at", String, nullable=False),
    UniqueConstraint("vmid", "node_id", name="uq_alert_preset_assignments_vm"),
)

Index("idx_alert_preset_assignments_preset", alert_preset_assignments.c.preset_id)
Index("idx_alert_preset_assignments_vm",     alert_preset_assignments.c.vmid)

# ── alert_threshold_overrides (PROJ-34, Plus) ─────────────────────────────────

alert_threshold_overrides = Table(
    "alert_threshold_overrides", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("rule_id", Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False),
    Column("vmid", String, nullable=False),
    Column("node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
    Column("warning_threshold", String),   # JSON-encoded float or null
    Column("critical_threshold", String),  # JSON-encoded float or null
    UniqueConstraint("rule_id", "vmid", "node_id", name="uq_alert_threshold_overrides"),
)

Index("idx_alert_threshold_overrides_rule", alert_threshold_overrides.c.rule_id)
Index("idx_alert_threshold_overrides_vm",   alert_threshold_overrides.c.vmid)

# ── alert_states (PROJ-34) ────────────────────────────────────────────────────

alert_states = Table(
    "alert_states", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("rule_id", Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False),
    Column("vmid", String, nullable=False),
    Column("node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
    Column("severity", String(10), nullable=False),  # warning | critical
    # state: ok | pending | warning | pending_critical | critical
    Column("state", String(20), nullable=False, server_default="ok"),
    Column("pending_count", Integer, nullable=False, server_default="0"),
    Column("last_value", String),           # JSON-encoded last metric value
    Column("last_checked_at", String),
    Column("last_changed_at", String),
    UniqueConstraint("rule_id", "vmid", "node_id", "severity", name="uq_alert_states"),
    CheckConstraint(
        "severity IN ('warning', 'critical')",
        name="ck_alert_states_severity",
    ),
    CheckConstraint(
        "state IN ('ok', 'pending', 'warning', 'pending_critical', 'critical')",
        name="ck_alert_states_state",
    ),
)

Index("idx_alert_states_rule_id", alert_states.c.rule_id)
Index("idx_alert_states_vmid",    alert_states.c.vmid)
Index("idx_alert_states_state",   alert_states.c.state)

# ── alert_events (PROJ-34) ────────────────────────────────────────────────────

alert_events = Table(
    "alert_events", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("rule_id", Integer, ForeignKey("alert_rules.id", ondelete="SET NULL")),
    Column("rule_name", String, nullable=False),
    Column("vmid", String, nullable=False),
    Column("node_id", Integer),
    Column("vm_name", String),
    Column("vm_type", String, nullable=False, server_default="qemu"),   # qemu | lxc
    Column("proxmox_node", String, nullable=False, server_default=""),  # Proxmox-Node-Name
    Column("metric", String(20), nullable=False),
    Column("value", String),               # JSON-encoded metric value at trigger
    Column("threshold", String),           # JSON-encoded threshold that was crossed
    Column("severity", String(10), nullable=False),  # warning | critical
    Column("state", String(10), nullable=False),     # firing | resolved
    Column("timestamp", String, nullable=False),
    CheckConstraint(
        "severity IN ('warning', 'critical')",
        name="ck_alert_events_severity",
    ),
    CheckConstraint(
        "state IN ('firing', 'resolved')",
        name="ck_alert_events_state",
    ),
)

Index("idx_alert_events_rule_id",   alert_events.c.rule_id)
Index("idx_alert_events_vmid",      alert_events.c.vmid)
Index("idx_alert_events_timestamp", alert_events.c.timestamp)
Index("idx_alert_events_state",     alert_events.c.state)
Index("idx_alert_events_severity",  alert_events.c.severity)

# ── alert_acknowledgements (PROJ-34) ─────────────────────────────────────────

alert_acknowledgements = Table(
    "alert_acknowledgements", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("alert_event_id", Integer, ForeignKey("alert_events.id", ondelete="CASCADE"), nullable=False),
    Column("username", String, nullable=False),
    Column("acknowledged_at", String, nullable=False),
    UniqueConstraint("alert_event_id", "username", name="uq_alert_acknowledgements"),
)

Index("idx_alert_acknowledgements_event",    alert_acknowledgements.c.alert_event_id)
Index("idx_alert_acknowledgements_username", alert_acknowledgements.c.username)

# ── groups (PROJ-45) ──────────────────────────────────────────────────────────

groups = Table(
    "groups", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("name", String(64), nullable=False),
    Column("description", Text),
    Column("tags", Text, nullable=False, server_default="[]"),
    Column("owner_user_id", Integer, ForeignKey("local_users.id", ondelete="SET NULL")),
    Column("created_at", String, nullable=False),
    Column("created_by", String, nullable=False),
)

Index("uq_groups_name_lower", func.lower(groups.c.name), unique=True)
Index("idx_groups_owner",     groups.c.owner_user_id)

# ── group_members (PROJ-45) ───────────────────────────────────────────────────

group_members = Table(
    "group_members", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("group_id", Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
    Column("user_id", Integer, ForeignKey("local_users.id", ondelete="CASCADE"), nullable=False),
    Column("member_kind", String(20), nullable=False, server_default="local_user"),
    Column("added_at", String, nullable=False),
    Column("added_by", String, nullable=False),
    UniqueConstraint("group_id", "user_id", name="uq_group_members"),
    CheckConstraint("member_kind = 'local_user'", name="ck_group_members_kind"),
)

Index("idx_group_members_user_id",  group_members.c.user_id)
Index("idx_group_members_group_id", group_members.c.group_id)

# ── pools, pool_members, pool_assignments ─────────────────────────────────────
# PROJ-62: Nach backend/plus/pools/models.py verschoben (Plus-Modul-Eigentum).
# create_all() für diese Tabellen erfolgt via plus_metadata in plus/__init__.py.

# ── node_assignments (PROJ-47) ────────────────────────────────────────────────

node_assignments = Table(
    "node_assignments", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
    Column("subject_type", String(5), nullable=False),
    Column("subject_id", Integer, nullable=False),
    Column("role_preset_id", Integer, ForeignKey("role_presets.id", ondelete="CASCADE"), nullable=False),
    Column("added_at", String, nullable=False),
    Column("added_by", String, nullable=False),
    UniqueConstraint("node_id", "subject_type", "subject_id", name="uq_node_assignments"),
    CheckConstraint(
        "subject_type IN ('user', 'group')",
        name="ck_node_assignments_subject_type",
    ),
)

Index("idx_node_assignments_node_id",  node_assignments.c.node_id)
Index("idx_node_assignments_subject",  node_assignments.c.subject_type, node_assignments.c.subject_id)

# ── user_sidebar_pins (PROJ-54) ───────────────────────────────────────────────

user_sidebar_pins = Table(
    "user_sidebar_pins", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("user_id", Integer, ForeignKey("local_users.id", ondelete="CASCADE"), nullable=False),
    Column("route", String(200), nullable=False),
    Column("label", String(40)),
    Column("position", Integer, nullable=False),
    Column("pin_kind", String(30), nullable=False),
    Column("resource_ref", Text),
    Column("created_at", String, nullable=False),
    UniqueConstraint("user_id", "route", name="uq_sidebar_pins_user_route"),
    CheckConstraint(
        "pin_kind IN ('system_settings_tab','system_settings_sub_tab','vm','lxc','node','node_tab','pool','group','other')",
        name="ck_sidebar_pins_kind",
    ),
)

Index("idx_sidebar_pins_user_pos", user_sidebar_pins.c.user_id, user_sidebar_pins.c.position)

# ── vm_owners (PROJ-48) ───────────────────────────────────────────────────────

vm_owners = Table(
    "vm_owners", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("resource_type", String(3), nullable=False),
    Column("node_id", Integer, ForeignKey("nodes.id", ondelete="RESTRICT"), nullable=False),
    Column("vmid", Integer, nullable=False),
    Column("user_id", Integer, ForeignKey("local_users.id", ondelete="RESTRICT"), nullable=False),
    Column("assigned_at", String, nullable=False),
    Column("assigned_by_user_id", Integer, ForeignKey("local_users.id", ondelete="SET NULL")),
    Column("source", String(15), nullable=False),
    Column("deleted_at", String),
    Column("deleted_reason", String(40)),
    CheckConstraint(
        "resource_type IN ('vm', 'lxc')",
        name="ck_vm_owners_resource_type",
    ),
    CheckConstraint(
        "source IN ('deploy', 'adopt', 'coowner_add', 'transfer')",
        name="ck_vm_owners_source",
    ),
    CheckConstraint(
        "deleted_reason IN ('user_deleted', 'resource_deleted', 'transferred', 'self_removed', 'admin_removed', 'last_owner_orphaned', 'node_deleted') OR deleted_reason IS NULL",
        name="ck_vm_owners_deleted_reason",
    ),
)

Index("idx_vm_owners_user_deleted",   vm_owners.c.user_id, vm_owners.c.deleted_at)
Index("idx_vm_owners_resource",       vm_owners.c.resource_type, vm_owners.c.node_id, vm_owners.c.vmid, vm_owners.c.deleted_at)
Index("idx_vm_owners_deleted_at",     vm_owners.c.deleted_at)

# Partial-Unique nur über SQL (SQLAlchemy erstellt Index, WHERE-Klausel wird via DDL-Event gesetzt)
# Semantik: (resource_type, node_id, vmid, user_id) WHERE deleted_at IS NULL → kein doppelter Owner
Index(
    "uq_vm_owners_active",
    vm_owners.c.resource_type,
    vm_owners.c.node_id,
    vm_owners.c.vmid,
    vm_owners.c.user_id,
    unique=True,
    sqlite_where=vm_owners.c.deleted_at.is_(None),
)

# ── playbook_permissions → PROJ-63: nach backend/plus/playbook_permissions/models.py verschoben ──
# ── owner_delete_requests, approval_rules, pending_approvals → PROJ-64: nach backend/plus/approvals/models.py verschoben ──

# ── help_overrides (PROJ-57) ──────────────────────────────────────────────────
# Speichert User-Custom-Overrides (scope='user') und globale Admin-Overrides (scope='global')
# für das P3-Handbuch-System. Partial-UNIQUE-Indizes erzwingen Ein-Override-pro-Key+Sprache.

help_overrides = Table(
    "help_overrides", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("key", String, nullable=False),          # z.B. "dashboard", "modal.user_form"
    Column("lang", String(2), nullable=False),       # "de" oder "en"
    Column("scope", String(10), nullable=False),     # "user" oder "global"
    Column("owner_user_id", Integer,
           ForeignKey("local_users.id", ondelete="CASCADE"), nullable=True),
    Column("content", Text, nullable=False),         # sanitisierter MD-Inhalt
    Column("content_md5", String(32), nullable=False),
    Column("original_uploader_user_id", Integer,
           ForeignKey("local_users.id", ondelete="SET NULL"), nullable=True),
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
    CheckConstraint("scope IN ('user','global')", name="ck_help_overrides_scope"),
    CheckConstraint("lang IN ('de','en')",        name="ck_help_overrides_lang"),
)

# Performance-Index für Bulk-Resolver-Queries (lädt alle Overrides für einen User + alle globalen)
Index("idx_help_overrides_scope_key_lang",
      help_overrides.c.scope, help_overrides.c.key, help_overrides.c.lang)
Index("idx_help_overrides_owner",
      help_overrides.c.owner_user_id)

# Partial-UNIQUE: ein User-Override pro (key, lang, owner_user_id)
from sqlalchemy import text as _sa_text
Index(
    "uq_help_overrides_user",
    help_overrides.c.key,
    help_overrides.c.lang,
    help_overrides.c.owner_user_id,
    unique=True,
    sqlite_where=_sa_text("scope = 'user'"),
    postgresql_where=_sa_text("scope = 'user'"),
)
# Partial-UNIQUE: ein globaler Override pro (key, lang)
Index(
    "uq_help_overrides_global",
    help_overrides.c.key,
    help_overrides.c.lang,
    unique=True,
    sqlite_where=_sa_text("scope = 'global'"),
    postgresql_where=_sa_text("scope = 'global'"),
)

# ── webhook_allowlist (PROJ-67 Phase 1 – F-002) ───────────────────────────────

webhook_allowlist = Table(
    "webhook_allowlist", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("pattern", String(255), nullable=False, unique=True),
    Column("allow_http", Boolean, nullable=False, server_default="0"),
    Column("created_at", String, nullable=False, server_default=func.now()),
    Column("created_by", String(100), nullable=False, server_default=""),
)
Index("idx_webhook_allowlist_pattern", webhook_allowlist.c.pattern)

# ── node_updates (PROJ-73 – APT-Update-Stand pro Proxmox-Member) ─────────────

node_updates = Table(
    "node_updates", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("portal_node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
    Column("proxmox_node_name", String(100), nullable=False),
    Column("last_check_at", String, nullable=True),
    Column("last_success_at", String, nullable=True),
    Column("last_error", Text, nullable=True),
    Column("payload_json", Text, nullable=False, server_default="[]"),
    UniqueConstraint("portal_node_id", "proxmox_node_name", name="uq_node_updates_member"),
)
Index("idx_node_updates_portal_node_id", node_updates.c.portal_node_id)
Index("idx_node_updates_last_success_at", node_updates.c.last_success_at)

# ── ansible_managed_hosts (PROJ-83 – minimaler persistierter In-Guest-Host-Zustand) ──
#
# Das Inventory selbst wird zur Laufzeit aus Proxmox (SoT) + diesem minimalen Zustand
# projiziert (kein materialisiertes Inventory). Persistiert wird NUR, was aus Proxmox
# nicht rekonstruierbar ist: ssh_managed (wurde beim Deploy ein Verwaltungs-Key
# injiziert?), ansible_user, global_opt_in, gemerkter Host-Key (TOFU). Existenz/Name/
# IP/Owner/Pool sind abgeleitet → strukturell keine Leichen (AC-CLEAN-1).
#
# Diese Tabelle ist Core (User-Scope ist Core). global_opt_in liegt bewusst hier, nicht
# in einer Plus-Tabelle: es ist ein per-Host-Flag (in Pure Core ungenutzt + Global-EP 404)
# → kein edition-übergreifender Split des Host-Zustands.

ansible_managed_hosts = Table(
    "ansible_managed_hosts", metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("portal_node_id", Integer, ForeignKey("nodes.id", ondelete="CASCADE"), nullable=False),
    Column("vmid", Integer, nullable=False),
    Column("kind", String(10), nullable=False),                       # qemu | lxc
    Column("ssh_managed", Integer, nullable=False, server_default="0"),
    Column("ansible_user", String(64), nullable=False, server_default="p3-ansible"),
    Column("global_opt_in", Integer, nullable=False, server_default="0"),
    Column("host_key", Text, nullable=True),                          # gemerkter Server-Host-Key (TOFU)
    Column("host_origin", String(16), nullable=False, server_default="proxmox"),  # Forward-Compat (AC-CLEAN-4)
    Column("created_at", String, nullable=False),
    Column("updated_at", String, nullable=False),
    UniqueConstraint("portal_node_id", "vmid", "kind", name="uq_ansible_managed_hosts"),
    CheckConstraint("kind IN ('qemu', 'lxc')", name="ck_ansible_managed_hosts_kind"),
)
Index("idx_ansible_managed_hosts_node", ansible_managed_hosts.c.portal_node_id)
