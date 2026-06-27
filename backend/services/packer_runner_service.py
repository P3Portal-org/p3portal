# p3portal.org
from __future__ import annotations

import asyncio
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from backend.core.config import settings
from backend.db.database import get_db
from backend.services.config_service import get_config, get_config_sync

# Registry laufender Packer-Prozesse: job_id → subprocess.Popen
_running: dict[str, subprocess.Popen] = {}


def cancel_packer_job(job_id: str) -> bool:
    """Beendet einen laufenden Packer-Prozess. Gibt True zurück wenn er existierte."""
    proc = _running.pop(job_id, None)
    if proc is None:
        return False
    proc.terminate()
    return True


async def run_packer_job(
    job_id: str,
    template_id: str,
    params: dict,
    proxmox_credentials: dict | None = None,
    proxmox_node_name: str | None = None,
) -> None:
    """Background task: run a packer build and persist status + logs.

    proxmox_credentials: {"username": str, "realm": str, "password": str}
    When set (Proxmox-login user), the build runs in user-context mode.
    When None (Portal-login user), service-account token is used.
    """
    log_dir = Path(settings.data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job_id}.log"

    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status='running', started_at=:started_at, log_path=:log_path WHERE id=:id"),
            {"started_at": datetime.now(timezone.utc).isoformat(), "log_path": str(log_path), "id": job_id},
        )
        await session.commit()

    proxmox_host_override: str | None = None

    # Resolve targeted node for per-node token lookup (param overrides explicit arg)
    if proxmox_node_name is None and isinstance(params, dict):
        proxmox_node_name = params.get("proxmox_node") or params.get("node")

    if proxmox_credentials:
        # User-context mode: build runs as the logged-in Proxmox user
        token_id = ""
        token_secret = ""
        if proxmox_node_name:
            try:
                from backend.services.service_accounts import get_node_tokens
                _tok, host_url, _verify = await get_node_tokens(proxmox_node_name, "packer")
                proxmox_host_override = host_url
            except Exception:
                pass
    else:
        # Service-account mode: per-node packer token required, no global fallback.
        token_id = ""
        token_secret = ""
        if proxmox_node_name:
            try:
                from backend.services.service_accounts import get_node_tokens
                tok, host_url, _verify = await get_node_tokens(proxmox_node_name, "packer")
                proxmox_host_override = host_url
                if tok is not None:
                    token_id = tok.token_id
                    token_secret = tok.token_secret
            except Exception:
                pass

        if not token_id or not token_secret:
            async with get_db() as session:
                await session.execute(
                    text("UPDATE jobs SET status='failed', finished_at=:ts WHERE id=:id"),
                    {"ts": datetime.now(timezone.utc).isoformat(), "id": job_id},
                )
                await session.commit()
            log_path.write_text(
                f"[error] Kein Packer-Token für Node '{proxmox_node_name}' konfiguriert. "
                "Bitte Token unter Admin → Nodes hinterlegen.\n"
            )
            return

    success = False
    try:
        success = await _run_in_executor(
            job_id, template_id, params, log_path, token_id, token_secret,
            proxmox_credentials, proxmox_host_override,
        )
    except Exception as exc:
        log_path.write_text(f"[runner error] {exc}\n")

    _running.pop(job_id, None)
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

    # PROJ-44: Fire webhook if requested (callback_url set by caller)
    if callback_url:
        from backend.services.webhook_service import dispatch_webhook
        import asyncio
        asyncio.ensure_future(
            dispatch_webhook(
                callback_url=callback_url,
                job_id=job_id,
                status=job_status,
                playbook=template_id,
                node=proxmox_node_name,
                started_at=started_at_val,
                finished_at=finished_at,
            )
        )


async def _run_in_executor(
    job_id: str,
    template_id: str,
    params: dict,
    log_path: Path,
    token_id: str,
    token_secret: str,
    proxmox_credentials: dict | None = None,
    proxmox_host_override: str | None = None,
) -> bool:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _sync_run, job_id, template_id, params, log_path, token_id,
        token_secret, proxmox_credentials, proxmox_host_override,
    )


def _sync_run(
    job_id: str,
    template_id: str,
    params: dict,
    log_path: Path,
    token_id: str,
    token_secret: str,
    proxmox_credentials: dict | None = None,
    proxmox_host_override: str | None = None,
) -> bool:
    """Synchronous packer build – runs in a thread-pool worker."""
    import os

    from backend.services.packer_service import find_definition_file

    hcl_file = find_definition_file(template_id)
    if hcl_file is None:
        log_path.write_text(
            f"[error] No .pkr.hcl/.pkr.json definition file found for template '{template_id}'\n"
        )
        return False

    # Build command — never use shell=True; each arg is a separate list item
    cmd = ["packer", "build"]

    # Inject Proxmox URL (always needed) – per-node override wins over global setting
    proxmox_host = (proxmox_host_override or get_config_sync("proxmox_host") or settings.proxmox_host).rstrip("/")
    cmd += ["-var", f"proxmox_api_url={proxmox_host}/api2/json"]

    # Environment for the subprocess (inherit current env, then override)
    env = os.environ.copy()

    if proxmox_credentials:
        # User-context mode: username via -var (not sensitive), password via env var
        user = proxmox_credentials["username"]
        realm = proxmox_credentials["realm"]
        cmd += ["-var", f"proxmox_api_user={user}@{realm}"]
        # PKR_VAR_* is the Packer convention for env-var injection of variables
        env["PKR_VAR_proxmox_api_password"] = proxmox_credentials["password"]
    else:
        # Service-account mode: token_id ist nicht geheim (Cmdline ok); das Secret
        # geht per Env-Var (PKR_VAR_* → var.proxmox_api_token_secret in der HCL,
        # verhaltensgleich zu -var), damit es nicht auf der Kommandozeile landet
        # (/proc/<pid>/cmdline, PACKER_LOG). Analog zum Passwort-Pfad oben.
        cmd += ["-var", f"proxmox_api_token_id={token_id}"]
        env["PKR_VAR_proxmox_api_token_secret"] = token_secret

    # Wenn gesetzt: Portal-Host-IP für den Packer-HTTP-Server (preseed.cfg)
    # DB-Wert (portal_config) hat Vorrang vor Env-Variable
    packer_http_ip = get_config_sync("packer_http_ip") or settings.packer_http_ip
    if packer_http_ip:
        cmd += ["-var", f"packer_http_ip={packer_http_ip}"]

    # Append user-supplied parameters
    for key, value in params.items():
        cmd += ["-var", f"{key}={value}"]

    cmd.append(str(hcl_file))

    try:
        with log_path.open("a") as log_file:
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                cwd=str(hcl_file.parent),
                env=env,
                text=True,
            )
            _running[job_id] = process
            for line in process.stdout:
                log_file.write(line)
                log_file.flush()
            process.wait()
            _running.pop(job_id, None)
            return process.returncode == 0
    except FileNotFoundError:
        log_path.write_text("[error] packer binary not found — is Packer installed in the container?\n")
        return False
    except Exception as exc:
        with log_path.open("a") as log_file:
            log_file.write(f"[packer error] {exc}\n")
        return False
