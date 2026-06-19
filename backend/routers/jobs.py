# p3portal.org
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError
from sqlalchemy import text

from backend.core.config import settings
from backend.core.deps import CurrentUser, get_current_user, require_operator
from backend.core.plus_protocol import plus_behavior
from backend.features.api_surface.deps import require_scope_for_upk
from backend.core.security import decode_access_token
from backend.services.audit_service import write_audit_log
from backend.db.database import get_db
from backend.models.jobs import JobCreate, JobResponse
from backend.services.ansible_runner_service import run_ansible_job
from backend.services.packer_runner_service import cancel_packer_job
from backend.services.playbook_service import get_sensitive_param_ids, validate_params
from backend.services.session_credential_store import get_credentials

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


def _row_to_job(row) -> JobResponse:
    return JobResponse(
        id=row["id"],
        type=row["type"],
        playbook=row["playbook"],
        status=row["status"],
        created_at=row["created_at"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
        username=row["username"],
        params=json.loads(row["params"]),
    )


@router.post("", response_model=JobResponse, status_code=201)
async def start_job(
    body: JobCreate,
    current_user: CurrentUser = Depends(require_operator),
    _scope: CurrentUser = Depends(require_scope_for_upk("jobs:write")),
) -> JobResponse:
    errors = validate_params(body.playbook, body.params)
    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=errors,
        )

    # PROJ-49: Playbook-Permission-Check
    if current_user.user_id is not None:
        try:
            from backend.services.permissions_resolver import can_user_execute_playbook
            from backend.services.audit_service import write_audit_log as _audit
            if not await can_user_execute_playbook(current_user.user_id, body.playbook):
                await _audit(
                    "playbook_permission_denied",
                    username=current_user.username,
                    auth_type=current_user.auth_type,
                    detail=json.dumps({
                        "playbook_name": body.playbook,
                        "actor": f"user:{current_user.user_id}",
                        "source": "ui",
                    }),
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="playbook_not_authorized",
                )
        except HTTPException:
            raise
        except Exception:
            pass  # Resolver-Fehler darf den Job nicht blockieren

    # PROJ-64: Approval-Check via Plus-Hook
    if current_user.user_id is not None:
        try:
            from fastapi.responses import JSONResponse as _JSONResponse
            decision = await plus_behavior.requires_approval(
                action_type="playbook_run",
                action_target=body.playbook if hasattr(body, "playbook") else "",
                payload=body.params if hasattr(body, "params") else {},
                user_id=current_user.user_id,
                username=current_user.username,
            )
            if decision is not None:
                return _JSONResponse(
                    status_code=202,
                    content={
                        "status": "pending_approval",
                        "approval_id": decision.approval_id,
                        "poll_url": decision.poll_url,
                    },
                )
        except Exception:
            pass

    # PROJ-48: Owner-Limit-Check + Deploy-Kategorie ermitteln
    # AC-CONFIG-4: Prüfreihenfolge: enabled → category → limit
    auto_owner_user_id = None
    deploy_category = None
    if body.auto_assign_owner:
        try:
            import json as _json
            from backend.services.playbook_service import get_playbook
            from backend.services.config_service import get_config

            meta = get_playbook(body.playbook)
            if meta is not None and meta.category:
                # Config-Check 1: owner_auto_assign_enabled (AC-CONFIG-1)
                enabled_raw = await get_config("owner_auto_assign_enabled")
                owner_feature_enabled = (enabled_raw is None) or (enabled_raw.lower() != "false")

                if owner_feature_enabled:
                    # Config-Check 2: owner_auto_assign_categories (AC-CONFIG-2)
                    cats_raw = await get_config("owner_auto_assign_categories")
                    if cats_raw:
                        try:
                            allowed_categories: list = _json.loads(cats_raw)
                        except (ValueError, TypeError):
                            allowed_categories = ["vm_deployment", "lxc_deployment"]
                    else:
                        allowed_categories = ["vm_deployment", "lxc_deployment"]

                    if meta.category in allowed_categories:
                        # Owner-Limit-Pre-Check
                        from backend.core.plus_protocol import plus_behavior
                        from backend.features.owners.service import count_active_ownerships
                        from backend.services.local_auth import get_user_by_username
                        actor = await get_user_by_username(current_user.username)
                        if actor is not None:
                            max_ownerships = plus_behavior.get_max_ownerships()
                            if max_ownerships is not None:
                                current_count = await count_active_ownerships(actor["id"])
                                if current_count >= max_ownerships:
                                    raise HTTPException(
                                        status_code=status.HTTP_412_PRECONDITION_FAILED,
                                        detail=(
                                            f"Owner-Limit erreicht ({current_count}/{max_ownerships}). "
                                            "Bestehende Eigentümerschaft aufgeben oder auf Plus upgraden, dann erneut deployen."
                                        ),
                                    )
                            auto_owner_user_id = actor["id"]
                            deploy_category = meta.category
        except HTTPException:
            raise
        except Exception:
            pass

    # PROJ-62: Pool-Quota-Check wenn pool_id angegeben
    if body.pool_id is not None:
        try:
            from backend.core.plus_protocol import plus_behavior as _pb
            from backend.services.local_auth import get_user_by_username as _get_user
            actor = await _get_user(current_user.username)
            actor_id = actor["id"] if actor else current_user.user_id
            quota = await _pb.check_pool_quota(actor_id, body.pool_id, body.params)
            if not quota.allowed:
                raise HTTPException(
                    status_code=status.HTTP_412_PRECONDITION_FAILED,
                    detail={
                        "error": "pool_quota_exceeded",
                        "pool_id": quota.pool_id,
                        "exceeded": quota.exceeded,
                        "current": quota.current,
                        "requested": quota.requested,
                        "limit": quota.limit,
                    },
                )
        except HTTPException:
            raise
        except Exception as _exc:
            import logging as _log
            _log.getLogger(__name__).error(
                "Pool-Quota-Check fehlgeschlagen (pool_id=%s): %s", body.pool_id, _exc
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Pool-Quota-Check temporär nicht verfügbar – bitte erneut versuchen",
            )

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Strip sensitive params (ssh_key type) before DB storage – AC10
    sensitive = get_sensitive_param_ids(body.playbook)
    stored_params = {k: v for k, v in body.params.items() if k not in sensitive}

    callback_url_str = str(body.callback_url) if body.callback_url else None
    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO jobs
                       (id, type, playbook, status, created_at, username, params,
                        auto_owner_user_id, deploy_category, callback_url, pool_id,
                        ansible_manage, ansible_global_opt_in)
                   VALUES (:id, 'ansible', :playbook, 'pending', :created_at, :username, :params,
                           :auto_owner_user_id, :deploy_category, :callback_url, :pool_id,
                           :ansible_manage, :ansible_global_opt_in)"""
            ),
            {
                "id": job_id,
                "playbook": body.playbook,
                "created_at": now,
                "username": current_user.username,
                "params": json.dumps(stored_params),
                "auto_owner_user_id": auto_owner_user_id,
                "deploy_category": deploy_category,
                "callback_url": callback_url_str,
                "pool_id": body.pool_id,
                "ansible_manage": 1 if body.manage_for_ansible else 0,
                "ansible_global_opt_in": 1 if body.global_opt_in else 0,
            },
        )
        await session.commit()
        result = await session.execute(
            text("SELECT * FROM jobs WHERE id = :id"), {"id": job_id}
        )
        row = result.mappings().fetchone()

    # PROJ-83: In-Guest-Playbook-Run (meta.targets == "guest") → eigener Runner-Zweig.
    # Bestehende localhost-Playbooks laufen unverändert über run_ansible_job (AC-INV-6).
    guest_dispatched = False
    try:
        from backend.services.playbook_service import get_playbook as _get_pb_meta
        _pb_meta = _get_pb_meta(body.playbook)
    except Exception:
        _pb_meta = None
    if _pb_meta is not None and getattr(_pb_meta, "targets", "localhost") == "guest":
        from backend.features.ansible_inventory.permissions import assert_guest_run_allowed
        from backend.features.ansible_inventory.runner import run_guest_ansible_job

        gs = body.guest_scope
        scope = gs.kind if gs is not None else "user"
        scope_ref = gs.ref if gs is not None else None
        await assert_guest_run_allowed(current_user, scope, scope_ref, body.target_hosts)

        # `become` lebt im PlaybookMeta (nicht im PlaybookDetail exponiert) → direkt laden
        try:
            from backend.services.playbook_service import _load_all_metas as _lm
            become_flag = next(
                (m.become for pid, m in _lm() if pid == body.playbook), False
            )
        except Exception:
            become_flag = False

        if current_user.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="guest_run_requires_local_user"
            )
        asyncio.create_task(
            run_guest_ansible_job(
                job_id, body.playbook, body.params,
                scope=scope, scope_ref=scope_ref, target_hosts=body.target_hosts,
                user_id=current_user.user_id, become=become_flag,
            )
        )
        guest_dispatched = True

    if not guest_dispatched:
        # Proxmox-login users run Ansible in their own user context (no service-account token needed)
        proxmox_credentials = (
            get_credentials(current_user.jti)
            if current_user.auth_type == "proxmox" and current_user.jti
            else None
        )
        asyncio.create_task(
            run_ansible_job(job_id, body.playbook, body.params, current_user.role, proxmox_credentials)
        )
    await write_audit_log(
        "job_started", current_user.username, current_user.auth_type,
        detail=f"Playbook '{body.playbook}' gestartet (Job {job_id[:8]})"
    )
    return _row_to_job(row)


@router.get("", response_model=list[JobResponse])
async def list_jobs(
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("jobs:read")),
) -> list[JobResponse]:
    async with get_db() as session:
        if current_user.role == "admin":
            result = await session.execute(
                text("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100")
            )
        else:
            result = await session.execute(
                text("SELECT * FROM jobs WHERE username = :username ORDER BY created_at DESC LIMIT 100"),
                {"username": current_user.username},
            )
        rows = result.mappings().fetchall()
    return [_row_to_job(r) for r in rows]


@router.get("/{job_id}", response_model=JobResponse)
async def get_job(
    job_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    _scope: CurrentUser = Depends(require_scope_for_upk("jobs:read")),
) -> JobResponse:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT * FROM jobs WHERE id = :id"), {"id": job_id}
        )
        row = result.mappings().fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if current_user.role != "admin" and row["username"] != current_user.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    return _row_to_job(row)


@router.post("/{job_id}/cancel", status_code=200)
async def cancel_job(
    job_id: str,
    current_user: CurrentUser = Depends(require_operator),
    _scope: CurrentUser = Depends(require_scope_for_upk("jobs:write")),
) -> dict:
    async with get_db() as session:
        result = await session.execute(
            text("SELECT status, username, type, params FROM jobs WHERE id = :id"), {"id": job_id}
        )
        row = result.mappings().fetchone()

    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if current_user.role != "admin" and row["username"] != current_user.username:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found")
    if row["status"] not in ("pending", "running"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Job is not running")

    cancel_packer_job(job_id)

    # PROJ-76 Phase 2b: stack apply/destroy → SIGINT the tofu subprocess (graceful).
    if row["type"] in ("stack_apply", "stack_destroy"):
        try:
            from backend.core.plus_protocol import plus_behavior
            params = json.loads(row["params"] or "{}")
            stack_id = params.get("stack_id")
            if stack_id is not None:
                plus_behavior.cancel_stack_job(int(stack_id))
        except Exception:
            pass

    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status='failed', finished_at=:finished_at WHERE id=:id"),
            {"finished_at": datetime.now(timezone.utc).isoformat(), "id": job_id},
        )
        await session.commit()

    await write_audit_log(
        "job_cancelled", current_user.username, current_user.auth_type,
        detail=f"Job {job_id[:8]} abgebrochen"
    )
    return {"detail": "Job cancelled"}


@router.websocket("/{job_id}/logs/ws")
async def job_logs_ws(
    job_id: str,
    websocket: WebSocket,
    token: str = Query(...),
) -> None:
    # Auth via query param – Browser WebSocket API doesn't support custom headers
    try:
        payload = decode_access_token(token)
        sub = payload.get("sub")
        if not sub:
            await websocket.close(code=4001)
            return
        ws_role = payload.get("role", "operator")
    except JWTError:
        await websocket.close(code=4001)
        return

    await websocket.accept()

    async with get_db() as session:
        result = await session.execute(
            text("SELECT id, username FROM jobs WHERE id = :id"), {"id": job_id}
        )
        row = result.mappings().fetchone()

    if row is None:
        await websocket.send_text("[error] Job not found")
        await websocket.close()
        return

    if ws_role != "admin" and row["username"] != sub:
        await websocket.send_text("[error] Access denied")
        await websocket.close()
        return

    log_path = Path(settings.data_dir) / "logs" / f"{job_id}.log"

    try:
        position = 0
        while True:
            async with get_db() as session:
                result = await session.execute(
                    text("SELECT status FROM jobs WHERE id = :id"), {"id": job_id}
                )
                status_row = result.mappings().fetchone()

            current_status = status_row["status"] if status_row else "failed"

            if log_path.exists():
                with log_path.open("r") as f:
                    f.seek(position)
                    chunk = f.read()
                if chunk:
                    position += len(chunk.encode())
                    for line in chunk.splitlines():
                        await websocket.send_text(line)

            if current_status in ("success", "failed"):
                break

            await asyncio.sleep(0.5)

        await websocket.send_text(f"[status] {current_status}")
    except WebSocketDisconnect:
        pass
    finally:
        await websocket.close()
