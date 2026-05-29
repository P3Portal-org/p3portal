# p3portal.org
"""PROJ-71: Dialect-Abstraktion für SQLite + PostgreSQL.

Drei Helper-Funktionen kanalisieren alle 26 SQLite-spezifischen SQL-Stellen
die beim Codebase-Audit (Session 516) gefunden wurden:

  1. _dialect_is_sqlite / _dialect_is_postgresql  – Dialect-Prädikate
  2. upsert_or_ignore                              – INSERT … ON CONFLICT DO NOTHING
  3. json_path_extract                             – JSON-Feld aus TEXT-Spalte lesen

Aufruf immer über diese Datei – nie direkt dialect-spezifisches SQL schreiben.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection


# ---------------------------------------------------------------------------
# 1. Dialect-Prädikate
# ---------------------------------------------------------------------------

def _dialect_is_sqlite(conn: Connection) -> bool:
    """True wenn die Connection auf SQLite läuft."""
    return conn.dialect.name == "sqlite"


def _dialect_is_postgresql(conn: Connection) -> bool:
    """True wenn die Connection auf PostgreSQL läuft."""
    return conn.dialect.name == "postgresql"


# ---------------------------------------------------------------------------
# 2. upsert_or_ignore – INSERT … ON CONFLICT DO NOTHING
#
# ON CONFLICT DO NOTHING ist Standard-SQL seit PG 9.5 (2016) und
# SQLite 3.24 (2018). Ein einziger SQL-String deckt beide Dialekte ab.
# Alle 9 INSERT-OR-IGNORE-Stellen im Code nutzen diesen Helper.
#
# Voraussetzung: Die Zieltabelle hat einen PRIMARY KEY oder UNIQUE-Index
# auf den betroffenen Spalten (bei allen 9 Aufrufstellen gegeben).
# ---------------------------------------------------------------------------

def upsert_or_ignore(table: str, columns: list[str], values: dict) -> tuple[str, dict]:
    """Gibt ein (sql_string, params)-Tuple zurück für INSERT … ON CONFLICT DO NOTHING.

    Beispiel:
        sql, params = upsert_or_ignore(
            "user_profiles",
            ["username", "auth_type"],
            {"username": "alice", "auth_type": "local"},
        )
        await session.execute(text(sql), params)
    """
    col_list = ", ".join(columns)
    placeholders = ", ".join(f":{c}" for c in columns)
    sql = (
        f"INSERT INTO {table} ({col_list}) "
        f"VALUES ({placeholders}) "
        f"ON CONFLICT DO NOTHING"
    )
    return sql, values


# ---------------------------------------------------------------------------
# 3. json_path_extract – JSON-Feld aus TEXT-Spalte lesen
#
# SQLite:     JSON_EXTRACT(col, '$.path')
# PostgreSQL: (col::jsonb)->>'path'
#
# Kein gemeinsamer SQL-String möglich → zwei Pfade je Dialekt.
# Die Funktion gibt einen SQL-Fragment-String zurück, der direkt in
# eine WHERE-Klausel eingesetzt werden kann.
#
# Verwendung:
#   frag = json_path_extract("config", "action_type", dialect_name)
#   query = f"SELECT id FROM scheduled_jobs WHERE {frag} = :val"
# ---------------------------------------------------------------------------

def json_path_extract(column: str, path: str, dialect_name: str) -> str:
    """Gibt ein SQL-Fragment zurück, das den JSON-Pfad aus einer TEXT-Spalte liest.

    Args:
        column:       Spaltenname (z.B. "config", "payload", "detail")
        path:         JSON-Pfad ohne '$.' Prefix (z.B. "action_type", "tool")
        dialect_name: "sqlite" oder "postgresql" (conn.dialect.name)

    Returns:
        SQL-Fragment-String (kein abschließendes Leerzeichen)
    """
    if dialect_name == "postgresql":
        return f"({column}::jsonb)->>'{path}'"
    # SQLite (und alle anderen Dialekte als Fallback)
    return f"JSON_EXTRACT({column}, '$.{path}')"


def get_dialect_name(conn) -> str:
    """Gibt den Dialect-Namen einer sync oder async Connection zurück."""
    # SQLAlchemy sync connections haben .dialect.name direkt
    # async connections geben es über .sync_connection.dialect.name zurück
    try:
        return conn.dialect.name
    except AttributeError:
        try:
            return conn.sync_connection.dialect.name
        except AttributeError:
            return "sqlite"  # Fallback
