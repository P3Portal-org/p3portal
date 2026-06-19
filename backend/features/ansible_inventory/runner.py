# p3portal.org
"""PROJ-83: In-Guest-Playbook-Runner (Core) – eigener Zweig, TOFU.

Getrennt vom localhost-`_sync_run` (ansible_runner_service): dieser Pfad baut ein
dynamisches Inventory, eine tmp-Private-Key-Datei (0600) und eine tmp-`known_hosts`
für TOFU (`StrictHostKeyChecking=accept-new`).

TOFU-mit-Korrektur:
  - Host MIT gemerktem Key + Mismatch  → ssh lehnt ab → Run scheitert, klare Meldung.
  - Host OHNE gemerkten Key            → akzeptiert, Key geerntet + persistiert.
Korrektur via Reset-EP (host_key → NULL → Re-TOFU).

Sicherheit: Private Key nur als tmp-Datei 0600, im finally gelöscht; TF/SSH-Keys nie
in Logs; inventory als Dict (kein Shell-String).
"""
from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import text

from backend.core.config import settings
from backend.db.database import get_db
from backend.features.ansible_inventory import host_state, inventory as _inv

logger = logging.getLogger(__name__)

_MISMATCH_MARKERS = (
    "REMOTE HOST IDENTIFICATION HAS CHANGED",
    "HOST IDENTIFICATION HAS CHANGED",
    "Host key verification failed",
)

_ERROR_MESSAGES = {
    _inv.ERR_NO_KEY: (
        "Kein SSH-Verwaltungs-Key für diesen Scope vorhanden. "
        "Bitte im Profil einen SSH-Job-Key anlegen (User-Scope) bzw. Pool-/Global-Key einrichten."
    ),
    _inv.ERR_EMPTY_SCOPE: (
        "Im gewählten Scope befinden sich keine Hosts."
    ),
    _inv.ERR_NO_TARGETS: (
        "Kein verwalteter (managed) Host im Ziel-Set. Hosts müssen mit injiziertem "
        "Verwaltungs-Key (ssh_managed) und ermittelbarer IP vorliegen, um ausführbar zu sein."
    ),
}


async def run_guest_ansible_job(
    job_id: str,
    playbook: str,
    params: dict,
    *,
    scope: str,
    scope_ref: int | None,
    target_hosts: list[str] | None,
    user_id: int,
    become: bool = False,
) -> None:
    """Background-Task: führt ein Gast-Playbook über das dynamische Inventory aus."""
    log_dir = Path(settings.data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job_id}.log"

    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status='running', started_at=:s, log_path=:lp WHERE id=:id"),
            {"s": datetime.now(timezone.utc).isoformat(), "lp": str(log_path), "id": job_id},
        )
        await session.commit()

    # 1. Inventory generieren
    result = await _inv.build_inventory(scope, scope_ref, user_id, target_hosts)
    if result.error:
        msg = _ERROR_MESSAGES.get(result.error, f"Inventory-Fehler: {result.error}")
        log_path.write_text(f"[error] {msg}\n")
        await _finish(job_id, "failed", playbook)
        return

    # 2. Synchron (Thread-Pool): tmp-Key + known_hosts + ansible-runner
    loop = asyncio.get_event_loop()
    rc, learned, mismatch = await loop.run_in_executor(
        None, _sync_run_guest, playbook, params, result, become, log_path
    )

    # 3. Geerntete Host-Keys persistieren (TOFU-Ernte beim Erstkontakt)
    if learned:
        ip_to_target = {t["ansible_host"]: t for t in result.targets if t.get("ansible_host")}
        for ip, hk in learned.items():
            tgt = ip_to_target.get(ip)
            if tgt is None:
                continue
            try:
                await host_state.persist_host_key(
                    tgt["portal_node_id"], tgt["vmid"], tgt["kind"], hk
                )
            except Exception as exc:
                logger.warning("PROJ-83: persist host key failed for %s: %s", ip, exc)

    status_str = "success" if rc == 0 else "failed"
    await _finish(job_id, status_str, playbook)


async def _finish(job_id: str, status_str: str, playbook: str) -> None:
    finished = datetime.now(timezone.utc).isoformat()
    callback_url = None
    started_at = None
    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status=:st, finished_at=:f WHERE id=:id"),
            {"st": status_str, "f": finished, "id": job_id},
        )
        await session.commit()
        row = (await session.execute(
            text("SELECT started_at, callback_url FROM jobs WHERE id=:id"), {"id": job_id}
        )).mappings().fetchone()
        if row:
            started_at = row["started_at"]
            callback_url = row["callback_url"]
    if callback_url:
        try:
            from backend.services.webhook_service import dispatch_webhook
            asyncio.ensure_future(dispatch_webhook(
                callback_url=callback_url, job_id=job_id, status=status_str,
                playbook=playbook, node=None, started_at=started_at, finished_at=finished,
            ))
        except Exception:
            pass


# ── PROJ-84: leichtgewichtige Verbindungsprobe (informativ, kein Run) ─────────

async def test_guest_connection(
    ip: str | None, ansible_user: str, private_key: str | None, known_host: str | None = None
) -> tuple[bool, str]:
    """Versucht eine einzelne SSH-Verbindung als `ansible_user` gegen `ip`.

    Gibt (ok, reason) zurück; reason ist ein generischer Code (kein stderr-Leak):
    ok | no_ip | no_key | auth_failed | host_key_changed | timeout | unreachable | error.
    Setzt/ändert KEINEN Zustand (rein informativ). TOFU (accept-new), tmp-Key 0600, finally-Cleanup.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, _sync_test_connection, ip, ansible_user, private_key, known_host
    )


def _sync_test_connection(
    ip: str | None, ansible_user: str, private_key: str | None, known_host: str | None
) -> tuple[bool, str]:
    import subprocess

    if not ip:
        return False, "no_ip"
    if not private_key:
        return False, "no_key"

    key_fd, key_path = tempfile.mkstemp(prefix="p3_testkey_", suffix=".key")
    kh_fd, kh_path = tempfile.mkstemp(prefix="p3_testkh_", suffix="")
    try:
        os.write(key_fd, private_key.encode())
        os.close(key_fd)
        key_fd = -1
        os.chmod(key_path, 0o600)

        with os.fdopen(kh_fd, "w") as khf:
            if known_host:
                for line in str(known_host).splitlines():
                    line = line.strip()
                    if line:
                        khf.write(f"{ip} {line}\n")
        kh_fd = -1

        cmd = [
            "ssh", "-i", key_path,
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={kh_path}",
            "-o", "HashKnownHosts=no",
            "-o", "ConnectTimeout=10",
            f"{ansible_user}@{ip}", "true",
        ]
        proc = subprocess.run(cmd, capture_output=True, timeout=20, text=True)
        if proc.returncode == 0:
            return True, "ok"
        err = (proc.stderr or "").lower()
        if "permission denied" in err:
            return False, "auth_failed"
        if "host key verification failed" in err or "host identification has changed" in err:
            return False, "host_key_changed"
        if "timed out" in err or "timeout" in err:
            return False, "timeout"
        return False, "unreachable"
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except Exception:
        return False, "error"
    finally:
        for fd in (key_fd, kh_fd):
            if fd >= 0:
                try:
                    os.close(fd)
                except Exception:
                    pass
        for p in (key_path, kh_path):
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass


def _sync_run_guest(
    playbook: str, params: dict, result, become: bool, log_path: Path
) -> tuple[int, dict, bool]:
    """Synchroner Teil: tmp-Dateien + ansible-runner. Gibt (rc, learned_keys, mismatch) zurück."""
    try:
        import ansible_runner  # type: ignore[import]
    except ImportError:
        log_path.write_text("[error] ansible-runner is not installed\n")
        return 1, {}, False

    ansible_dir = Path(settings.ansible_dir)
    key_fd, key_path = tempfile.mkstemp(prefix="p3_guestkey_", suffix=".key")
    kh_fd, kh_path = tempfile.mkstemp(prefix="p3_knownhosts_", suffix="")
    learned: dict[str, str] = {}
    mismatch = False
    try:
        # Private Key 0600
        os.write(key_fd, (result.private_key or "").encode())
        os.close(key_fd)
        key_fd = -1
        os.chmod(key_path, 0o600)

        # known_hosts vorbefüllen (gemerkte Keys); pre_ips für die TOFU-Ernte merken
        pre_ips: set[str] = set()
        with os.fdopen(kh_fd, "w") as khf:
            for ip, hk in (result.host_keys or {}).items():
                for line in str(hk).splitlines():
                    line = line.strip()
                    if line:
                        khf.write(f"{ip} {line}\n")
                        pre_ips.add(ip)
        kh_fd = -1

        common_args = (
            f"-o UserKnownHostsFile={kh_path} "
            "-o StrictHostKeyChecking=accept-new "
            "-o HashKnownHosts=no "
            "-o BatchMode=yes "
            "-o ConnectTimeout=15"
        )
        inv = dict(result.inventory_dict)
        grp = inv.setdefault("managed", {})
        grp.setdefault("vars", {})
        grp["vars"]["ansible_ssh_private_key_file"] = key_path
        grp["vars"]["ansible_ssh_common_args"] = common_args

        with log_path.open("a") as log_file:
            def _event_handler(event: dict) -> None:
                nonlocal mismatch
                stdout = event.get("stdout", "")
                if stdout:
                    log_file.write(stdout + "\n")
                    log_file.flush()
                    if any(m in stdout for m in _MISMATCH_MARKERS):
                        mismatch = True

            playbook_file = f"{playbook}.yml"
            matches = list(ansible_dir.rglob(playbook_file))
            if not matches:
                log_file.write(f"[error] Playbook '{playbook_file}' nicht gefunden in {ansible_dir}\n")
                return 1, {}, False
            playbook_dir = matches[0].parent

            cmdline = "--become" if become else None
            with tempfile.TemporaryDirectory(prefix="p3_guest_") as work_dir:
                run = ansible_runner.run(
                    private_data_dir=work_dir,
                    project_dir=str(playbook_dir),
                    playbook=playbook_file,
                    inventory=inv,
                    extravars=params,
                    envvars={"ANSIBLE_HOST_KEY_CHECKING": "True"},
                    cmdline=cmdline,
                    event_handler=_event_handler,
                    quiet=True,
                    rotate_artifacts=1,
                )
            rc = run.rc

        # TOFU-Ernte: neue known_hosts-Einträge auslesen
        try:
            with open(kh_path) as khf:
                for raw in khf:
                    raw = raw.strip()
                    if not raw or raw.startswith("#"):
                        continue
                    parts = raw.split(" ", 1)
                    if len(parts) != 2:
                        continue
                    host_field, key_material = parts
                    ip = host_field.split(",")[0]
                    if ip in pre_ips:
                        continue
                    learned.setdefault(ip, "")
                    learned[ip] = (learned[ip] + "\n" + key_material).strip() if learned[ip] else key_material
        except Exception:
            pass

        if mismatch:
            with log_path.open("a") as log_file:
                log_file.write(
                    "\n[error] Host-Key-Mismatch: der Host-Key eines Ziels hat sich geaendert "
                    "(z.B. neu gebaute VM mit gleicher IP). Der Run wurde abgebrochen. "
                    "Aktion 'Host-Key zuruecksetzen' im Inventory loest das.\n"
                )
            return 1, learned, True

        return rc, learned, False
    except Exception as exc:
        try:
            with log_path.open("a") as log_file:
                log_file.write(f"[runner error] {exc}\n")
        except Exception:
            pass
        return 1, learned, mismatch
    finally:
        for fd in (key_fd, kh_fd):
            if fd >= 0:
                try:
                    os.close(fd)
                except Exception:
                    pass
        for p in (key_path, kh_path):
            try:
                Path(p).unlink(missing_ok=True)
            except Exception:
                pass
