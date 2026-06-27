# p3portal.org
from __future__ import annotations

import asyncio
import re
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy import text

from backend.core.config import settings
from backend.db.database import get_db
from backend.services.config_service import get_config_sync, get_proxmox_verify_ssl

_ALLOWED_SCHEMES = {"http", "https"}
_FILENAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._\-]{0,127}$")
# Proxmox storage IDs: alnum + . - _ (verhindert Path-Injection in der Storage-URL)
_STORAGE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._\-]{0,63}$")

VALID_HASH_ALGOS = {"md5", "sha1", "sha224", "sha256", "sha384", "sha512"}


def _proxmox_base() -> str:
    return (get_config_sync("proxmox_host") or settings.proxmox_host).rstrip("/")


async def _packer_auth_headers() -> dict:
    """Return Authorization headers for Proxmox API calls using the packer token."""
    from backend.services.nodes_service import get_default_node
    from backend.services.service_accounts import _extract_token
    node = await get_default_node()
    tok = _extract_token(node, "packer") if node else None
    if not tok:
        raise RuntimeError(
            "Kein Packer-Token konfiguriert. Bitte Packer-Token unter Admin → Nodes hinterlegen."
        )
    return {"Authorization": f"PVEAPIToken={tok.token_id}={tok.token_secret}"}


async def _resolve_iso_auth(proxmox_node: str) -> tuple[dict, str, bool]:
    """Return (auth_headers, base_url, verify_ssl) for ISO read operations.

    Uses admin → packer → viewer fallback so ISO listing works even when the
    packer token is not configured or lacks Datastore.Audit.
    Resolves the correct portal-node by Proxmox node name (PROJ-26 chain).
    """
    from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name
    from backend.services.service_accounts import _extract_token

    node = await get_node_for_proxmox_name(proxmox_node)
    if not node:
        node = await get_default_node()
    if not node:
        raise RuntimeError("Keine Portal-Nodes konfiguriert.")

    tok = (
        _extract_token(node, "admin")
        or _extract_token(node, "packer")
        or _extract_token(node, "viewer")
    )
    if not tok:
        raise RuntimeError(
            "Kein Token konfiguriert. Bitte Admin- oder Packer-Token unter Admin → Nodes hinterlegen."
        )
    headers = {"Authorization": f"PVEAPIToken={tok.token_id}={tok.token_secret}"}
    return headers, node.url.rstrip("/"), node.verify_ssl


async def _resolve_iso_write_auth(proxmox_node: str) -> tuple[dict, str, bool]:
    """Return (auth_headers, base_url, verify_ssl) for ISO write operations.

    Write ops (download, delete, task poll) need Datastore.AllocateTemplate —
    that's exactly what the Packer token's role grants per proxmox-einrichtung.md.
    Try packer → admin (viewer is excluded; it never has the privilege).
    """
    from backend.services.nodes_service import get_default_node, get_node_for_proxmox_name
    from backend.services.service_accounts import _extract_token

    node = await get_node_for_proxmox_name(proxmox_node)
    if not node:
        node = await get_default_node()
    if not node:
        raise RuntimeError("Keine Portal-Nodes konfiguriert.")

    tok = _extract_token(node, "packer") or _extract_token(node, "admin")
    if not tok:
        raise RuntimeError(
            "Kein Packer- oder Admin-Token konfiguriert. ISO-Operationen brauchen "
            "Datastore.AllocateTemplate – bitte unter Admin → Nodes hinterlegen."
        )
    headers = {"Authorization": f"PVEAPIToken={tok.token_id}={tok.token_secret}"}
    return headers, node.url.rstrip("/"), node.verify_ssl


def _proxmox_client(verify_ssl: bool | None = None) -> httpx.AsyncClient:
    ssl = verify_ssl if verify_ssl is not None else get_proxmox_verify_ssl()
    return httpx.AsyncClient(verify=ssl, timeout=15.0)


def validate_url(url: str) -> str:
    """Validate that the URL uses http or https. Raises ValueError otherwise."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise ValueError(
            f"URL-Schema '{parsed.scheme}' nicht erlaubt. Nur http:// und https:// zulässig."
        )
    if not parsed.netloc:
        raise ValueError("Ungültige URL: kein Host angegeben.")
    return url


def validate_filename(filename: str) -> str:
    """Validate ISO filename (no path traversal). Raises ValueError otherwise."""
    if not _FILENAME_RE.match(filename):
        raise ValueError(
            f"Dateiname '{filename}' ist ungültig. "
            "Erlaubt: Buchstaben, Ziffern, '.', '-', '_' (max. 128 Zeichen, muss mit Buchstabe/Ziffer beginnen)."
        )
    return filename


# ── Proxmox API calls ──────────────────────────────────────────────────────────

async def get_nodes() -> list[dict]:
    """Return all Proxmox nodes as [{"name": ..., "status": ...}]."""
    async with _proxmox_client() as client:
        resp = await client.get(
            f"{_proxmox_base()}/api2/json/nodes",
            headers=await _packer_auth_headers(),
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
    return [
        {"name": n["node"], "status": n.get("status", "unknown")}
        for n in data
        if n.get("type") == "node"
    ]


async def get_isos(node: str) -> list[dict]:
    """Return ISO list for a node across ALL ISO-capable storages.

    Früher war dies auf den 'local'-Storage hartkodiert → ISOs auf anderen
    Storages waren unsichtbar. Jetzt werden alle Storages mit content=iso
    durchsucht; das volid kodiert den Storage bereits (z.B. 'pool:iso/x.iso'),
    daher funktionieren Löschen/Auswahl unverändert.
    """
    auth_headers, base_url, verify_ssl = await _resolve_iso_auth(node)
    async with _proxmox_client(verify_ssl) as client:
        sresp = await client.get(
            f"{base_url}/api2/json/nodes/{node}/storage",
            params={"content": "iso"},
            headers=auth_headers,
        )
        sresp.raise_for_status()
        storages = [
            s["storage"]
            for s in sresp.json().get("data", [])
            if s.get("enabled", 1)
        ]
        result = []
        for storage in storages:
            try:
                resp = await client.get(
                    f"{base_url}/api2/json/nodes/{node}/storage/{storage}/content",
                    params={"content": "iso"},
                    headers=auth_headers,
                )
                resp.raise_for_status()
                data = resp.json().get("data", [])
            except Exception:
                # best-effort: ein nicht lesbares Storage bricht die Liste nicht
                continue
            for item in data:
                volid = item.get("volid", "")
                filename = volid.split("/")[-1] if "/" in volid else volid
                result.append({
                    "filename": filename,
                    "volid": volid,
                    "size": item.get("size", 0),
                })
    return sorted(result, key=lambda x: x["filename"])


async def delete_iso(node: str, volid: str) -> None:
    """Delete an ISO from Proxmox node storage by its volid (e.g. 'local:iso/file.iso')."""
    if ":" not in volid:
        raise ValueError(f"Ungültiges volid-Format: {volid}")
    storage = volid.split(":")[0]
    encoded_volid = urllib.parse.quote(volid, safe="")
    auth_headers, base_url, verify_ssl = await _resolve_iso_write_auth(node)
    async with _proxmox_client(verify_ssl) as client:
        resp = await client.delete(
            f"{base_url}/api2/json/nodes/{node}/storage/{storage}/content/{encoded_volid}",
            headers=auth_headers,
        )
        resp.raise_for_status()


async def get_storages(node: str) -> list[dict]:
    """Return storage pools on a node that support VM images (for Packer disk placement)."""
    auth_headers, base_url, verify_ssl = await _resolve_iso_auth(node)
    async with _proxmox_client(verify_ssl) as client:
        resp = await client.get(
            f"{base_url}/api2/json/nodes/{node}/storage",
            params={"content": "images"},
            headers=auth_headers,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
    return [
        {"name": s["storage"], "type": s.get("type", "")}
        for s in data
        if s.get("enabled", 1)
    ]


async def get_iso_storages(node: str) -> list[dict]:
    """Return storage pools on a node that accept ISO uploads (content=iso)."""
    auth_headers, base_url, verify_ssl = await _resolve_iso_auth(node)
    async with _proxmox_client(verify_ssl) as client:
        resp = await client.get(
            f"{base_url}/api2/json/nodes/{node}/storage",
            params={"content": "iso"},
            headers=auth_headers,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
    return [
        {"name": s["storage"], "type": s.get("type", "")}
        for s in data
        if s.get("enabled", 1)
    ]


async def check_iso_exists(node: str, filename: str) -> bool:
    """Return True if the ISO already exists on the node's local storage."""
    isos = await get_isos(node)
    return any(iso["filename"] == filename for iso in isos)


async def query_url(url: str) -> dict:
    """
    Probe a URL via HEAD (fallback: GET) to extract filename, size, and MIME type.
    Returns {"filename": ..., "size": ..., "content_type": ...}.
    """
    validate_url(url)
    # Code-Review (Befund 6): SSRF-Schutz für die user-gelieferte ISO-URL. Ohne
    # diese Prüfung könnte ein Operator das Portal beliebige interne Adressen
    # proben lassen (Loopback, Cloud-IMDS 169.254.169.254 …). is_unsafe_setup_target
    # erlaubt RFC1918 (interne ISO-Mirror im LAN sind legitim), blockt aber
    # Loopback/Link-Local/IMDS/Multicast. Wirft ValueError → 400 beim Caller.
    from backend.core.http_client import validate_setup_target_url
    validate_setup_target_url(url)
    filename = None
    size = None
    content_type = None

    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
        try:
            resp = await client.head(url)
            resp.raise_for_status()
            headers = resp.headers
        except (httpx.HTTPStatusError, httpx.RequestError):
            # HEAD not supported by some servers – stream GET and cancel immediately
            async with client.stream("GET", url) as resp:
                headers = resp.headers

        cd = headers.get("content-disposition", "")
        if "filename=" in cd:
            for part in cd.split(";"):
                part = part.strip()
                if part.lower().startswith("filename="):
                    filename = part[9:].strip().strip("\"'")
                    break

        if not filename:
            path = urllib.parse.urlparse(url).path
            filename = path.split("/")[-1] or "file.iso"

        cl = headers.get("content-length")
        if cl and cl.isdigit():
            size = int(cl)

        content_type = headers.get("content-type")

    return {"filename": filename, "size": size, "content_type": content_type}


async def start_iso_download(
    node: str,
    filename: str,
    url: str,
    checksum_algorithm: str | None,
    checksum: str | None,
    verify_certificates: bool,
    storage: str = "local",
) -> str:
    """
    Trigger a Proxmox download-url task on the given storage.
    Returns the task UPID string.
    """
    if not _STORAGE_RE.match(storage):
        raise ValueError(f"Ungültiger Storage-Name: {storage}")
    body: dict = {
        "url": url,
        "filename": filename,
        "content": "iso",
        "verify-certificates": int(verify_certificates),
    }
    if checksum_algorithm and checksum_algorithm.lower() in VALID_HASH_ALGOS:
        body["checksum-algorithm"] = checksum_algorithm.lower()
        if checksum:
            body["checksum"] = checksum

    auth_headers, base_url, verify_ssl = await _resolve_iso_write_auth(node)
    async with _proxmox_client(verify_ssl) as client:
        resp = await client.post(
            f"{base_url}/api2/json/nodes/{node}/storage/{storage}/download-url",
            data=body,
            headers=auth_headers,
        )
        resp.raise_for_status()
        return resp.json().get("data", "")


async def poll_proxmox_task(node: str, upid: str) -> tuple[str, str]:
    """
    Poll Proxmox task status.
    Returns (status, exitstatus):
      status     – "running" | "stopped"
      exitstatus – "OK" on success, error string on failure, "" while running
    """
    encoded_upid = urllib.parse.quote(upid, safe="")
    auth_headers, base_url, verify_ssl = await _resolve_iso_write_auth(node)
    async with _proxmox_client(verify_ssl) as client:
        resp = await client.get(
            f"{base_url}/api2/json/nodes/{node}/tasks/{encoded_upid}/status",
            headers=auth_headers,
        )
        resp.raise_for_status()
        data = resp.json().get("data", {})
    return data.get("status", ""), data.get("exitstatus", "")


# ── Background job runner ──────────────────────────────────────────────────────

async def run_iso_download_job(job_id: str, node: str, upid: str) -> None:
    """Background task: poll the Proxmox download task and update job status + log."""
    log_dir = Path(settings.data_dir) / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / f"{job_id}.log"

    async with get_db() as session:
        await session.execute(
            text(
                "UPDATE jobs SET status='running', started_at=:t, log_path=:lp WHERE id=:id"
            ),
            {"t": datetime.now(timezone.utc).isoformat(), "lp": str(log_path), "id": job_id},
        )
        await session.commit()

    log_path.write_text(
        f"[iso-download] Node: {node}\n[iso-download] Proxmox Task: {upid}\n"
    )

    success = False
    try:
        while True:
            await asyncio.sleep(3)
            task_status, exit_status = await poll_proxmox_task(node, upid)
            with log_path.open("a") as f:
                f.write(f"[iso-download] status={task_status} exitstatus={exit_status}\n")
            if task_status == "stopped":
                success = exit_status == "OK"
                break
    except Exception as exc:
        with log_path.open("a") as f:
            f.write(f"[iso-download error] {exc}\n")

    final_status = "success" if success else "failed"
    async with get_db() as session:
        await session.execute(
            text("UPDATE jobs SET status=:s, finished_at=:t WHERE id=:id"),
            {"s": final_status, "t": datetime.now(timezone.utc).isoformat(), "id": job_id},
        )
        await session.commit()
