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


@pytest.fixture(scope="session")
def _postgres_container(request: pytest.FixtureRequest):
    """Startet postgres:17-alpine Container für die Test-Session.

    Nur aktiv wenn --db=postgres übergeben wurde.
    """
    if request.config.getoption("--db") != "postgres":
        yield None
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

    pg_url = _postgres_container.get_connection_url()
    # testcontainers liefert postgresql+psycopg2://… → asyncpg-Dialekt
    asyncpg_url = pg_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
    settings.db_url = asyncpg_url

    yield

    settings.db_url = ""
