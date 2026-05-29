# p3portal.org
"""PROJ-73: Node-Update-Service – Fan-out, APT-Refresh, Persistenz, Permission-Helper."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import text

from backend.db.database import get_db
from backend.features.node_updates.locks import get_refresh_lock
from backend.features.node_updates.schemas import (
    MemberUpdateState,
    NodeUpdateResponse,
    NodeUpdateSummaryEntry,
    NodeUpdateSummaryResponse,
    PackageUpdate,
)
from backend.features.node_updates.security_patterns import is_security_package
from backend.services.audit_service import write_audit_log
from backend.services.nodes_service import NodeRow, list_nodes
from backend.services.permissions_resolver import resolve_node_action
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient
from backend.services.service_accounts import _extract_token

logger = logging.getLogger(__name__)

_STALE_HOURS = 48


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_stale(last_success_at: str | None) -> bool:
    if not last_success_at:
        return True
    try:
        ts = datetime.fromisoformat(last_success_at)
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - ts) > timedelta(hours=_STALE_HOURS)
    except Exception:
        return True


def _all_members(node: NodeRow) -> list[str]:
    """Return all Proxmox node names that belong to this portal entry."""
    members: list[str] = []
    if node.proxmox_node:
        members.append(node.proxmox_node)
    for m in node.cluster_nodes:
        if m and m not in members:
            members.append(m)
    return members


def _make_auth(node: NodeRow, role: str) -> ProxmoxAuth | None:
    tok = _extract_token(node, role)
    if not tok:
        return None
    return ProxmoxAuth(kind="token", value=tok.token_id, secret=tok.token_secret)


async def _upsert_member(
    portal_node_id: int,
    proxmox_node_name: str,
    last_check_at: str,
    last_success_at: str | None,
    last_error: str | None,
    payload_json: str,
) -> None:
    """Insert or update one node_updates row.

    On conflict: always update last_check_at and last_error;
    update last_success_at and payload_json only when the new run succeeded.
    """
    async with get_db() as db:
        await db.execute(
            text("""
                INSERT INTO node_updates
                    (portal_node_id, proxmox_node_name,
                     last_check_at, last_success_at, last_error, payload_json)
                VALUES
                    (:pid, :pnn, :lca, :lsa, :le, :pj)
                ON CONFLICT(portal_node_id, proxmox_node_name) DO UPDATE SET
                    last_check_at   = excluded.last_check_at,
                    last_success_at = CASE
                        WHEN excluded.last_success_at IS NOT NULL
                        THEN excluded.last_success_at
                        ELSE node_updates.last_success_at
                    END,
                    last_error      = excluded.last_error,
                    payload_json    = CASE
                        WHEN excluded.last_success_at IS NOT NULL
                        THEN excluded.payload_json
                        ELSE node_updates.payload_json
                    END
            """),
            {
                "pid": portal_node_id,
                "pnn": proxmox_node_name,
                "lca": last_check_at,
                "lsa": last_success_at,
                "le": last_error,
                "pj": payload_json,
            },
        )
        await db.commit()


async def _fetch_member_row(portal_node_id: int, proxmox_node_name: str) -> dict | None:
    async with get_db() as db:
        result = await db.execute(
            text("""
                SELECT portal_node_id, proxmox_node_name,
                       last_check_at, last_success_at, last_error, payload_json
                  FROM node_updates
                 WHERE portal_node_id = :pid AND proxmox_node_name = :pnn
            """),
            {"pid": portal_node_id, "pnn": proxmox_node_name},
        )
        row = result.mappings().fetchone()
    return dict(row) if row else None


def _row_to_member_state(row: dict) -> MemberUpdateState:
    packages: list[PackageUpdate] = []
    try:
        raw = json.loads(row.get("payload_json") or "[]")
        for p in raw:
            packages.append(PackageUpdate(
                name=p.get("name", ""),
                version_old=p.get("version_old", ""),
                version_new=p.get("version_new", ""),
                is_security=bool(p.get("is_security", False)),
            ))
    except Exception:
        pass
    security_count = sum(1 for p in packages if p.is_security)
    return MemberUpdateState(
        portal_node_id=row["portal_node_id"],
        proxmox_node_name=row["proxmox_node_name"],
        last_check_at=row.get("last_check_at"),
        last_success_at=row.get("last_success_at"),
        last_error=row.get("last_error"),
        packages=packages,
        package_count=len(packages),
        security_count=security_count,
        is_stale=_is_stale(row.get("last_success_at")),
    )


def _empty_member_state(
    portal_node_id: int,
    proxmox_node_name: str,
    last_check_at: str | None,
    last_error: str | None,
) -> MemberUpdateState:
    return MemberUpdateState(
        portal_node_id=portal_node_id,
        proxmox_node_name=proxmox_node_name,
        last_check_at=last_check_at,
        last_success_at=None,
        last_error=last_error,
        packages=[],
        package_count=0,
        security_count=0,
        is_stale=True,
    )


async def refresh_member(
    node: NodeRow,
    proxmox_node_name: str,
    *,
    is_manual: bool = False,
    username: str | None = None,
) -> MemberUpdateState:
    """Refresh APT state for a single Proxmox member.

    Acquires per-member lock (non-blocking). Raises HTTPException 409 if lock is held.
    On Proxmox error: persists the error, preserves old payload_json.
    """
    lock = await get_refresh_lock(node.id, proxmox_node_name)

    # asyncio is single-threaded; no await between locked() check and acquire()
    # → the check+acquire pair is effectively atomic
    if lock.locked():
        raise HTTPException(status_code=409, detail="refresh_already_running")
    await lock.acquire()

    now = _now_iso()
    try:
        client = ProxmoxClient(base_url=node.url, verify_ssl=node.verify_ssl)

        # Proxmox requires Sys.Modify even for GET /apt/update → admin token needed
        read_auth = _make_auth(node, "admin") or _make_auth(node, "operator")

        if not read_auth:
            error_msg = "No admin/operator token configured (Sys.Modify required for apt list)"
            await _upsert_member(node.id, proxmox_node_name, now, None, error_msg, "[]")
            if is_manual and username:
                await write_audit_log(
                    "node_update_refresh_failed",
                    username=username,
                    detail=f"node={proxmox_node_name} error={error_msg} actor=user",
                )
            row = await _fetch_member_row(node.id, proxmox_node_name)
            return _row_to_member_state(row) if row else _empty_member_state(
                node.id, proxmox_node_name, now, error_msg
            )

        packages: list[PackageUpdate] = []
        error_msg: str | None = None
        success_at: str | None = None

        try:
            if is_manual and username:
                await write_audit_log(
                    "node_update_refresh_triggered",
                    username=username,
                    detail=f"node={proxmox_node_name} portal_node_id={node.id}",
                )

            raw_packages = await client.apt_get_updates(read_auth, proxmox_node_name)
            for pkg in raw_packages:
                name = pkg.get("Package", pkg.get("package", ""))
                packages.append(PackageUpdate(
                    name=name,
                    version_old=pkg.get("OldVersion", pkg.get("old_version", "")),
                    version_new=pkg.get("Version", pkg.get("version", "")),
                    is_security=is_security_package(name),
                ))
            success_at = now

        except Exception as exc:
            error_msg = str(exc)[:500]
            logger.warning(
                "APT refresh failed for %s / %s: %s", node.name, proxmox_node_name, exc
            )
            actor = "user" if is_manual else "system"
            audit_username = username or "system"
            await write_audit_log(
                "node_update_refresh_failed",
                username=audit_username,
                detail=f"node={proxmox_node_name} error={error_msg} actor={actor}",
            )

        payload = json.dumps([p.model_dump() for p in packages])
        await _upsert_member(
            node.id, proxmox_node_name, now, success_at, error_msg, payload
        )

        if is_manual and username and success_at:
            sec_count = sum(1 for p in packages if p.is_security)
            await write_audit_log(
                "node_update_refresh_succeeded",
                username=username,
                detail=(
                    f"node={proxmox_node_name} "
                    f"package_count={len(packages)} security_count={sec_count}"
                ),
            )

        row = await _fetch_member_row(node.id, proxmox_node_name)
        return _row_to_member_state(row) if row else _empty_member_state(
            node.id, proxmox_node_name, now, error_msg
        )

    finally:
        lock.release()


async def refresh_portal_node(
    portal_node_id: int,
    node: NodeRow,
    *,
    is_manual: bool = False,
    username: str | None = None,
) -> NodeUpdateResponse:
    """Fan-out refresh over all Proxmox members of a portal node entry.

    Members are processed serially; a 409 from any member propagates immediately.
    """
    members = _all_members(node)
    results: list[MemberUpdateState] = []
    for member_name in members:
        state = await refresh_member(
            node, member_name, is_manual=is_manual, username=username
        )
        results.append(state)
    return NodeUpdateResponse(
        portal_node_id=portal_node_id,
        portal_node_name=node.name,
        members=results,
    )


async def get_updates_for_portal_node(portal_node_id: int, node: NodeRow) -> NodeUpdateResponse:
    """Return persisted update state for all members of a portal node."""
    members = _all_members(node)
    results: list[MemberUpdateState] = []
    for member_name in members:
        row = await _fetch_member_row(portal_node_id, member_name)
        if row:
            results.append(_row_to_member_state(row))
        else:
            results.append(_empty_member_state(portal_node_id, member_name, None, None))
    return NodeUpdateResponse(
        portal_node_id=portal_node_id,
        portal_node_name=node.name,
        members=results,
    )


async def get_summary_for_user(current_user) -> NodeUpdateSummaryResponse:
    """Return flat list of all member states visible to the authenticated user."""
    nodes = await list_nodes()
    entries: list[NodeUpdateSummaryEntry] = []
    for node in nodes:
        if not await _can_view(current_user, node.id):
            continue
        for member_name in _all_members(node):
            row = await _fetch_member_row(node.id, member_name)
            if row:
                pkg_count = 0
                sec_count = 0
                try:
                    pkgs = json.loads(row.get("payload_json") or "[]")
                    pkg_count = len(pkgs)
                    sec_count = sum(1 for p in pkgs if p.get("is_security", False))
                except Exception:
                    pass
                entries.append(NodeUpdateSummaryEntry(
                    portal_node_id=node.id,
                    portal_node_name=node.name,
                    proxmox_node_name=member_name,
                    package_count=pkg_count,
                    security_count=sec_count,
                    last_success_at=row.get("last_success_at"),
                    last_check_at=row.get("last_check_at"),
                    last_error=row.get("last_error"),
                    is_stale=_is_stale(row.get("last_success_at")),
                ))
            else:
                entries.append(NodeUpdateSummaryEntry(
                    portal_node_id=node.id,
                    portal_node_name=node.name,
                    proxmox_node_name=member_name,
                    package_count=0,
                    security_count=0,
                    last_success_at=None,
                    last_check_at=None,
                    last_error=None,
                    is_stale=True,
                ))
    return NodeUpdateSummaryResponse(entries=entries)


async def _can_view(current_user, node_id: int) -> bool:
    if current_user.role == "admin":
        return True
    if current_user.user_id is None:
        return False
    return await resolve_node_action(current_user.user_id, node_id, "node:view_updates")


async def _can_refresh(current_user, node_id: int) -> bool:
    if current_user.role == "admin":
        return True
    if current_user.user_id is None:
        return False
    return await resolve_node_action(current_user.user_id, node_id, "node:refresh_updates")
