# p3portal.org
"""PROJ-21: Proxmox node registry – CRUD + connection test.
PROJ-26: cluster_nodes support – a Portal entry represents one Proxmox installation;
         cluster_nodes lists additional PVE node names belonging to the same installation.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx
from sqlalchemy import text

from backend.db.database import get_db
from backend.services.config_service import decrypt_secret, encrypt_secret


@dataclass
class NodeRow:
    id: int
    name: str
    url: str
    proxmox_node: str
    verify_ssl: bool
    token_id: str
    token_secret: str   # plain – NEVER include in API responses
    viewer_token_id: str
    viewer_token_secret: str        # plain – NEVER expose
    operator_token_id: str
    operator_token_secret: str      # plain – NEVER expose
    admin_token_id: str
    admin_token_secret: str         # plain – NEVER expose
    packer_token_id: str
    packer_token_secret: str        # plain – NEVER expose
    tofu_token_id: str              # PROJ-76 Phase 2a
    tofu_token_secret: str          # plain – NEVER expose
    is_default: bool
    created_at: str
    created_by: str
    cluster_nodes: list[str] = field(default_factory=list)  # PROJ-26
    poll_interval: int = 30                                  # PROJ-33


def _safe_decrypt(value: str | None) -> str:
    if not value:
        return ""
    try:
        return decrypt_secret(value)
    except Exception:
        return ""


def _parse_cluster_nodes(raw: str | None) -> list[str]:
    """Parse cluster_nodes JSON array from DB. Returns [] on any error."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [str(n) for n in parsed if n] if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _to_node(row) -> NodeRow:
    def _col(name: str, default: str = "") -> str:
        try:
            return row[name] or default
        except (KeyError, IndexError):
            return default

    return NodeRow(
        id=row["id"],
        name=row["name"],
        url=row["url"],
        proxmox_node=row["proxmox_node"],
        verify_ssl=bool(row["verify_ssl"]),
        token_id=row["token_id"] or "",
        token_secret=_safe_decrypt(row["token_secret"]),
        viewer_token_id=_col("viewer_token_id"),
        viewer_token_secret=_safe_decrypt(_col("viewer_token_secret")),
        operator_token_id=_col("operator_token_id"),
        operator_token_secret=_safe_decrypt(_col("operator_token_secret")),
        admin_token_id=_col("admin_token_id"),
        admin_token_secret=_safe_decrypt(_col("admin_token_secret")),
        packer_token_id=_col("packer_token_id"),
        packer_token_secret=_safe_decrypt(_col("packer_token_secret")),
        tofu_token_id=_col("tofu_token_id"),
        tofu_token_secret=_safe_decrypt(_col("tofu_token_secret")),
        is_default=bool(row["is_default"]),
        created_at=row["created_at"],
        created_by=row["created_by"],
        cluster_nodes=_parse_cluster_nodes(_col("cluster_nodes")),
        poll_interval=int(row["poll_interval"]) if row.get("poll_interval") is not None else 30,
    )


async def list_nodes() -> list[NodeRow]:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM nodes ORDER BY is_default DESC, id ASC")
        )
        rows = result.mappings().fetchall()
    return [_to_node(r) for r in rows]


async def get_node(node_id: int) -> NodeRow | None:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM nodes WHERE id = :id"), {"id": node_id}
        )
        row = result.mappings().fetchone()
    return _to_node(row) if row else None


async def get_default_node() -> NodeRow | None:
    """Returns the default node, or the first node if no default is set."""
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM nodes WHERE is_default = 1 LIMIT 1")
        )
        row = result.mappings().fetchone()
        if not row:
            result = await session.execute(
                text("SELECT * FROM nodes ORDER BY id ASC LIMIT 1")
            )
            row = result.mappings().fetchone()
    return _to_node(row) if row else None


async def get_node_for_proxmox_name(proxmox_node: str) -> NodeRow | None:
    """Find node by proxmox_node (primary) or cluster_nodes (members). Default-first.

    PROJ-26: cluster_nodes is a JSON array of additional PVE node names belonging
    to the same Proxmox installation. Membership check is done in Python for
    cross-DB compatibility (SQLite / PostgreSQL / MariaDB).
    """
    async with get_db() as session:
        # Fast path: direct match on proxmox_node
        result = await session.execute(
            text(
                "SELECT * FROM nodes WHERE proxmox_node = :pnode "
                "ORDER BY is_default DESC LIMIT 1"
            ),
            {"pnode": proxmox_node},
        )
        row = result.mappings().fetchone()
        if row:
            return _to_node(row)
        # Slow path: search inside cluster_nodes JSON arrays
        result = await session.execute(
            text("SELECT * FROM nodes ORDER BY is_default DESC")
        )
        rows = result.mappings().fetchall()
    for row in rows:
        if proxmox_node in _parse_cluster_nodes(row.get("cluster_nodes", "")):
            return _to_node(row)
    return None


async def count_nodes() -> int:
    async with get_db() as session:
        result = await session.execute(text("SELECT COUNT(*) FROM nodes"))
        return result.scalar() or 0


async def create_node(
    name: str,
    url: str,
    proxmox_node: str,
    verify_ssl: bool,
    token_id: str,
    token_secret: str,
    viewer_token_id: str = "",
    viewer_token_secret: str = "",
    operator_token_id: str = "",
    operator_token_secret: str = "",
    admin_token_id: str = "",
    admin_token_secret: str = "",
    packer_token_id: str = "",
    packer_token_secret: str = "",
    tofu_token_id: str = "",
    tofu_token_secret: str = "",
    cluster_nodes: list[str] | None = None,
    poll_interval: int = 30,
    created_by: str = "system",
) -> NodeRow:
    now = datetime.now(timezone.utc).isoformat()

    def _enc(val: str) -> str:
        return encrypt_secret(val) if val else ""

    cluster_nodes_json = json.dumps(cluster_nodes or [])
    is_def = 1 if (await count_nodes()) == 0 else 0
    async with get_db() as session:
        result = await session.execute(
            text(
                "INSERT INTO nodes (name, url, proxmox_node, verify_ssl, "
                "token_id, token_secret, "
                "viewer_token_id, viewer_token_secret, "
                "operator_token_id, operator_token_secret, "
                "admin_token_id, admin_token_secret, "
                "packer_token_id, packer_token_secret, "
                "tofu_token_id, tofu_token_secret, "
                "cluster_nodes, poll_interval, is_default, created_at, created_by) "
                "VALUES (:name, :url, :pnode, :ssl, "
                ":tid, :tsec, "
                ":vid, :vsec, "
                ":oid, :osec, "
                ":aid, :asec, "
                ":pid, :psec, "
                ":tofuid, :tofusec, "
                ":cnodes, :poll, :def, :now, :by) RETURNING id"
            ),
            {
                "name": name, "url": url.rstrip("/"), "pnode": proxmox_node,
                "ssl": 1 if verify_ssl else 0,
                "tid": token_id, "tsec": _enc(token_secret),
                "vid": viewer_token_id,   "vsec": _enc(viewer_token_secret),
                "oid": operator_token_id, "osec": _enc(operator_token_secret),
                "aid": admin_token_id,    "asec": _enc(admin_token_secret),
                "pid": packer_token_id,   "psec": _enc(packer_token_secret),
                "tofuid": tofu_token_id,  "tofusec": _enc(tofu_token_secret),
                "cnodes": cluster_nodes_json,
                "poll": poll_interval,
                "def": is_def, "now": now, "by": created_by,
            },
        )
        # RETURNING id statt cursor.lastrowid (asyncpg-kompatibel, S562/S588).
        new_id = result.scalar()
        await session.commit()
    node = await get_node(new_id)
    assert node is not None
    return node


async def update_node(
    node_id: int,
    name: str | None = None,
    url: str | None = None,
    proxmox_node: str | None = None,
    verify_ssl: bool | None = None,
    token_id: str | None = None,
    token_secret: str | None = None,
    viewer_token_id: str | None = None,
    viewer_token_secret: str | None = None,
    operator_token_id: str | None = None,
    operator_token_secret: str | None = None,
    admin_token_id: str | None = None,
    admin_token_secret: str | None = None,
    packer_token_id: str | None = None,
    packer_token_secret: str | None = None,
    tofu_token_id: str | None = None,
    tofu_token_secret: str | None = None,
    cluster_nodes: list[str] | None = None,
    poll_interval: int | None = None,
) -> NodeRow | None:
    node = await get_node(node_id)
    if not node:
        return None
    new_url = (url.rstrip("/") if url else None) or node.url
    new_ssl = verify_ssl if verify_ssl is not None else node.verify_ssl
    new_cluster_nodes = json.dumps(cluster_nodes) if cluster_nodes is not None else json.dumps(node.cluster_nodes)
    new_poll_interval = poll_interval if poll_interval is not None else node.poll_interval

    def _resolve_secret(new: str | None, current_plain: str) -> str:
        # Preserve current secret when caller did not supply a new one.
        if new is None:
            return encrypt_secret(current_plain) if current_plain else ""
        return encrypt_secret(new) if new else ""

    new_secret  = _resolve_secret(token_secret,           node.token_secret)
    new_vsec    = _resolve_secret(viewer_token_secret,    node.viewer_token_secret)
    new_osec    = _resolve_secret(operator_token_secret,  node.operator_token_secret)
    new_asec    = _resolve_secret(admin_token_secret,     node.admin_token_secret)
    new_psec    = _resolve_secret(packer_token_secret,    node.packer_token_secret)
    new_tofusec = _resolve_secret(tofu_token_secret,      node.tofu_token_secret)

    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE nodes SET name=:name, url=:url, proxmox_node=:pnode, "
                "verify_ssl=:ssl, token_id=:tid, token_secret=:tsec, "
                "viewer_token_id=:vid, viewer_token_secret=:vsec, "
                "operator_token_id=:oid, operator_token_secret=:osec, "
                "admin_token_id=:aid, admin_token_secret=:asec, "
                "packer_token_id=:pid, packer_token_secret=:psec, "
                "tofu_token_id=:tofuid, tofu_token_secret=:tofusec, "
                "cluster_nodes=:cnodes, poll_interval=:poll "
                "WHERE id=:id"
            ),
            {
                "name": name or node.name,
                "url": new_url,
                "pnode": proxmox_node or node.proxmox_node,
                "ssl": 1 if new_ssl else 0,
                "tid": token_id if token_id is not None else node.token_id,
                "tsec": new_secret,
                "vid": viewer_token_id   if viewer_token_id   is not None else node.viewer_token_id,
                "vsec": new_vsec,
                "oid": operator_token_id if operator_token_id is not None else node.operator_token_id,
                "osec": new_osec,
                "aid": admin_token_id    if admin_token_id    is not None else node.admin_token_id,
                "asec": new_asec,
                "pid": packer_token_id   if packer_token_id   is not None else node.packer_token_id,
                "psec": new_psec,
                "tofuid": tofu_token_id  if tofu_token_id     is not None else node.tofu_token_id,
                "tofusec": new_tofusec,
                "cnodes": new_cluster_nodes,
                "poll": new_poll_interval,
                "id": node_id,
            },
        )
        await session.commit()
    return await get_node(node_id)


async def delete_node(node_id: int) -> bool:
    """Refuses (returns False) if this is the last node."""
    if (await count_nodes()) <= 1:
        return False
    async with get_db() as session:
        result = await session.execute(
            text("DELETE FROM nodes WHERE id = :id"), {"id": node_id}
        )
        await session.commit()
    # If deleted node was default, promote the next one
    if result.rowcount > 0:
        default = await get_default_node()
        if default and not default.is_default:
            await set_default_node(default.id)
    return result.rowcount > 0


async def set_default_node(node_id: int) -> bool:
    if not await get_node(node_id):
        return False
    async with get_db() as session:
        await session.execute(text("UPDATE nodes SET is_default = 0"))
        await session.execute(
            text("UPDATE nodes SET is_default = 1 WHERE id = :id"), {"id": node_id}
        )
        await session.commit()
    return True


async def test_connection(
    url: str, token_id: str, token_secret: str, verify_ssl: bool
) -> dict:
    """Probe /api2/json/version. Returns {ok, version, error}.

    SSRF-hardening: this endpoint forwards a Proxmox API token to the
    caller-supplied URL. The target is resolved, blocked address ranges
    are rejected, and the connection is pinned to the validated IP via
    Host-header rewrite to prevent DNS-rebinding token exfiltration.
    Errors are returned in a generic form to avoid information leakage.
    """
    import logging
    from urllib.parse import urlparse

    from backend.core.http_client import (
        pin_url_to_ip,
        secure_outbound_client,
        validate_setup_target_url,
    )
    from backend.services.audit_service import write_audit_log

    log = logging.getLogger(__name__)
    url_clean = url.rstrip("/")

    try:
        resolved_ip = validate_setup_target_url(url_clean)
    except ValueError as exc:
        try:
            await write_audit_log(
                event_type="setup_target_blocked",
                username=None,
                auth_type=None,
                detail=f"test-connection rejected: {exc}",
            )
        except Exception:
            pass
        return {"ok": False, "version": None, "error": "target_address_blocked"}

    pinned_url, extra_headers = pin_url_to_ip(
        f"{url_clean}/api2/json/version", resolved_ip
    )
    extra_headers["Authorization"] = f"PVEAPIToken={token_id}={token_secret}"
    hostname = urlparse(url_clean).hostname or ""

    try:
        async with secure_outbound_client(verify=verify_ssl, timeout=5.0) as client:
            resp = await client.get(pinned_url, headers=extra_headers)
            resp.raise_for_status()
            version = resp.json().get("data", {}).get("version", "unknown")
            return {"ok": True, "version": version, "error": None}
    except httpx.HTTPStatusError as e:
        return {
            "ok": False,
            "version": None,
            "error": f"HTTP {e.response.status_code}",
        }
    except httpx.ConnectError:
        return {"ok": False, "version": None, "error": "connection_failed"}
    except Exception as e:
        log.warning("test_connection probe failed for host=%s: %s", hostname, e)
        return {"ok": False, "version": None, "error": "connection_failed"}
