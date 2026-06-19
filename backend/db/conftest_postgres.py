# p3portal.org
"""PROJ-71: PostgreSQL-Fixture via testcontainers (session-scoped).

Wird nur aktiviert wenn pytest --db=postgres übergeben wird.
Startet einmalig einen postgres:17-alpine Container pro Test-Session
und setzt settings.db_url auf asyncpg-URL des Containers.

Tests die init_db() aufrufen nutzen dann PostgreSQL statt SQLite.
Tests ohne DB-Zugriff sind transparent (kein Overhead).
"""
from __future__ import annotations

import pytest
import pytest_asyncio


@pytest.fixture(scope="session")
def _postgres_container(request: pytest.FixtureRequest):
    """Startet postgres:17-alpine Container für die Test-Session.

    Nur aktiv wenn --db=postgres übergeben wurde.
    """
    if request.config.getoption("--db") != "postgres":
        yield None
        return

    # Lokaler Schnellpfad: feste URL (z. B. manuell gestarteter Container) statt
    # testcontainers. Erlaubt postgres-Tests ohne Docker-Socket-Zugriff
    # (z. B. aus einer Flatpak-Sandbox gegen einen Host-podman-Container).
    #   TEST_PG_URL=postgresql+asyncpg://postgres:test@127.0.0.1:5433/test
    import os
    fixed_url = os.environ.get("TEST_PG_URL")
    if fixed_url:
        yield fixed_url
        return

    try:
        from testcontainers.postgres import PostgresContainer
    except ImportError:
        pytest.skip("testcontainers[postgres] nicht installiert – pip install testcontainers[postgres]")
        return

    with PostgresContainer("postgres:17-alpine") as pg:
        yield pg


@pytest.fixture(scope="session", autouse=True)
def configure_pg_url(request: pytest.FixtureRequest, _postgres_container) -> None:
    """Mutiert settings.db_url auf PG-asyncpg-URL wenn --db=postgres aktiv.

    session-scoped + autouse → läuft einmalig vor allen Tests.
    Gibt settings.db_url am Ende der Session zurück auf "" zurück.
    """
    if _postgres_container is None:
        yield  # No-op: SQLite-Modus, kein PG-Container aktiv
        return

    from backend.core.config import settings

    if isinstance(_postgres_container, str):
        # Fester TEST_PG_URL-Pfad (bereits asyncpg-Dialekt erwartet)
        asyncpg_url = _postgres_container
    else:
        pg_url = _postgres_container.get_connection_url()
        # testcontainers liefert postgresql+psycopg2://… → asyncpg-Dialekt
        asyncpg_url = pg_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
    settings.db_url = asyncpg_url

    yield

    settings.db_url = ""


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _build_canonical_pg_schema(request: pytest.FixtureRequest, configure_pg_url):
    """PG only: build the full canonical schema ONCE per session.

    PROJ-71 Phase 2: the per-test reset uses ``TRUNCATE`` (AC-SPEED-1), which
    keeps the schema between tests. That is only safe if the schema is *correct*.
    Several plus-module test fixtures call ``<module>.plus_metadata.create_all``
    directly; those MetaData objects carry **phantom stub tables** for cross-
    MetaData FK resolution (e.g. approvals' ``scheduled_jobs`` with only an ``id``
    column, ``keep_existing=True``). If such a fixture runs before the real,
    fully-columned ``scheduled_jobs`` exists, FK ordering creates the *id-only*
    stub — and ``TRUNCATE`` then preserves that broken table forever, so
    ``create_all(checkfirst=True)`` never repairs it and later scheduled_jobs
    tests fail with "column ... does not exist". (Under the old DROP-SCHEMA reset
    this was hidden because every test rebuilt a fresh schema.)

    Building the canonical schema once up front — exactly the app's lifespan
    order (init_db → import backend.plus → ensure_plus_db_tables, which creates
    the full scheduled_jobs *before* approvals' phantom) — guarantees the real
    tables exist first. All later per-test/per-fixture ``create_all`` calls then
    skip them via checkfirst, and the phantom never wins.

    No-op in SQLite mode (each SQLite test gets a fresh tmp_path DB anyway).
    """
    if request.config.getoption("--db") != "postgres":
        yield
        return

    import tempfile

    from backend.core.config import settings as _settings
    from backend.db.database import init_db
    import backend.plus  # noqa: F401 — triggers Plus-Loader/Discovery
    from backend.core.plus_protocol import plus_behavior

    # init_db() legt settings.data_dir an (Logs etc.). Außerhalb der per-Test-
    # ``patch_data_dir``-Fixtures zeigt es noch auf das read-only Default-Volume
    # /app/data → für den einmaligen Session-Build ein beschreibbares tmp-Dir.
    _orig_data_dir = _settings.data_dir
    _settings.data_dir = tempfile.mkdtemp(prefix="p3pg-schema-")
    try:
        await init_db()
    finally:
        _settings.data_dir = _orig_data_dir
    # ensure_plus_db_tables ist ein Dispatcher-Override (läuft unabhängig von der
    # Lizenz) und nutzt die Sync-Engine → baut alle Plus-Tabellen in korrekter
    # Reihenfolge (scheduled_jobs VOR approvals-Phantom).
    plus_behavior.ensure_plus_db_tables()

    yield


@pytest_asyncio.fixture(autouse=True)
async def _reset_pg_schema(request: pytest.FixtureRequest):
    """Per-test PostgreSQL state isolation: TRUNCATE all public tables.

    SQLite tests get a fresh tmp_path database file per test (via each test
    file's ``patch_data_dir`` autouse fixture), so state never leaks between
    them. PostgreSQL tests all share one container database, so without a reset
    the idempotent ``create_all`` keeps tables and their rows around and later
    tests collide on UNIQUE constraints / see stale data.

    PROJ-71 Phase 2 (AC-SPEED-1): instead of ``DROP SCHEMA public CASCADE;
    CREATE SCHEMA public`` — which forced every test to rebuild the full 34+
    table schema from scratch and made the full suite time out — we keep the
    schema and only wipe row data via
    ``TRUNCATE <all public tables> RESTART IDENTITY CASCADE`` before each test.
    The table list is read dynamically from ``pg_tables``; when it is empty
    (the very first test, before any ``init_db()`` ran — EC-3) the TRUNCATE is
    skipped as a no-op. ``RESTART IDENTITY`` resets SERIAL sequences so id=1
    assumptions hold per test; ``CASCADE`` handles FK references.

    Works because ``asyncio_default_test_loop_scope = session`` keeps engine
    creation and the test body on the same event loop (otherwise asyncpg
    rejects the connection with "Future attached to a different loop").

    No-op in SQLite mode.
    """
    if request.config.getoption("--db") != "postgres":
        yield
        return

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from backend.core.config import settings

    engine = create_async_engine(settings.db_url)
    try:
        async with engine.begin() as conn:
            rows = await conn.execute(
                text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            )
            tables = [r[0] for r in rows.fetchall()]
            if tables:
                quoted = ", ".join(f'"{t}"' for t in tables)
                await conn.execute(
                    text(f"TRUNCATE {quoted} RESTART IDENTITY CASCADE")
                )
    finally:
        await engine.dispose()

    yield
