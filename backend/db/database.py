# p3portal.org
"""PROJ-25: DB-agnostische Datenbankschicht (SQLite + PostgreSQL).

Prioritätskette für DB-URL:
  1. DB_URL Env-Var          (höchste Priorität)
  2. /app/data/.db_config    (Wizard-Konfiguration)
  3. sqlite+aiosqlite:///…   (Fallback)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from sqlalchemy import event, inspect as sa_inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.core.config import settings

logger = logging.getLogger(__name__)

_engine = None
_SessionLocal: async_sessionmaker | None = None


def _db_url() -> str:
    # 1. Env-Var (höchste Priorität)
    if settings.db_url:
        return settings.db_url
    # 2. .db_config-Datei (Wizard-Konfiguration)
    from backend.services.db_config_service import get_db_url_from_config
    file_url = get_db_url_from_config(settings.data_dir)
    if file_url:
        return file_url
    # 3. SQLite-Default
    db_path = Path(settings.data_dir) / "portal.db"
    return f"sqlite+aiosqlite:///{db_path}"


# Per-connection SQLite settings applied via the SQLAlchemy connect listener.
# Both the FastAPI app and the Celery worker (--beat) write to data/portal.db
# concurrently; WAL plus a non-zero busy_timeout are required so a writer
# collision retries instead of failing immediately with "database is locked".
_SQLITE_CONNECTION_PRAGMAS: tuple[tuple[str, str], ...] = (
    ("foreign_keys", "ON"),
    ("journal_mode", "WAL"),
    ("busy_timeout", "5000"),
)


def _set_sqlite_pragma(dbapi_conn, _connection_record):
    cursor = dbapi_conn.cursor()
    try:
        for pragma_name, pragma_value in _SQLITE_CONNECTION_PRAGMAS:
            cursor.execute(f"PRAGMA {pragma_name}={pragma_value}")
    finally:
        cursor.close()


@asynccontextmanager
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    if _SessionLocal is None:
        raise RuntimeError("DB nicht initialisiert – init_db() zuerst aufrufen")
    async with _SessionLocal() as session:
        yield session


def get_engine_dialect() -> str:
    """Gibt den Dialect-Namen der aktuellen Engine zurück ('sqlite' oder 'postgresql').

    Immer verfügbar nach init_db(). Davor: SQLite-Fallback.
    Wird von Dialect-Helper-Aufrufen in Services genutzt, die keinen
    direkten Connection-Zugriff haben.
    """
    if _engine is None:
        return "sqlite"
    return _engine.dialect.name


def get_sync_engine():
    """Gibt eine echte Sync-Engine für Plus-MetaData create_all zurück.

    _engine.sync_engine wrappet aiosqlite/asyncpg und benötigt Greenlet-Kontext
    für IO-Operationen. Außerhalb eines Greenlet-Kontexts (synchroner Lifespan-Hook)
    schlägt create_all() mit 'greenlet_spawn has not been called' fehl.
    Stattdessen wird eine frische sync-Engine mit dem Basis-Dialekt erzeugt.

    Nur gültig nach init_db(). Gibt None zurück wenn DB noch nicht initialisiert.
    """
    if _engine is None:
        return None
    from sqlalchemy import create_engine as _create_sync_engine
    # async-Treiber aus URL entfernen: sqlite+aiosqlite → sqlite, postgresql+asyncpg → postgresql
    sync_url = str(_engine.url).replace("+aiosqlite", "").replace("+asyncpg", "")
    return _create_sync_engine(sync_url)


async def _migrate_db(conn) -> None:
    """Add columns missing in existing databases – DB-agnostic via sqlalchemy.inspect().

    New installations get all columns via metadata.create_all() above.
    This function only runs ALTER TABLE for pre-existing deployments upgrading in-place.
    """
    missing: list[tuple[str, str]] = [
        ("local_users", "must_change_password INTEGER NOT NULL DEFAULT 0"),
        ("local_users", "last_login_at TEXT"),
        ("local_users", "last_login_ip TEXT"),
        ("local_users", "portal_permissions TEXT NOT NULL DEFAULT '[]'"),
        ("local_users", "api_keys_enabled INTEGER NOT NULL DEFAULT 0"),
        ("local_users", "api_keys_allowed_scopes TEXT"),
        ("local_users", "api_keys_max_count INTEGER"),
        # PROJ-18
        ("user_profiles", "theme_preference TEXT"),
        ("user_profiles", "lang_preference TEXT"),
        # Per-node role tokens
        ("nodes", "viewer_token_id TEXT NOT NULL DEFAULT ''"),
        ("nodes", "viewer_token_secret TEXT NOT NULL DEFAULT ''"),
        ("nodes", "operator_token_id TEXT NOT NULL DEFAULT ''"),
        ("nodes", "operator_token_secret TEXT NOT NULL DEFAULT ''"),
        ("nodes", "admin_token_id TEXT NOT NULL DEFAULT ''"),
        ("nodes", "admin_token_secret TEXT NOT NULL DEFAULT ''"),
        ("nodes", "packer_token_id TEXT NOT NULL DEFAULT ''"),
        ("nodes", "packer_token_secret TEXT NOT NULL DEFAULT ''"),
        # PROJ-9
        ("jobs", "api_key_id INTEGER"),
        ("jobs", "callback_url TEXT"),
        # PROJ-26
        ("nodes", "cluster_nodes TEXT NOT NULL DEFAULT ''"),
        # PROJ-33
        ("nodes", "poll_interval INTEGER NOT NULL DEFAULT 30"),
        # PROJ-35 SSH-Job-Key
        ("user_profiles", "ssh_private_key_enc TEXT"),
        # PROJ-47
        ("role_presets", "node_actions TEXT NOT NULL DEFAULT '[]'"),
        # PROJ-48
        ("jobs", "auto_owner_user_id INTEGER"),
        ("jobs", "deploy_category TEXT"),
        # PROJ-62
        ("jobs", "pool_id INTEGER"),
        # PROJ-70: scheduled_jobs ist jetzt Plus-only → kein Core-ALTER mehr.
        # Upgrade-Installationen: Plus-ensure_plus_db_tables (checkfirst=True) ist idempotent.
        # PROJ-44: external_api_log Erweiterung (upk_ Audit)
        ("external_api_log", "user_id INTEGER"),
        ("external_api_log", "auth_kind TEXT NOT NULL DEFAULT 'm2m'"),
        ("external_api_log", "endpoint_class TEXT NOT NULL DEFAULT 'v1'"),
        # PROJ-44: first-use Tracking für user_api_keys
        ("user_api_keys", "first_used_at TEXT"),
        # Personal-Webhook-Token (Test-Notify)
        ("user_notification_settings", "webhook_token TEXT"),
        ("user_notification_settings", "webhook_receiver_type TEXT DEFAULT 'custom'"),
        # Gotify/Custom Empfänger-Typ pro Alert-Regel
        ("alert_rules", "webhook_receiver_type TEXT DEFAULT 'custom'"),
        # PROJ-67 BUG-67-1: Per-Receiver TLS-Verify Override
        ("alert_rules", "webhook_verify_ssl INTEGER NOT NULL DEFAULT 1"),
        ("user_notification_settings", "webhook_verify_ssl INTEGER NOT NULL DEFAULT 1"),
        # PROJ-34 Bug-Fix: VM-Typ und Proxmox-Node-Name für Alert-Events
        ("alert_events", "vm_type TEXT NOT NULL DEFAULT 'qemu'"),
        ("alert_events", "proxmox_node TEXT NOT NULL DEFAULT ''"),
        # PROJ-12 Bug-Fix: Node-Disambiguierung in resource_assignments
        ("resource_assignments", "portal_node_id INTEGER"),
    ]

    def _get_existing_columns(sync_conn, table: str) -> set[str]:
        try:
            return {col["name"] for col in sa_inspect(sync_conn).get_columns(table)}
        except Exception:
            return set()

    for table, column_def in missing:
        col_name = column_def.split()[0]
        existing = await conn.run_sync(_get_existing_columns, table)
        if col_name not in existing:
            await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_def}"))

    # PROJ-65: announcements-Tabelle: type→severity umbenennen + Werte-Mapping.
    # PROJ-71: Dialect-Branch – SQLite-CREATE-NEW-Pattern bleibt, PG bekommt ALTER TABLE.
    try:
        from backend.db.dialect import _dialect_is_sqlite, _dialect_is_postgresql

        def _check_announcements_needs_migration(sync_conn) -> bool:
            try:
                cols = {c["name"] for c in sa_inspect(sync_conn).get_columns("announcements")}
                return "type" in cols and "severity" not in cols
            except Exception:
                return False

        needs_migration = await conn.run_sync(_check_announcements_needs_migration)
        if needs_migration:
            dialect_name = await conn.run_sync(lambda c: c.dialect.name)
            if dialect_name == "sqlite":
                # SQLite: kein DROP COLUMN → CREATE-NEW-Pattern
                await conn.execute(text("""
                    CREATE TABLE announcements_new (
                        id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                        message TEXT NOT NULL,
                        severity TEXT NOT NULL DEFAULT 'info',
                        active INTEGER NOT NULL DEFAULT 1,
                        expires_at TEXT,
                        created_by TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL,
                        CONSTRAINT ck_announcements_severity CHECK (
                            severity IN ('info', 'warn', 'critical', 'success')
                        )
                    )
                """))
                await conn.execute(text("""
                    INSERT INTO announcements_new
                        (id, message, severity, active, expires_at, created_by, created_at, updated_at)
                    SELECT id, message,
                           CASE type
                               WHEN 'info'  THEN 'info'
                               WHEN 'warn'  THEN 'warn'
                               WHEN 'error' THEN 'critical'
                               ELSE 'info'
                           END,
                           active, expires_at, created_by, created_at, updated_at
                    FROM announcements
                """))
                await conn.execute(text("DROP TABLE announcements"))
                await conn.execute(text("ALTER TABLE announcements_new RENAME TO announcements"))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active)"
                ))
            else:
                # PostgreSQL: ALTER TABLE + UPDATE + DROP COLUMN
                await conn.execute(text(
                    "ALTER TABLE announcements ADD COLUMN severity TEXT NOT NULL DEFAULT 'info'"
                ))
                await conn.execute(text("""
                    UPDATE announcements SET severity =
                        CASE type
                            WHEN 'info'  THEN 'info'
                            WHEN 'warn'  THEN 'warn'
                            WHEN 'error' THEN 'critical'
                            ELSE 'info'
                        END
                """))
                await conn.execute(text(
                    "ALTER TABLE announcements DROP COLUMN type"
                ))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(active)"
                ))
    except Exception:
        pass  # Tabelle noch nicht vorhanden oder Migration bereits durchgeführt

    # PROJ-12 Bug-Fix: resource_assignments UNIQUE-Constraint um portal_node_id erweitern.
    # Alter Constraint: (user_id, resource_type, resource_id) – blockiert gleiche VMID auf unterschiedl. Nodes.
    # Neuer Constraint: (user_id, resource_type, portal_node_id, resource_id)
    try:
        from backend.db.dialect import _dialect_is_sqlite

        def _check_resource_assignments_needs_migration(sync_conn) -> bool:
            try:
                for idx in sa_inspect(sync_conn).get_unique_constraints("resource_assignments"):
                    if set(idx.get("column_names", [])) == {"user_id", "resource_type", "resource_id"}:
                        return True
                return False
            except Exception:
                return False

        needs_ra_migration = await conn.run_sync(_check_resource_assignments_needs_migration)
        if needs_ra_migration:
            dialect_name = await conn.run_sync(lambda c: c.dialect.name)
            if dialect_name == "sqlite":
                await conn.execute(text("""
                    CREATE TABLE resource_assignments_new (
                        id              INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                        user_id         INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
                        resource_type   TEXT NOT NULL,
                        resource_id     INTEGER NOT NULL,
                        portal_node_id  INTEGER REFERENCES nodes(id) ON DELETE SET NULL,
                        preset_id       INTEGER NOT NULL REFERENCES role_presets(id),
                        created_at      TEXT NOT NULL,
                        created_by      TEXT NOT NULL,
                        CONSTRAINT uq_resource_assignments
                            UNIQUE (user_id, resource_type, portal_node_id, resource_id),
                        CONSTRAINT ck_resource_assignments_type
                            CHECK (resource_type IN ('vm', 'lxc'))
                    )
                """))
                await conn.execute(text("""
                    INSERT INTO resource_assignments_new
                        (id, user_id, resource_type, resource_id, portal_node_id,
                         preset_id, created_at, created_by)
                    SELECT id, user_id, resource_type, resource_id, portal_node_id,
                           preset_id, created_at, created_by
                    FROM resource_assignments
                """))
                await conn.execute(text("DROP TABLE resource_assignments"))
                await conn.execute(text(
                    "ALTER TABLE resource_assignments_new RENAME TO resource_assignments"
                ))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_resource_assignments_user_id "
                    "ON resource_assignments(user_id)"
                ))
                await conn.execute(text(
                    "CREATE INDEX IF NOT EXISTS idx_resource_assignments_preset_id "
                    "ON resource_assignments(preset_id)"
                ))
            else:
                # PostgreSQL: Constraint droppen + neu anlegen
                await conn.execute(text(
                    "ALTER TABLE resource_assignments "
                    "DROP CONSTRAINT IF EXISTS uq_resource_assignments"
                ))
                await conn.execute(text(
                    "ALTER TABLE resource_assignments "
                    "ADD CONSTRAINT uq_resource_assignments "
                    "UNIQUE (user_id, resource_type, portal_node_id, resource_id)"
                ))
    except Exception:
        pass

    # PROJ-65: notification_reads Tabelle anlegen (idempotent via CREATE TABLE IF NOT EXISTS)
    try:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS notification_reads (
                user_id    INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
                source     TEXT NOT NULL,
                source_id  TEXT NOT NULL,
                read_at    TEXT NOT NULL,
                PRIMARY KEY (user_id, source, source_id),
                CONSTRAINT ck_notification_reads_source CHECK (
                    source IN ('alert', 'announcement', 'event')
                )
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_notification_reads_user_read "
            "ON notification_reads(user_id, read_at DESC)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_notification_reads_source "
            "ON notification_reads(source, source_id)"
        ))
    except Exception:
        pass

    # PROJ-73: node_updates Tabelle anlegen (idempotent via CREATE TABLE IF NOT EXISTS)
    try:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS node_updates (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                portal_node_id      INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                proxmox_node_name   TEXT NOT NULL,
                last_check_at       TEXT,
                last_success_at     TEXT,
                last_error          TEXT,
                payload_json        TEXT NOT NULL DEFAULT '[]',
                CONSTRAINT uq_node_updates_member UNIQUE (portal_node_id, proxmox_node_name)
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_node_updates_portal_node_id "
            "ON node_updates(portal_node_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_node_updates_last_success_at "
            "ON node_updates(last_success_at)"
        ))
    except Exception:
        pass

    # PROJ-54: user_sidebar_pins CHECK-Constraint um 'node_tab' erweitern.
    # PROJ-71: Dialect-Branch – SQLite-CREATE-NEW-Pattern bleibt, PG bekommt DROP+ADD CONSTRAINT.
    try:
        _PIN_KINDS = (
            "'system_settings_tab', 'system_settings_sub_tab', "
            "'vm', 'lxc', 'node', 'node_tab', 'pool', 'group', 'other'"
        )

        def _check_pins_needs_migration(sync_conn) -> str | None:
            """Gibt den Dialect-Namen zurück wenn Migration nötig, sonst None."""
            try:
                cols = {c["name"] for c in sa_inspect(sync_conn).get_columns("user_sidebar_pins")}
                if "pin_kind" not in cols:
                    return None  # Tabelle zu alt oder nicht vorhanden
            except Exception:
                return None
            dialect = sync_conn.dialect.name
            if dialect == "sqlite":
                # SQLite: DDL-String prüfen ob 'node_tab' schon vorhanden
                row = sync_conn.execute(
                    text("SELECT sql FROM sqlite_master WHERE type='table' AND name='user_sidebar_pins'")
                ).fetchone()
                if row and row[0] and "'node_tab'" not in row[0]:
                    return "sqlite"
                return None
            else:
                # PostgreSQL: information_schema-Check ob Constraint das richtige Set hat
                row = sync_conn.execute(
                    text(
                        "SELECT 1 FROM information_schema.check_constraints "
                        "WHERE constraint_schema='public' "
                        "AND constraint_name='ck_sidebar_pins_kind' "
                        "AND check_clause LIKE '%node_tab%'"
                    )
                ).fetchone()
                if row is None:
                    return "postgresql"
                return None

        dialect_for_pins = await conn.run_sync(_check_pins_needs_migration)

        if dialect_for_pins == "sqlite":
            await conn.execute(text(f"""
                CREATE TABLE user_sidebar_pins_new (
                    id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
                    route TEXT NOT NULL,
                    label TEXT,
                    position INTEGER NOT NULL DEFAULT 0,
                    pin_kind TEXT NOT NULL DEFAULT 'other',
                    resource_ref TEXT,
                    created_at TEXT NOT NULL,
                    UNIQUE (user_id, route),
                    CONSTRAINT ck_sidebar_pins_kind CHECK (
                        pin_kind IN ({_PIN_KINDS})
                    )
                )
            """))
            await conn.execute(text("""
                INSERT INTO user_sidebar_pins_new
                    (id, user_id, route, label, position, pin_kind, resource_ref, created_at)
                SELECT id, user_id, route, label, position, pin_kind, resource_ref, created_at
                FROM user_sidebar_pins
                WHERE pin_kind IN (
                    'system_settings_tab', 'system_settings_sub_tab',
                    'vm', 'lxc', 'node', 'pool', 'group', 'other'
                )
            """))
            await conn.execute(text("DROP TABLE user_sidebar_pins"))
            await conn.execute(text("ALTER TABLE user_sidebar_pins_new RENAME TO user_sidebar_pins"))

        elif dialect_for_pins == "postgresql":
            # PostgreSQL: CHECK-Constraint via DROP + ADD (ALTER TABLE in einer Transaktion)
            await conn.execute(text(
                "ALTER TABLE user_sidebar_pins DROP CONSTRAINT IF EXISTS ck_sidebar_pins_kind"
            ))
            await conn.execute(text(
                f"ALTER TABLE user_sidebar_pins ADD CONSTRAINT ck_sidebar_pins_kind "
                f"CHECK (pin_kind IN ({_PIN_KINDS}))"
            ))
    except Exception:
        pass  # Tabelle noch nicht vorhanden oder Migration bereits durchgeführt


async def init_db() -> None:
    global _engine, _SessionLocal

    if _engine is not None:
        await _engine.dispose()

    url = _db_url()
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    # PROJ-71: pool_pre_ping=True – überlebt idle-Timeouts, PG-Reload, Netzwerk-Glitches.
    # pool_size/max_overflow nur für PostgreSQL; aiosqlite ignoriert diese Parameter.
    engine_kwargs: dict = {"echo": False, "pool_pre_ping": True}
    if not url.startswith("sqlite"):
        engine_kwargs["pool_size"] = settings.db_pool_size
        engine_kwargs["max_overflow"] = settings.db_pool_max_overflow
    _engine = create_async_engine(url, **engine_kwargs)

    if url.startswith("sqlite"):
        event.listen(_engine.sync_engine, "connect", _set_sqlite_pragma)

    _SessionLocal = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)

    from backend.db.models import metadata
    async with _engine.begin() as conn:
        await conn.run_sync(metadata.create_all)
        await _migrate_db(conn)

    logger.info("Datenbank initialisiert: %s", url.split("@")[-1] if "@" in url else url)


async def migrate_env_to_db() -> None:
    """PROJ-21: Import env-vars into portal_config + nodes on first start.

    Runs after init_db(). Idempotent – skips keys already present in the DB.
    Existing deployments (env-vars + admin already in DB) get setup_complete=true
    set silently so they never see the wizard.
    """
    from backend.services.config_service import encrypt_secret, set_config
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()

    env_imports = [
        ("proxmox_host",       settings.proxmox_host,                    False),
        ("proxmox_node",       settings.proxmox_node,                    False),
        ("proxmox_verify_ssl", str(settings.proxmox_verify_ssl).lower(), False),
        ("packer_http_ip",     settings.packer_http_ip or "",             False),
    ]

    async with _SessionLocal() as session:
        for key, value, is_secret in env_imports:
            if not value:
                continue
            existing = await session.execute(
                text("SELECT 1 FROM portal_config WHERE key = :k"), {"k": key}
            )
            if existing.fetchone():
                continue
            stored = encrypt_secret(value) if is_secret else value
            await session.execute(
                text(
                    "INSERT INTO portal_config (key, value, is_secret, updated_at, updated_by) "
                    "VALUES (:k, :v, :s, :t, 'system') "
                    "ON CONFLICT(key) DO NOTHING"
                ),
                {"k": key, "v": stored, "s": 1 if is_secret else 0, "t": now},
            )

        count_result = await session.execute(text("SELECT COUNT(*) FROM nodes"))
        if (count_result.scalar() or 0) == 0 and settings.proxmox_host and settings.proxmox_node:
            def _enc(val: str | None) -> str:
                return encrypt_secret(val) if val else ""

            await session.execute(
                text(
                    "INSERT INTO nodes (name, url, proxmox_node, verify_ssl, "
                    "token_id, token_secret, "
                    "viewer_token_id, viewer_token_secret, "
                    "operator_token_id, operator_token_secret, "
                    "admin_token_id, admin_token_secret, "
                    "packer_token_id, packer_token_secret, "
                    "is_default, created_at, created_by) "
                    "VALUES ('Default', :url, :pnode, :ssl, "
                    ":tid, :tsec, "
                    ":vid, :vsec, "
                    ":oid, :osec, "
                    ":aid, :asec, "
                    ":pid, :psec, "
                    "1, :now, 'system')"
                ),
                {
                    "url": settings.proxmox_host.rstrip("/"),
                    "pnode": settings.proxmox_node,
                    "ssl": 1 if settings.proxmox_verify_ssl else 0,
                    "tid": settings.proxmox_admin_token_id or "",
                    "tsec": _enc(settings.proxmox_admin_token_secret),
                    "vid": settings.proxmox_viewer_token_id or "",
                    "vsec": _enc(settings.proxmox_viewer_token_secret),
                    "oid": settings.proxmox_operator_token_id or "",
                    "osec": _enc(settings.proxmox_operator_token_secret),
                    "aid": settings.proxmox_admin_token_id or "",
                    "asec": _enc(settings.proxmox_admin_token_secret),
                    "pid": settings.packer_token_id or "",
                    "psec": _enc(settings.packer_token_secret),
                    "now": now,
                },
            )

        sc_result = await session.execute(
            text("SELECT 1 FROM portal_config WHERE key = 'setup_complete'")
        )
        if not sc_result.fetchone():
            admin_result = await session.execute(
                text("SELECT COUNT(*) FROM local_users WHERE role = 'admin' AND active = 1")
            )
            node_result = await session.execute(text("SELECT COUNT(*) FROM nodes"))
            has_admin = (admin_result.scalar() or 0) > 0
            has_node = (node_result.scalar() or 0) > 0
            if has_admin and has_node:
                await session.execute(
                    text(
                        "INSERT INTO portal_config (key, value, is_secret, updated_at, updated_by) "
                        "VALUES ('setup_complete', 'true', 0, :now, 'migration') "
                        "ON CONFLICT(key) DO NOTHING"
                    ),
                    {"now": now},
                )

        await session.commit()
