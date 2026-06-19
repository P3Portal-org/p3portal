# p3portal.org
"""PROJ-83: Persistierter In-Guest-Host-Zustand (Core).

Speichert NUR das aus Proxmox nicht rekonstruierbare Minimum pro
(portal_node_id, vmid, kind): ssh_managed, ansible_user, global_opt_in, host_key.
Existenz/Name/IP/Owner/Pool sind abgeleitet (kein materialisiertes Inventory).
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import text

from backend.db.database import get_db

DEFAULT_ANSIBLE_USER = "p3-ansible"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    return {
        "portal_node_id": row["portal_node_id"],
        "vmid": row["vmid"],
        "kind": row["kind"],
        "ssh_managed": bool(row["ssh_managed"]),
        "ansible_user": row["ansible_user"],
        "global_opt_in": bool(row["global_opt_in"]),
        "host_key": row["host_key"],
        "host_origin": row["host_origin"],
    }


async def get_host_state(portal_node_id: int, vmid: int, kind: str) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT * FROM ansible_managed_hosts "
                "WHERE portal_node_id = :nid AND vmid = :vmid AND kind = :kind"
            ),
            {"nid": portal_node_id, "vmid": vmid, "kind": kind},
        )
        row = result.mappings().fetchone()
    return _row_to_dict(row) if row else None


async def bulk_get_host_states(
    portal_node_id: int, candidates: list[tuple[int, str]]
) -> dict[tuple[int, str], dict]:
    """Lade Host-Zustände für eine Liste von (vmid, kind) auf einem Portal-Node.

    Gibt ein Dict (vmid, kind) → Zustand zurück. Fehlende Kandidaten erscheinen
    nicht im Ergebnis (→ implizit unmanaged).
    """
    if not candidates:
        return {}
    async with get_db() as db:
        result = await db.execute(
            text(
                "SELECT * FROM ansible_managed_hosts WHERE portal_node_id = :nid"
            ),
            {"nid": portal_node_id},
        )
        rows = result.mappings().fetchall()
    wanted = set(candidates)
    out: dict[tuple[int, str], dict] = {}
    for r in rows:
        key = (r["vmid"], r["kind"])
        if key in wanted:
            out[key] = _row_to_dict(r)
    return out


async def upsert_host_state(
    portal_node_id: int,
    vmid: int,
    kind: str,
    *,
    ssh_managed: bool,
    ansible_user: str = DEFAULT_ANSIBLE_USER,
    global_opt_in: bool = False,
) -> None:
    """Setzt den verwalteten Zustand (Deploy-Hook). Host-Key bleibt unberührt.

    Portabler UPSERT: UPDATE versuchen, bei 0 Treffern INSERT (SQLite + PostgreSQL).
    """
    now = _now()
    async with get_db() as db:
        result = await db.execute(
            text(
                "UPDATE ansible_managed_hosts "
                "SET ssh_managed = :sm, ansible_user = :au, global_opt_in = :go, updated_at = :now "
                "WHERE portal_node_id = :nid AND vmid = :vmid AND kind = :kind"
            ),
            {
                "sm": 1 if ssh_managed else 0,
                "au": ansible_user,
                "go": 1 if global_opt_in else 0,
                "now": now,
                "nid": portal_node_id,
                "vmid": vmid,
                "kind": kind,
            },
        )
        if result.rowcount == 0:
            await db.execute(
                text(
                    "INSERT INTO ansible_managed_hosts "
                    "(portal_node_id, vmid, kind, ssh_managed, ansible_user, global_opt_in, "
                    " host_origin, created_at, updated_at) "
                    "VALUES (:nid, :vmid, :kind, :sm, :au, :go, 'proxmox', :now, :now)"
                ),
                {
                    "nid": portal_node_id,
                    "vmid": vmid,
                    "kind": kind,
                    "sm": 1 if ssh_managed else 0,
                    "au": ansible_user,
                    "go": 1 if global_opt_in else 0,
                    "now": now,
                },
            )
        await db.commit()


async def set_managed(
    portal_node_id: int,
    vmid: int,
    kind: str,
    *,
    global_opt_in: bool | None = None,
) -> None:
    """PROJ-84: Markiert einen bestehenden Host als verwaltet (`ssh_managed=true`), **ohne**
    andere Felder zu überschreiben.

    - `global_opt_in=None` (Einzel-„mark managed", Core): nur `ssh_managed` setzen, `global_opt_in`
      bleibt unverändert (bei INSERT: 0).
    - `global_opt_in=True` (node-weites Onboarding, Plus): zusätzlich `global_opt_in=1` setzen →
      Host wird im Global-Scope ausführbar.

    Host-Key bleibt unberührt (TOFU beim ersten Run). Portabler UPSERT (SQLite + PostgreSQL).
    """
    now = _now()
    set_global = global_opt_in is not None
    async with get_db() as db:
        if set_global:
            result = await db.execute(
                text(
                    "UPDATE ansible_managed_hosts SET ssh_managed = 1, global_opt_in = :go, "
                    "updated_at = :now WHERE portal_node_id = :nid AND vmid = :vmid AND kind = :kind"
                ),
                {"go": 1 if global_opt_in else 0, "now": now,
                 "nid": portal_node_id, "vmid": vmid, "kind": kind},
            )
        else:
            result = await db.execute(
                text(
                    "UPDATE ansible_managed_hosts SET ssh_managed = 1, updated_at = :now "
                    "WHERE portal_node_id = :nid AND vmid = :vmid AND kind = :kind"
                ),
                {"now": now, "nid": portal_node_id, "vmid": vmid, "kind": kind},
            )
        if result.rowcount == 0:
            await db.execute(
                text(
                    "INSERT INTO ansible_managed_hosts "
                    "(portal_node_id, vmid, kind, ssh_managed, ansible_user, global_opt_in, "
                    " host_origin, created_at, updated_at) "
                    "VALUES (:nid, :vmid, :kind, 1, :au, :go, 'proxmox', :now, :now)"
                ),
                {
                    "nid": portal_node_id, "vmid": vmid, "kind": kind,
                    "au": DEFAULT_ANSIBLE_USER,
                    "go": 1 if global_opt_in else 0,
                    "now": now,
                },
            )
        await db.commit()


async def persist_host_key(
    portal_node_id: int, vmid: int, kind: str, host_key: str
) -> None:
    """Persistiert den beim Erstkontakt geernteten Host-Key (TOFU).

    Erstellt bei Bedarf eine Zeile (z.B. adoptierter Host ohne Deploy-State).
    """
    now = _now()
    async with get_db() as db:
        result = await db.execute(
            text(
                "UPDATE ansible_managed_hosts SET host_key = :hk, updated_at = :now "
                "WHERE portal_node_id = :nid AND vmid = :vmid AND kind = :kind"
            ),
            {"hk": host_key, "now": now, "nid": portal_node_id, "vmid": vmid, "kind": kind},
        )
        if result.rowcount == 0:
            await db.execute(
                text(
                    "INSERT INTO ansible_managed_hosts "
                    "(portal_node_id, vmid, kind, ssh_managed, ansible_user, global_opt_in, "
                    " host_key, host_origin, created_at, updated_at) "
                    "VALUES (:nid, :vmid, :kind, 0, :au, 0, :hk, 'proxmox', :now, :now)"
                ),
                {
                    "nid": portal_node_id,
                    "vmid": vmid,
                    "kind": kind,
                    "au": DEFAULT_ANSIBLE_USER,
                    "hk": host_key,
                    "now": now,
                },
            )
        await db.commit()


async def reset_host_key(portal_node_id: int, vmid: int, kind: str) -> bool:
    """Löscht den gemerkten Host-Key → nächster Run re-TOFUt. True wenn eine Zeile betroffen."""
    now = _now()
    async with get_db() as db:
        result = await db.execute(
            text(
                "UPDATE ansible_managed_hosts SET host_key = NULL, updated_at = :now "
                "WHERE portal_node_id = :nid AND vmid = :vmid AND kind = :kind"
            ),
            {"now": now, "nid": portal_node_id, "vmid": vmid, "kind": kind},
        )
        await db.commit()
    return result.rowcount > 0


async def delete_vanished(
    portal_node_id: int, still_visible: set[tuple[int, str]]
) -> int:
    """Entfernt persistierten Zustand für (vmid, kind), die auf dem Node nicht mehr
    sichtbar sind (Cluster-Refresh, AC-CLEAN-2). Gibt die Anzahl gelöschter Zeilen zurück."""
    async with get_db() as db:
        result = await db.execute(
            text("SELECT vmid, kind FROM ansible_managed_hosts WHERE portal_node_id = :nid"),
            {"nid": portal_node_id},
        )
        rows = result.mappings().fetchall()
        to_delete = [
            (r["vmid"], r["kind"]) for r in rows if (r["vmid"], r["kind"]) not in still_visible
        ]
        for vmid, kind in to_delete:
            await db.execute(
                text(
                    "DELETE FROM ansible_managed_hosts "
                    "WHERE portal_node_id = :nid AND vmid = :vmid AND kind = :kind"
                ),
                {"nid": portal_node_id, "vmid": vmid, "kind": kind},
            )
        await db.commit()
    return len(to_delete)
