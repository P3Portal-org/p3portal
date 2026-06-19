# p3portal.org
"""PROJ-78: Proxmox Backup-Job-Verwaltung.

Manages datacenter-wide scheduled backup jobs via /cluster/backup.
State lives entirely in Proxmox (no local DB table).

Auth tiers:
  Read:  Viewer token  (_get_client_auth_for_node)
  Write: Admin token   (_get_portal_node_write_auth(..., role="admin"))

Error mapping for writes: _backup_write_http_exc (passes 403 through, maps 401→502).
This differs from the global _cluster_http_exc which silences 403 to avoid token-403 misidentification.
"""
from __future__ import annotations

import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from backend.core.deps import CurrentUser, require_admin_or
from backend.features.api_surface.deps import require_scope_for_upk
from backend.models.vms import BackupJobCreateRequest, BackupJobUpdateRequest, BackupRetention, BackupSchedule
from backend.services.audit_service import write_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/backup-jobs", tags=["backup-jobs"])

# PROJ-97: upk_-Scope-Gates (No-Op für JWT). GET → :read, Mutationen → :write.
_SCOPE_READ = Depends(require_scope_for_upk("backup_jobs:read"))
_SCOPE_WRITE = Depends(require_scope_for_upk("backup_jobs:write"))


# ── Error mapper ──────────────────────────────────────────────────────────────

def _backup_write_http_exc(exc: httpx.HTTPStatusError) -> HTTPException:
    """Map Proxmox write-path errors to appropriate FastAPI exceptions.

    Unlike the global _cluster_http_exc (which converts 403→502 to avoid frontend logout),
    here a real 403 means missing Proxmox privileges — the admin must know about it.
      403 → 403 (insufficient Proxmox privileges, AC-AUTH-3)
      401 → 502 (token invalid/deleted, stay logged in, AC-AUTH-2 complement)
      else → pass status code through
    """
    code = exc.response.status_code
    if code == 403:
        return HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Insufficient Proxmox privileges for backup job management "
                   "(Datastore.Allocate + VM.Backup + Sys.Modify required on /)",
        )
    if code == 401:
        return HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Proxmox auth error – admin service account token may be invalid or deleted",
        )
    return HTTPException(status_code=code, detail="Proxmox API error")


# ── Response schemas ──────────────────────────────────────────────────────────

class BackupJobsListResponse(BaseModel):
    jobs: list[BackupSchedule] = []
    permission_denied: bool = False
    node_unreachable: bool = False
    detail: str | None = None   # human-readable reason when something failed


class RunBackupNowResponse(BaseModel):
    tasks: list[dict] = []   # [{node: str, upid: str}, ...]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _str_or_none(value) -> str | None:
    """Coerce a raw Proxmox value to str (or None). Proxmox may return vmid/exclude
    as int or list depending on the PVE version — never let that 500 the parser."""
    if value is None or value == "":
        return None
    if isinstance(value, (list, tuple)):
        return ",".join(str(v) for v in value)
    return str(value)


def _int_or_none(value) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_backup_schedule(raw: dict) -> BackupSchedule:
    """Convert a raw Proxmox /cluster/backup entry to a BackupSchedule.

    Defensive against PVE-version differences: all text fields are coerced to str,
    selection fields to str/int, so a differently-typed value on a second node never
    raises a ValidationError (which would surface as an opaque HTTP 500)."""
    if not isinstance(raw, dict):
        raw = {}
    retention = BackupRetention.from_proxmox_param(raw.get("prune-backups"))
    return BackupSchedule(
        id=_str_or_none(raw.get("id")) or "",
        schedule=_str_or_none(raw.get("schedule")) or "",
        storage=_str_or_none(raw.get("storage")) or "",
        mode=_str_or_none(raw.get("mode")) or "snapshot",
        compress=_str_or_none(raw.get("compress")) or "",
        enabled=bool(_int_or_none(raw.get("enabled")) if raw.get("enabled") not in (None, "") else 1),
        comment=_str_or_none(raw.get("comment")) or "",
        vmid=_str_or_none(raw.get("vmid")),
        pool=_str_or_none(raw.get("pool")),
        all=_int_or_none(raw.get("all")),
        exclude=_str_or_none(raw.get("exclude")),
        mailto=_str_or_none(raw.get("mailto")),
        retention=retention,
    )


async def _resolve_read_auth(current_user: CurrentUser, node: str):
    """Viewer-level auth for reading /cluster/backup."""
    from backend.routers.cluster import _get_client_auth_for_node
    return await _get_client_auth_for_node(current_user, node)


async def _resolve_write_auth(current_user: CurrentUser, node: str):
    """Admin-level auth for writing /cluster/backup (PROJ-78 Entscheidung E)."""
    from backend.routers.cluster import _get_portal_node_write_auth
    return await _get_portal_node_write_auth(current_user, node, "admin")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=BackupJobsListResponse, dependencies=[_SCOPE_READ])
async def list_backup_jobs(
    node: str = Query(..., description="Proxmox node name for installation context"),
    current_user: CurrentUser = Depends(require_admin_or("manage_backup_jobs")),
) -> BackupJobsListResponse:
    """List all datacenter-wide scheduled backup jobs for a Proxmox installation.

    The node parameter is used to determine which Proxmox installation to query;
    the list is datacenter-wide (identical for all members of the same cluster).
    Returns permission_denied=True on Proxmox-403 (token lacks /cluster/backup read)
    and node_unreachable=True when the node cannot be contacted.
    """
    # 1) Resolve viewer auth for this installation. A 503 here means the node has
    #    no viewer token configured — that's NOT "unreachable", surface it as such.
    try:
        client, auth = await _resolve_read_auth(current_user, node)
    except HTTPException as exc:
        logger.warning("Backup-Jobs: Auth-Auflösung für Node '%s' fehlgeschlagen: %s", node, exc.detail)
        return BackupJobsListResponse(
            node_unreachable=True,
            detail=str(exc.detail) if exc.detail else None,
        )
    except Exception as exc:
        logger.warning("Backup-Jobs: Auth-Auflösung für Node '%s' fehlgeschlagen: %r", node, exc)
        return BackupJobsListResponse(node_unreachable=True, detail="Token-Auflösung fehlgeschlagen")

    # 2) Query /cluster/backup via the per-node viewer token.
    try:
        raw_jobs, perm_denied = await client.list_backup_jobs(auth)
        if perm_denied:
            return BackupJobsListResponse(permission_denied=True)
        jobs = [_parse_backup_schedule(j) for j in raw_jobs]
        return BackupJobsListResponse(jobs=jobs)
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        if code == 403:
            return BackupJobsListResponse(permission_denied=True)
        logger.warning("Backup-Jobs: Proxmox-API '%s' antwortete mit HTTP %s für Node '%s'", client._base, code, node)
        return BackupJobsListResponse(node_unreachable=True, detail=f"Proxmox antwortete mit HTTP {code}")
    except httpx.RequestError as exc:
        logger.warning("Backup-Jobs: Verbindung zu '%s' (Node '%s') fehlgeschlagen: %r", client._base, node, exc)
        return BackupJobsListResponse(node_unreachable=True, detail=f"Verbindung fehlgeschlagen: {type(exc).__name__}")
    except Exception as exc:
        # e.g. pydantic ValidationError on an unexpected PVE response shape — never 500.
        logger.warning("Backup-Jobs: Verarbeitung der Antwort von Node '%s' fehlgeschlagen: %r", node, exc, exc_info=True)
        return BackupJobsListResponse(
            node_unreachable=True,
            detail=f"Antwort nicht verarbeitbar: {type(exc).__name__}: {exc}",
        )


@router.get("/pools", response_model=list[dict], dependencies=[_SCOPE_READ])
async def list_pools(
    node: str = Query(..., description="Proxmox node for installation context"),
    current_user: CurrentUser = Depends(require_admin_or("manage_backup_jobs")),
) -> list[dict]:
    """Return all Proxmox pools for the Pool-Auswahl dropdown in the form."""
    try:
        client, auth = await _resolve_read_auth(current_user, node)
        return await client.get_pools(auth)
    except Exception:
        return []


@router.get("/storages", response_model=list[dict], dependencies=[_SCOPE_READ])
async def list_storages(
    node: str = Query(..., description="Proxmox node whose backup-capable storages to list"),
    current_user: CurrentUser = Depends(require_admin_or("manage_backup_jobs")),
) -> list[dict]:
    """Return all backup-capable storages on *node* for the Storage dropdown in the form.

    Auth chain (admin first): the admin token carries Datastore.Allocate/Audit, so it
    reliably lists storages. The viewer token often lacks Datastore.Audit and Proxmox
    then returns 200 + empty instead of 403 (same gotcha as ISO/LXC-template listing,
    S289/S540). We therefore prefer the admin token and fall back to viewer.
    """
    # 1) admin token (write auth) — has the broadest storage privileges
    try:
        client, auth = await _resolve_write_auth(current_user, node)
        result = await client.get_node_backup_storages(auth, node)
        if result:
            return result
    except Exception:
        pass

    # 2) viewer token fallback
    try:
        client, auth = await _resolve_read_auth(current_user, node)
        return await client.get_node_backup_storages(auth, node)
    except Exception:
        return []


@router.post("", status_code=status.HTTP_201_CREATED, response_model=dict, dependencies=[_SCOPE_WRITE])
async def create_backup_job(
    body: BackupJobCreateRequest,
    node: str = Query(...),
    current_user: CurrentUser = Depends(require_admin_or("manage_backup_jobs")),
) -> dict:
    """Create a new datacenter-wide Proxmox backup job (AC-CREATE-6)."""
    try:
        body.validate_selection()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    client, auth = await _resolve_write_auth(current_user, node)
    params = body.to_proxmox_params()
    try:
        result = await client.create_backup_job(auth, params)
        await write_audit_log(
            event_type="backup_job_created",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"node={node} storage={body.storage} schedule={body.schedule}",
        )
        return result or {}
    except httpx.HTTPStatusError as exc:
        raise _backup_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.put("/{job_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def update_backup_job(
    job_id: str,
    body: BackupJobUpdateRequest,
    node: str = Query(...),
    current_user: CurrentUser = Depends(require_admin_or("manage_backup_jobs")),
) -> None:
    """Fully replace a Proxmox backup job (handles both full edits and enabled-toggle, AC-TOGGLE-1)."""
    try:
        body.validate_selection()
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    client, auth = await _resolve_write_auth(current_user, node)
    params = body.to_proxmox_params()
    try:
        await client.update_backup_job(auth, job_id, params)
        await write_audit_log(
            event_type="backup_job_updated",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"job_id={job_id} node={node}",
        )
    except httpx.HTTPStatusError as exc:
        raise _backup_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[_SCOPE_WRITE])
async def delete_backup_job(
    job_id: str,
    node: str = Query(...),
    current_user: CurrentUser = Depends(require_admin_or("manage_backup_jobs")),
) -> None:
    """Delete a backup job schedule. Does NOT touch existing backup files (AC-DELETE-3)."""
    client, auth = await _resolve_write_auth(current_user, node)
    try:
        await client.delete_backup_job(auth, job_id)
        await write_audit_log(
            event_type="backup_job_deleted",
            username=current_user.username,
            auth_type=current_user.auth_type,
            detail=f"job_id={job_id} node={node}",
        )
    except httpx.HTTPStatusError as exc:
        raise _backup_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")


@router.post("/{job_id}/run", response_model=RunBackupNowResponse, dependencies=[_SCOPE_WRITE])
async def run_backup_now(
    job_id: str,
    node: str = Query(...),
    current_user: CurrentUser = Depends(require_admin_or("manage_backup_jobs")),
) -> RunBackupNowResponse:
    """Immediately execute a backup job across all relevant Proxmox nodes (AC-RUN-1..4).

    Fan-out strategy (Tech Design D):
    - VMID mode:             group VMIDs by their hosting member-node → one vzdump per node
    - all / pool / exclude:  send to every online member-node (Proxmox skips non-resident guests)

    Returns a list of {node, upid} for tracking in the Tasks tab.
    """
    # Resolve read auth for cluster resource map + write auth for vzdump calls
    read_client, read_auth = await _resolve_read_auth(current_user, node)
    write_client, write_auth = await _resolve_write_auth(current_user, node)

    # Fetch the job to know its scope
    try:
        raw_jobs, _ = await read_client.list_backup_jobs(read_auth)
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        if isinstance(exc, httpx.RequestError):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")
        raise _backup_write_http_exc(exc)

    job_raw = next((j for j in raw_jobs if j.get("id") == job_id), None)
    if job_raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Backup job '{job_id}' not found")

    job = _parse_backup_schedule(job_raw)

    # Shared vzdump params (everything except vmid/node targeting)
    base_params: dict = {
        "storage": job.storage,
        "mode": job.mode,
        "compress": job.compress or "zstd",
    }
    if job.mailto:
        base_params["mailto"] = job.mailto

    try:
        tasks = await _fan_out_run(write_client, write_auth, read_client, read_auth, job, base_params)
    except httpx.HTTPStatusError as exc:
        raise _backup_write_http_exc(exc)
    except httpx.RequestError:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Could not reach Proxmox API")

    await write_audit_log(
        event_type="backup_job_run_now",
        username=current_user.username,
        auth_type=current_user.auth_type,
        detail=f"job_id={job_id} node={node} tasks_started={len(tasks)}",
    )
    return RunBackupNowResponse(tasks=tasks)


async def _fan_out_run(
    write_client,
    write_auth,
    read_client,
    read_auth,
    job: BackupSchedule,
    base_params: dict,
) -> list[dict]:
    """Implement the fan-out run-now logic described in Tech Design D."""
    tasks: list[dict] = []

    if job.vmid:
        # VMID mode: group requested VMIDs by their hosting node
        vmids_requested = [v.strip() for v in job.vmid.split(",") if v.strip()]
        if not vmids_requested:
            return tasks

        try:
            vm_resources = await read_client.get_cluster_resources_v2(read_auth, "vm")
        except Exception:
            # Fallback: send all VMIDs to the queried node
            params = {**base_params, "vmid": job.vmid}
            from backend.services.nodes_service import get_node_for_proxmox_name, get_default_node
            node_row = await get_node_for_proxmox_name(job.vmid) or await get_default_node()
            target_node = node_row.name if node_row else job.vmid
            upid = await write_client.run_backup_now(write_auth, target_node, params)
            return [{"node": target_node, "upid": upid}]

        # Build vmid→node map
        vmid_to_node: dict[str, str] = {
            str(r.get("vmid", "")): r.get("node", "")
            for r in vm_resources
            if r.get("vmid") and r.get("node")
        }

        # Group by hosting node
        node_to_vmids: dict[str, list[str]] = {}
        for vmid_str in vmids_requested:
            hosting_node = vmid_to_node.get(vmid_str)
            if hosting_node:
                node_to_vmids.setdefault(hosting_node, []).append(vmid_str)

        async def _run_on_node(pve_node: str, vmid_list: list[str]) -> dict:
            params = {**base_params, "vmid": ",".join(vmid_list)}
            upid = await write_client.run_backup_now(write_auth, pve_node, params)
            return {"node": pve_node, "upid": upid}

        results = await asyncio.gather(
            *[_run_on_node(n, vids) for n, vids in node_to_vmids.items()],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, dict):
                tasks.append(r)
            else:
                logger.warning("run_backup_now fan-out error: %s", r)

    else:
        # all / pool / exclude mode: vzdump on every online member-node
        try:
            node_resources = await read_client.get_cluster_resources_v2(read_auth, "node")
        except Exception:
            node_resources = []

        online_nodes = [n["node"] for n in node_resources if n.get("status") == "online" and n.get("node")]

        if not online_nodes:
            # Single-node fallback: vzdump on the default node
            from backend.services.nodes_service import get_default_node
            default = await get_default_node()
            if default:
                online_nodes = [default.name]

        params = {**base_params}
        if job.all:
            params["all"] = 1
            if job.exclude:
                params["exclude"] = job.exclude
        elif job.pool:
            params["pool"] = job.pool

        async def _run_on_member(pve_node: str) -> dict:
            upid = await write_client.run_backup_now(write_auth, pve_node, params)
            return {"node": pve_node, "upid": upid}

        results = await asyncio.gather(
            *[_run_on_member(n) for n in online_nodes],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, dict):
                tasks.append(r)
            else:
                logger.warning("run_backup_now fan-out error on member: %s", r)

    return tasks
