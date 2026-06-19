# p3portal.org
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import text

from backend.core.config import settings
from backend.db.database import get_db
from backend.services.config_service import get_config_sync


def _build_extravars(
    params: dict,
    user_role: str = "operator",
    proxmox_credentials: dict | None = None,
    *,
    proxmox_host_override: str | None = None,
    token_id_override: str | None = None,
    token_secret_override: str | None = None,
) -> dict:
    """Merge user params with portal-level vars injected by the backend.

    Proxmox-login users (proxmox_credentials set): inject api_user + api_password
    in user context – no service-account token is used.

    Local users (proxmox_credentials None): admin gets admin token, others get
    operator token.

    Per-node tokens override the global settings tokens via *_override args.
    """
    extra = dict(params)

    host = proxmox_host_override or get_config_sync("proxmox_host") or settings.proxmox_host
    parsed = urlparse(host)
    extra["proxmox_api_host"] = parsed.hostname or host
    extra["proxmox_api_base_url"] = host.rstrip("/")

    if proxmox_credentials:
        # User-context mode: authenticate as the logged-in Proxmox user
        username = proxmox_credentials["username"]
        realm = proxmox_credentials["realm"]
        extra["api_user"] = f"{username}@{realm}"
        extra["api_password"] = proxmox_credentials["password"]
        return extra

    # Service-account mode (Portal-login users) – token always resolved via nodes table
    token_id = token_id_override or ""
    token_secret = token_secret_override or ""

    if token_id:
        try:
            user_realm, token_name = token_id.rsplit("!", 1)
            user, realm = user_realm.rsplit("@", 1)
            extra["proxmox_portal_user"] = user
            extra["proxmox_portal_realm"] = realm
            extra["proxmox_portal_token_name"] = token_name
        except ValueError:
            pass

    if token_secret:
        extra["proxmox_portal_token_secret"] = token_secret

    return extra


async def _resolve_node_tokens(
    proxmox_node_name: str | None, user_role: str
) -> tuple[str | None, str | None, str | None]:
    """Look up role tokens from the nodes table.

    If proxmox_node_name is given: look up by node name (with cluster_nodes fallback).
    If not given: fall back to the default Portal node directly.

    Returns (host_override, token_id_override, token_secret_override):
    - (None, None, None): no node in DB at all
    - (host, "", ""):    node found but no token for this role
    - (host, tid, tsec): token resolved successfully
    """
    role_for_lookup = "admin" if user_role == "admin" else "operator"

    try:
        from backend.services.service_accounts import _extract_token, get_node_tokens
        from backend.services.nodes_service import get_default_node

        if proxmox_node_name:
            token, host_url, _verify = await get_node_tokens(proxmox_node_name, role_for_lookup)
        else:
            node = await get_default_node()
            if not node:
                return None, None, None
            token = _extract_token(node, role_for_lookup)
            host_url = node.url
    except Exception:
        return None, None, None

    if token is None:
        return host_url, "", ""
    return host_url, token.token_id, token.token_secret


async def run_ansible_job(
    job_id: str,
    playbook: str,
    params: dict,
    user_role: str = "operator",
    proxmox_credentials: dict | None = None,
    proxmox_node_name: str | None = None,
) -> None:
    """Background task: run an Ansible playbook and persist status + logs."""
    log_dir = Path(settings.data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job_id}.log"

    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status='running', started_at=:started_at, log_path=:log_path WHERE id=:id"),
            {"started_at": datetime.now(timezone.utc).isoformat(), "log_path": str(log_path), "id": job_id},
        )
        await session.commit()

    # Resolve per-node credentials when the playbook targets a specific node
    if proxmox_node_name is None:
        proxmox_node_name = params.get("proxmox_node") if isinstance(params, dict) else None

    host_override, tid_override, tsec_override = await _resolve_node_tokens(
        proxmox_node_name, user_role
    )

    # No valid token → fail early (covers "node found, no token" AND "no node at all")
    if not proxmox_credentials and not (tid_override and tsec_override):
        role_for_lookup = "admin" if user_role == "admin" else "operator"
        async with get_db() as session:
            await session.execute(
                text("UPDATE jobs SET status='failed', finished_at=:ts WHERE id=:id"),
                {"ts": datetime.now(timezone.utc).isoformat(), "id": job_id},
            )
            await session.commit()
        node_hint = f" für Node '{proxmox_node_name}'" if proxmox_node_name else ""
        log_path.write_text(
            f"[error] Kein {role_for_lookup}-Token{node_hint} konfiguriert. "
            "Bitte Token unter Admin → Nodes hinterlegen.\n"
        )
        return

    extravars = _build_extravars(
        params,
        user_role,
        proxmox_credentials,
        proxmox_host_override=host_override,
        token_id_override=tid_override,
        token_secret_override=tsec_override,
    )

    # PROJ-83: cloud-init Onboarding-Extravars beim Deploy injizieren (Opt-out-Haken).
    # Liefert die vendor-data (Service-User p3-ansible + Keys) an das Deploy-Playbook;
    # greift nur, wenn der Haken gesetzt war UND ein Verwaltungs-Key existiert. user-data
    # bleibt unangetastet (Proxmox generiert ciuser/sshkeys weiter selbst, AC-KEY-6).
    try:
        async with get_db() as _session:
            _jrow = (await _session.execute(
                text("SELECT ansible_manage, ansible_global_opt_in, auto_owner_user_id, "
                     "deploy_category, pool_id FROM jobs WHERE id = :id"),
                {"id": job_id},
            )).mappings().fetchone()
        if (_jrow and _jrow["ansible_manage"]
                and _jrow["deploy_category"] in ("vm_deployment", "lxc_deployment")):
            from backend.features.ansible_inventory.deploy_hook import (
                build_deploy_onboarding_extravars,
            )
            _ob = await build_deploy_onboarding_extravars(
                _jrow["auto_owner_user_id"], _jrow["pool_id"],
                bool(_jrow["ansible_global_opt_in"]),
            )
            for _k, _v in _ob.items():
                extravars.setdefault(_k, _v)
    except Exception as _exc:
        import logging
        logging.getLogger(__name__).warning("PROJ-83: onboarding extravars failed for job %s: %s", job_id, _exc)

    success = False
    try:
        success = await _run_in_executor(playbook, extravars, log_path)
    except Exception as exc:
        log_path.write_text(f"[runner error] {exc}\n")

    job_status = "success" if success else "failed"
    finished_at = datetime.now(timezone.utc).isoformat()
    started_at_val: str | None = None
    callback_url: str | None = None
    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status=:status, finished_at=:finished_at WHERE id=:id"),
            {"status": job_status, "finished_at": finished_at, "id": job_id},
        )
        await session.commit()
        result = await session.execute(
            text("SELECT started_at, callback_url FROM jobs WHERE id = :id"),
            {"id": job_id},
        )
        row = result.mappings().fetchone()
        if row:
            started_at_val = row["started_at"]
            callback_url = row["callback_url"]

    # PROJ-48: Owner-Auto-Assignment nach erfolgreichem Deploy
    if job_status == "success":
        try:
            from backend.features.owners.deploy_hook import on_deploy_success
            await on_deploy_success(job_id)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("PROJ-48: deploy_hook error for job %s: %s", job_id, exc)

    # PROJ-62: Pool-Auto-Member-Add nach erfolgreichem Deploy (Plus-Protocol-Hook)
    if job_status == "success":
        try:
            from backend.core.plus_protocol import plus_behavior as _pb
            await _pb.on_deploy_success_pool_hook(job_id)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("PROJ-62: pool deploy_hook error for job %s: %s", job_id, exc)

    # PROJ-83: Host-Zustand aufzeichnen (ssh_managed) nach erfolgreichem Deploy
    if job_status == "success":
        try:
            from backend.features.ansible_inventory.deploy_hook import on_deploy_success_ansible
            await on_deploy_success_ansible(job_id)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("PROJ-83: ansible deploy_hook error for job %s: %s", job_id, exc)

    # PROJ-44: Fire webhook if requested (callback_url set by caller)
    if callback_url:
        from backend.services.webhook_service import dispatch_webhook
        import asyncio
        asyncio.ensure_future(
            dispatch_webhook(
                callback_url=callback_url,
                job_id=job_id,
                status=job_status,
                playbook=playbook,
                node=proxmox_node_name,
                started_at=started_at_val,
                finished_at=finished_at,
            )
        )


async def _run_in_executor(playbook: str, params: dict, log_path: Path) -> bool:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_run, playbook, params, log_path)


def _sync_run(playbook: str, params: dict, log_path: Path) -> bool:
    """Synchronous ansible-runner call – runs in a thread-pool worker."""
    try:
        import ansible_runner  # type: ignore[import]
    except ImportError:
        log_path.write_text("[error] ansible-runner is not installed\n")
        return False

    import tempfile

    ansible_dir = Path(settings.ansible_dir)

    with log_path.open("a") as log_file:
        def _event_handler(event: dict) -> None:
            stdout = event.get("stdout", "")
            if stdout:
                log_file.write(stdout + "\n")
                log_file.flush()

        try:
            # Locate playbook file – may live in a subdirectory (e.g. vm-deployment/)
            playbook_file = f"{playbook}.yml"
            matches = list(ansible_dir.rglob(playbook_file))
            if not matches:
                log_file.write(f"[error] Playbook '{playbook_file}' nicht gefunden in {ansible_dir}\n")
                return False
            playbook_dir = matches[0].parent  # use the directory containing the playbook

            # private_data_dir must be writable (ansible-runner creates env/, artifacts/ there)
            # project_dir points to the actual playbooks (may be read-only)
            with tempfile.TemporaryDirectory(prefix="p3_ansible_") as work_dir:
                result = ansible_runner.run(
                    private_data_dir=work_dir,
                    project_dir=str(playbook_dir),
                    playbook=playbook_file,
                    extravars=params,
                    event_handler=_event_handler,
                    quiet=True,
                    rotate_artifacts=1,
                )
            return result.rc == 0
        except Exception as exc:
            log_file.write(f"[ansible error] {exc}\n")
            return False
