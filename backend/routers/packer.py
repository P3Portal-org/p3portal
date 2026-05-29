# p3portal.org
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy import text

from pathlib import Path

from backend.core.config import settings
from backend.core.deps import CurrentUser, get_current_user, require_admin, require_operator, require_not_restricted
from backend.features.api_surface.deps import require_scope_for_upk
from backend.services.settings_service import get_setting
from backend.services.config_service import get_config_sync, get_proxmox_node, get_proxmox_verify_ssl
from backend.core.plus_protocol import plus_behavior
from backend.db.database import get_db
from backend.models.iso import (
    IsoDownloadRequest,
    IsoEntry,
    NodeInfo,
    QueryUrlRequest,
    QueryUrlResponse,
    StorageInfo,
)
from backend.models.jobs import JobResponse
from backend.models.packer import PackerBuildRequest, PackerDetail, PackerSummary, ProxmoxTemplateInfo
from backend.services.iso_service import (
    check_iso_exists,
    delete_iso,
    get_isos,
    get_nodes,
    get_storages,
    query_url,
    run_iso_download_job,
    start_iso_download,
    validate_filename,
    validate_url,
)
from backend.services.proxmox import ProxmoxAuth, ProxmoxClient, proxmox_client
from backend.services.packer_runner_service import run_packer_job
from backend.services.service_accounts import get_node_tokens, _extract_token
from backend.services.nodes_service import get_default_node, list_nodes
from backend.services.session_credential_store import get_credentials
from backend.services.packer_service import (
    delete_packer_template,
    get_packer_template,
    get_sensitive_packer_param_ids,
    list_packer_templates,
    save_template_zip,
    validate_params,
)

router = APIRouter(prefix="/api/packer", tags=["packer"])


async def _resolve_packer_token(node_name: str | None) -> tuple[str, str, str, bool]:
    """Resolve (token_id, token_secret, host_url, verify_ssl) for a node.

    Only per-node packer tokens are used – no global fallback.
    Returns empty strings for token_id/secret when no token is configured.
    """
    target_node = node_name or get_proxmox_node()
    tid = ""
    tsec = ""
    host_url = get_config_sync("proxmox_host") or settings.proxmox_host
    verify_ssl = get_proxmox_verify_ssl()
    if target_node:
        try:
            tok, host_url, verify_ssl = await get_node_tokens(target_node, "packer")
            if tok is not None:
                tid = tok.token_id
                tsec = tok.token_secret
        except Exception:
            pass
    return tid, tsec, host_url, verify_ssl


async def _require_packer_token_for_node(node_name: str | None) -> tuple[str, str, str, bool]:
    tid, tsec, host_url, verify_ssl = await _resolve_packer_token(node_name)
    if not tid or not tsec:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Packer-Credentials nicht konfiguriert (PACKER_TOKEN_ID / PACKER_TOKEN_SECRET fehlen)",
        )
    return tid, tsec, host_url, verify_ssl


async def _require_iso_upload_permission(current_user: CurrentUser, proxmox_node: str) -> None:
    """PROJ-49 AC-ISO-1/2/3: operator ODER node:upload_iso auf dem Ziel-Node.

    Additiver Check – niemand verliert bestehende Rechte.
    Bei weder operator noch upload_iso → HTTP 403 mit Audit-Event.
    """
    if current_user.auth_type == "proxmox" or current_user.role in ("admin", "operator"):
        return  # klassischer Operator-Pfad

    # PROJ-47 Node-Scope-Check
    if current_user.user_id is not None:
        try:
            from backend.services.nodes_service import get_node_for_proxmox_name
            from backend.services.permissions_resolver import resolve_node_action
            portal_node = await get_node_for_proxmox_name(proxmox_node)
            if portal_node is not None:
                if await resolve_node_action(current_user.user_id, portal_node["id"], "node:upload_iso"):
                    return
        except Exception:
            pass

    from backend.services.audit_service import write_audit_log
    import json as _json
    await write_audit_log(
        "playbook_permission_denied",
        username=current_user.username,
        auth_type=current_user.auth_type,
        detail=_json.dumps({
            "playbook_name": f"iso_upload@{proxmox_node}",
            "actor": f"user:{current_user.user_id}",
            "source": "iso_upload",
            "reason": "iso_action_missing",
        }),
    )
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="iso_upload_not_authorized",
    )


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


# ── ISO-Verwaltung (PROJ-13) ──────────────────────────────────────────────────

@router.get("/nodes", response_model=list[NodeInfo])
async def get_proxmox_nodes(
    current_user: CurrentUser = Depends(require_operator),
) -> list[NodeInfo]:
    if not plus_behavior.can_use_cluster_resources():
        return [NodeInfo(name=get_proxmox_node(), status="online")]

    # Proxmox-login users: single cluster via session cookie – no fan-out needed
    if current_user.auth_type == "proxmox":
        auth, client = await _get_viewer_auth_for_packer(current_user)
        try:
            resources = await client.get_cluster_resources_v2(auth, "node")
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")
        return [
            NodeInfo(name=r["node"], status=r.get("status", "unknown"))
            for r in resources if r.get("type") == "node"
        ]

    # Local users: fan-out to all portal nodes (PROJ-30)
    all_portal_nodes = await list_nodes()
    if not all_portal_nodes:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="No Proxmox nodes configured")
    portal_clients = [
        (ProxmoxClient(base_url=n.url, verify_ssl=n.verify_ssl),
         ProxmoxAuth(kind="token", value=t.token_id, secret=t.token_secret))
        for n in all_portal_nodes
        if (t := _extract_token(n, "viewer")) is not None
    ]
    if not portal_clients:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Viewer service account not configured – contact your administrator",
        )
    results = await asyncio.gather(
        *[c.get_cluster_resources_v2(a, "node") for c, a in portal_clients],
        return_exceptions=True,
    )
    nodes: list[NodeInfo] = []
    for res in results:
        if isinstance(res, Exception):
            continue
        nodes.extend(
            NodeInfo(name=r["node"], status=r.get("status", "unknown"))
            for r in res if r.get("type") == "node"
        )
    if not nodes:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Proxmox API Fehler: Keine Node erreichbar")
    return nodes


@router.get("/storages", response_model=list[StorageInfo])
async def get_proxmox_storages(
    node: str | None = Query(default=None, description="Proxmox Node-Name (default: PROXMOX_NODE)"),
    _: CurrentUser = Depends(require_operator),
) -> list[StorageInfo]:
    resolved_node = node or get_proxmox_node()
    await _require_packer_token_for_node(resolved_node)
    try:
        storages = await get_storages(resolved_node)
        return [StorageInfo(**s) for s in storages]
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")


@router.get("/isos", response_model=list[IsoEntry])
async def get_proxmox_isos(
    node: str | None = Query(default=None, description="Proxmox Node-Name (default: PROXMOX_NODE)"),
    _: CurrentUser = Depends(require_operator),
) -> list[IsoEntry]:
    resolved_node = node or get_proxmox_node()
    await _require_packer_token_for_node(resolved_node)
    try:
        isos = await get_isos(resolved_node)
        return [IsoEntry(**i) for i in isos]
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")


@router.delete("/isos", status_code=204)
async def delete_proxmox_iso(
    node: str | None = Query(default=None, description="Proxmox Node-Name (default: PROXMOX_NODE)"),
    volid: str = Query(..., description="Volume-ID (z.B. local:iso/file.iso)"),
    current_user: CurrentUser = Depends(get_current_user),
) -> Response:
    resolved_node = node or get_proxmox_node()
    # PROJ-49: operator OR node:upload_iso (additiv, AC-ISO-2/3)
    await _require_iso_upload_permission(current_user, resolved_node)
    await _require_packer_token_for_node(resolved_node)
    try:
        await delete_iso(resolved_node, volid)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")
    return Response(status_code=204)


@router.post("/isos/query-url", response_model=QueryUrlResponse)
async def query_iso_url(
    body: QueryUrlRequest,
    _: CurrentUser = Depends(require_operator),
) -> QueryUrlResponse:
    try:
        validate_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    try:
        result = await query_url(body.url)
        return QueryUrlResponse(**result)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"URL nicht erreichbar: {exc}")


@router.post("/isos/download", response_model=JobResponse, status_code=201)
async def download_iso(
    body: IsoDownloadRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> JobResponse:
    resolved_node = body.node or get_proxmox_node()
    # PROJ-49: operator OR node:upload_iso (additiv, AC-ISO-1/3)
    await _require_iso_upload_permission(current_user, resolved_node)
    await _require_packer_token_for_node(resolved_node)
    try:
        validate_url(body.url)
        validate_filename(body.filename)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    # Warn if ISO already exists (409 so frontend can offer skip)
    try:
        if await check_iso_exists(resolved_node, body.filename):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"ISO '{body.filename}' existiert bereits auf Node '{resolved_node}'",
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")

    # Start the Proxmox download task
    try:
        upid = await start_iso_download(
            node=resolved_node,
            filename=body.filename,
            url=body.url,
            checksum_algorithm=body.checksum_algorithm,
            checksum=body.checksum,
            verify_certificates=body.verify_certificates,
        )
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Download-Start fehlgeschlagen: {exc}")

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO jobs (id, type, playbook, status, created_at, username, params)
                   VALUES (:id, 'iso_download', :filename, 'pending', :created_at, :username, :params)"""
            ),
            {
                "id": job_id,
                "filename": body.filename,
                "created_at": now,
                "username": current_user.username,
                "params": json.dumps({"node": resolved_node, "url": body.url, "filename": body.filename}),
            },
        )
        await session.commit()
        result = await session.execute(text("SELECT * FROM jobs WHERE id = :id"), {"id": job_id})
        row = result.mappings().fetchone()

    asyncio.create_task(run_iso_download_job(job_id, resolved_node, upid))
    return _row_to_job(row)


# ── Proxmox VM-Templates (PROJ-16) ───────────────────────────────────────────

async def _get_viewer_auth_for_packer(current_user) -> tuple[ProxmoxAuth, ProxmoxClient]:
    """Viewer/read-only auth for listing Proxmox resources (no packer token required)."""
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab to access this endpoint",
            )
        auth = ProxmoxAuth(kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""))
        return auth, proxmox_client
    node = await get_default_node()
    token = _extract_token(node, "viewer") if node else None
    if not token:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Viewer service account not configured – contact your administrator",
        )
    client = ProxmoxClient(base_url=node.url, verify_ssl=node.verify_ssl)
    auth = ProxmoxAuth(kind="token", value=token.token_id, secret=token.token_secret)
    return auth, client


async def _get_packer_auth_for_user(current_user) -> tuple[ProxmoxAuth, ProxmoxClient]:
    """Resolve (ProxmoxAuth, ProxmoxClient) for Proxmox API reads in the Packer section.

    Proxmox-login users: use their session cookie (no token required).
    Local users: require a per-node or global packer service-account token.

    The returned ProxmoxClient is pinned to the resolved node URL so multi-node
    deployments hit the correct cluster instance.
    """
    if current_user.auth_type == "proxmox":
        session = proxmox_client.get_session(current_user.username)
        if not session:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="No Proxmox session – login via Proxmox tab to access this endpoint",
            )
        auth = ProxmoxAuth(kind="cookie", value=session["ticket"], csrf=session.get("csrf", ""))
        return auth, proxmox_client

    tid, tsec, host_url, verify_ssl = await _require_packer_token_for_node(get_proxmox_node())
    auth = ProxmoxAuth(kind="token", value=tid, secret=tsec)
    client = ProxmoxClient(base_url=host_url, verify_ssl=verify_ssl)
    return auth, client


@router.get("/proxmox-templates", response_model=list[ProxmoxTemplateInfo])
async def list_proxmox_templates(
    current_user: CurrentUser = Depends(require_operator),
) -> list[ProxmoxTemplateInfo]:
    plus = plus_behavior.can_use_cluster_resources()

    # Plus + local users: fan-out to all portal nodes (PROJ-30)
    # /cluster/resources includes ctime → no per-VM fallback needed
    if plus and current_user.auth_type != "proxmox":
        all_portal_nodes = await list_nodes()
        if not all_portal_nodes:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="No Proxmox nodes configured")
        portal_clients = [
            (ProxmoxClient(base_url=n.url, verify_ssl=n.verify_ssl),
             ProxmoxAuth(kind="token", value=t.token_id, secret=t.token_secret))
            for n in all_portal_nodes
            if (t := _extract_token(n, "viewer")) is not None
        ]
        if not portal_clients:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Viewer service account not configured – contact your administrator",
            )
        results = await asyncio.gather(
            *[c.get_cluster_resources_v2(a, "vm") for c, a in portal_clients],
            return_exceptions=True,
        )
        templates: list[ProxmoxTemplateInfo] = []
        for res in results:
            if isinstance(res, Exception):
                continue
            templates.extend(
                ProxmoxTemplateInfo(
                    vmid=int(r["vmid"]),
                    name=r.get("name") or f"VM {r['vmid']}",
                    node=r.get("node", ""),
                    type=r.get("type", "qemu"),
                    ctime=r.get("ctime"),
                )
                for r in res
                if r.get("template") == 1
            )
        return templates

    # Proxmox-login users or Basis edition: single client
    auth, client = await _get_viewer_auth_for_packer(current_user)
    try:
        if plus:
            resources = await client.get_cluster_resources_v2(auth, "vm")
        else:
            resources = await client.get_node_vms(auth, get_proxmox_node())
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")

    templates = [
        ProxmoxTemplateInfo(
            vmid=int(r["vmid"]),
            name=r.get("name") or f"VM {r['vmid']}",
            node=r.get("node", ""),
            type=r.get("type", "qemu"),
            ctime=r.get("ctime"),
        )
        for r in resources
        if r.get("template") == 1
    ]

    # Basis edition: /nodes/{node}/qemu does not include ctime → fetch per VM
    missing = [t for t in templates if t.ctime is None]
    if missing:
        ctime_results = await asyncio.gather(
            *[client.get_vm_ctime(auth, t.node, t.vmid, t.type) for t in missing],
            return_exceptions=True,
        )
        for t, result in zip(missing, ctime_results):
            if isinstance(result, int):
                t.ctime = result

    return templates


@router.delete("/proxmox-templates/{vmid}", status_code=204)
async def delete_proxmox_template(
    vmid: int,
    current_user: CurrentUser = Depends(require_admin),
) -> Response:
    # Plus + local users: fan-out across all portal nodes (same as list_proxmox_templates)
    # so templates on non-default nodes can be found and deleted.
    if plus_behavior.can_use_cluster_resources() and current_user.auth_type != "proxmox":
        all_portal_nodes = await list_nodes()
        if not all_portal_nodes:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="No Proxmox nodes configured")
        for node_row in all_portal_nodes:
            t = _extract_token(node_row, "packer") or _extract_token(node_row, "admin")
            if not t:
                continue
            node_auth = ProxmoxAuth(kind="token", value=t.token_id, secret=t.token_secret)
            node_client = ProxmoxClient(base_url=node_row.url, verify_ssl=node_row.verify_ssl)
            try:
                resources = await node_client.get_cluster_resources_v2(node_auth, "vm")
            except Exception:
                continue
            match = next((r for r in resources if int(r.get("vmid", -1)) == vmid and r.get("template") == 1), None)
            if match:
                try:
                    await node_client.delete_vm(node_auth, match["node"], vmid, match.get("type", "qemu"))
                except Exception as exc:
                    raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")
                # PROJ-74: Config-Snapshots orphan-markieren
                try:
                    await plus_behavior.on_vm_lxc_deleted_config_snapshots(
                        node_row.id, match["node"], vmid,
                        match.get("type", "qemu"), None, current_user.username,
                    )
                except Exception:
                    pass
                return Response(status_code=204)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Template-VM {vmid} nicht gefunden")

    # Core edition or Proxmox-login users: single-node path
    auth, client = await _get_packer_auth_for_user(current_user)
    try:
        if plus_behavior.can_use_cluster_resources():
            resources = await client.get_cluster_resources_v2(auth, "vm")
        else:
            resources = await client.get_node_vms(auth, get_proxmox_node())
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")

    match = next((r for r in resources if r.get("vmid") == vmid and r.get("template") == 1), None)
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Template-VM {vmid} nicht gefunden")

    try:
        await client.delete_vm(auth, match["node"], vmid, match.get("type", "qemu"))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")

    # PROJ-74: Config-Snapshots orphan-markieren (Core-path)
    try:
        from backend.services.nodes_service import get_default_node as _gdn
        _node_row = await _gdn()
        if _node_row is not None:
            await plus_behavior.on_vm_lxc_deleted_config_snapshots(
                _node_row.id, match["node"], vmid,
                match.get("type", "qemu"), None, current_user.username,
            )
    except Exception:
        pass

    return Response(status_code=204)


# ── VM-ID Autoauswahl ─────────────────────────────────────────────────────────

@router.get("/next-vmid")
async def get_next_vmid(
    current_user: CurrentUser = Depends(require_operator),
) -> dict:
    """Return the next free VM ID within the configured packer range."""
    min_id = int(await get_setting("packer_vmid_min") or "100")
    max_id = int(await get_setting("packer_vmid_max") or "999999")
    auth, client = await _get_packer_auth_for_user(current_user)
    try:
        vmid = await client.get_next_vmid(auth, min_id, max_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Proxmox API Fehler: {exc}")
    return {"vmid": vmid, "min": min_id, "max": max_id}


# ── List & Detail ─────────────────────────────────────────────────────────────

@router.get("", response_model=list[PackerSummary])
async def get_packer_templates(
    _: CurrentUser = Depends(require_not_restricted),
    _scope: CurrentUser = Depends(require_scope_for_upk("packer:read")),
) -> list[PackerSummary]:
    from backend.services.packer_service import _list_all
    templates = list_packer_templates()
    # PROJ-50: Discovery-Sync (fire-and-forget)
    asyncio.ensure_future(_sync_packer_approval_rules(_list_all()))
    return templates


async def _sync_packer_approval_rules(metas) -> None:
    try:
        for tid, meta in metas:
            await plus_behavior.sync_meta_yaml_approval_rule(
                "packer_build", tid, meta.approval if meta.approval else None
            )
    except Exception as exc:
        import logging
        logging.getLogger(__name__).debug("PROJ-64 packer approval sync error: %s", exc)


@router.get("/{template_id}", response_model=PackerDetail)
async def get_packer_template_detail(
    template_id: str,
    _: CurrentUser = Depends(require_not_restricted),
    _scope: CurrentUser = Depends(require_scope_for_upk("packer:read")),
) -> PackerDetail:
    detail = get_packer_template(template_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return detail


# ── Template-Dokumentation ───────────────────────────────────────────────────

@router.get("/{template_id}/description")
async def get_template_description(
    template_id: str,
    _: CurrentUser = Depends(require_not_restricted),
) -> dict:
    """Read description.md from the packer template directory."""
    template_dir = Path(settings.packer_dir) / template_id
    if not template_dir.is_dir():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    md_file = template_dir / "description.md"
    if not md_file.exists():
        return {"content": None}
    return {"content": md_file.read_text(encoding="utf-8")}


# ── Upload (Admin only) ───────────────────────────────────────────────────────

@router.post("/upload", response_model=PackerSummary, status_code=201)
async def upload_packer_template(
    zip_file: UploadFile = File(...),
    _: CurrentUser = Depends(require_admin),
    _scope: CurrentUser = Depends(require_scope_for_upk("packer:write")),
) -> PackerSummary:
    if not (zip_file.filename or "").lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nur ZIP-Archive werden akzeptiert (.zip)",
        )

    zip_content = await zip_file.read()

    try:
        template_id = save_template_zip(zip_content)
    except FileExistsError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Fehler beim Schreiben: {exc}")

    detail = get_packer_template(template_id)
    return PackerSummary(
        id=template_id,
        name=detail.name if detail else template_id,
        description=detail.description if detail else "",
        required_role=detail.required_role if detail else None,
    )


# ── Build (Operator+) ─────────────────────────────────────────────────────────

@router.post("/{template_id}/build", response_model=JobResponse, status_code=201)
async def start_packer_build(
    template_id: str,
    body: PackerBuildRequest,
    current_user: CurrentUser = Depends(require_operator),
    _scope: CurrentUser = Depends(require_scope_for_upk("packer:write")),
) -> JobResponse:
    # Template must exist
    if get_packer_template(template_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    # Resolve credentials: Proxmox-login users run in their own context (no token needed).
    # Local users require a configured packer service-account token.
    if current_user.auth_type == "proxmox":
        proxmox_credentials = (
            get_credentials(current_user.jti) if current_user.jti else None
        )
        if proxmox_credentials is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Proxmox-Session abgelaufen – bitte erneut einloggen",
            )
    else:
        proxmox_credentials = None
        # Determine target node from request params (fallback to default node)
        target_node = (body.params.get("proxmox_node") or body.params.get("node")) if isinstance(body.params, dict) else None
        await _require_packer_token_for_node(target_node)

    # Validate user-supplied params
    errors = validate_params(template_id, body.params)
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)

    # Block concurrent builds for the same template
    async with get_db() as session:
        result = await session.execute(
            text("SELECT id FROM jobs WHERE type='packer' AND playbook=:tid AND status='running'"),
            {"tid": template_id},
        )
        if result.mappings().fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ein Build für dieses Template läuft bereits",
            )

    # PROJ-64: Approval-Check via Plus-Hook
    if current_user.user_id is not None:
        try:
            from fastapi.responses import JSONResponse as _JSONResponse
            decision = await plus_behavior.requires_approval(
                action_type="packer_build",
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

    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    # Strip sensitive params (ssh_key type) before DB storage
    sensitive = get_sensitive_packer_param_ids(template_id)
    stored_params = {k: v for k, v in body.params.items() if k not in sensitive}
    callback_url_str = str(body.callback_url) if body.callback_url else None

    async with get_db() as session:
        await session.execute(
            text(
                """INSERT INTO jobs (id, type, playbook, status, created_at, username, params, callback_url)
                   VALUES (:id, 'packer', :template_id, 'pending', :created_at, :username, :params, :callback_url)"""
            ),
            {
                "id": job_id,
                "template_id": template_id,
                "created_at": now,
                "username": current_user.username,
                "params": json.dumps(stored_params),
                "callback_url": callback_url_str,
            },
        )
        await session.commit()
        result = await session.execute(
            text("SELECT * FROM jobs WHERE id = :id"), {"id": job_id}
        )
        row = result.mappings().fetchone()

    target_node = (body.params.get("proxmox_node") or body.params.get("node")) if isinstance(body.params, dict) else None
    asyncio.create_task(
        run_packer_job(
            job_id, template_id, body.params, proxmox_credentials,
            proxmox_node_name=target_node,
        )
    )
    return _row_to_job(row)


# ── Delete (Admin only) ───────────────────────────────────────────────────────

@router.delete("/{template_id}", status_code=204)
async def delete_packer_template_endpoint(
    template_id: str,
    _: CurrentUser = Depends(require_admin),
) -> Response:
    if get_packer_template(template_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")

    # Block deletion while a build is running
    async with get_db() as session:
        result = await session.execute(
            text("SELECT id FROM jobs WHERE type='packer' AND playbook=:tid AND status='running'"),
            {"tid": template_id},
        )
        if result.mappings().fetchone():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Template kann nicht gelöscht werden, da ein Build läuft",
            )

    delete_packer_template(template_id)

    # PROJ-64: Pending Approvals für dieses Packer-Template canceln (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_packer_template_deleted_approval_workflow(template_id, _.username)
    except Exception:
        pass

    return Response(status_code=204)
