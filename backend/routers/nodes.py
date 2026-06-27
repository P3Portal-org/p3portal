# p3portal.org
"""PROJ-21: Admin node management API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from backend.core.deps import CurrentUser, require_admin_or
from backend.core.plus_protocol import plus_behavior
from backend.models.nodes import NodeCreate, NodeReorderRequest, NodeResponse, NodeUpdate
from backend.services.config_service import set_config
from backend.services.nodes_service import (
    count_nodes,
    create_node,
    delete_node,
    get_default_node,
    get_node,
    list_nodes,
    reorder_nodes,
    set_default_node,
    test_connection,
    update_node,
)
from backend.services.service_accounts import _extract_token

router = APIRouter(prefix="/api/admin/nodes", tags=["nodes"])


def _to_response(n) -> NodeResponse:
    return NodeResponse(
        id=n.id,
        name=n.name,
        url=n.url,
        proxmox_node=n.proxmox_node,
        verify_ssl=n.verify_ssl,
        token_id=n.token_id,
        viewer_token_id=getattr(n, "viewer_token_id", "") or "",
        operator_token_id=getattr(n, "operator_token_id", "") or "",
        admin_token_id=getattr(n, "admin_token_id", "") or "",
        packer_token_id=getattr(n, "packer_token_id", "") or "",
        tofu_token_id=getattr(n, "tofu_token_id", "") or "",
        cluster_nodes=getattr(n, "cluster_nodes", []) or [],
        poll_interval=getattr(n, "poll_interval", 30) or 30,
        position=getattr(n, "position", 0) or 0,
        is_default=n.is_default,
        created_at=n.created_at,
        created_by=n.created_by,
    )


async def _audit_tofu_token_set(node, username: str) -> None:
    """PROJ-76 Phase 2a: AC-2A-TOKEN-7 – audit when the tofu token is set/changed.

    Never logs the secret – only node identity and the token-ID (non-secret).
    """
    try:
        from backend.services.audit_service import write_audit_log
        await write_audit_log(
            event_type="node_tofu_token_set",
            username=username,
            auth_type="local",
            detail=(
                f"OpenTofu token set for node '{node.name}' "
                f"(id={node.id}, token_id={node.tofu_token_id or '∅'})"
            ),
        )
    except Exception:
        pass


@router.get("", response_model=list[NodeResponse])
async def get_nodes(_: CurrentUser = Depends(require_admin_or("manage_nodes"))) -> list[NodeResponse]:
    nodes = await list_nodes()
    return [_to_response(n) for n in nodes]


@router.put("/reorder", response_model=list[NodeResponse])
async def reorder_nodes_endpoint(
    body: NodeReorderRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> list[NodeResponse]:
    """Globale Anzeige-Reihenfolge der Installationen setzen (Admin/manage_nodes).

    Muss vor den /{node_id}-Routen definiert sein (Starlette matcht nach
    Definitionsreihenfolge; 'reorder' würde sonst gegen {node_id:int} 422en).
    """
    try:
        nodes = await reorder_nodes(body.node_ids)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc))
    try:
        from backend.services.audit_service import write_audit_log
        await write_audit_log(
            event_type="nodes_reordered",
            username=current_user.username,
            auth_type="local",
            detail=f"Node-Reihenfolge geändert: {body.node_ids}",
        )
    except Exception:
        pass
    return [_to_response(n) for n in nodes]


@router.get("/{node_id}", response_model=NodeResponse)
async def get_one_node(
    node_id: int,
    _: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> NodeResponse:
    node = await get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return _to_response(node)


@router.post("", response_model=NodeResponse, status_code=201)
async def add_node(
    body: NodeCreate,
    current_user: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> NodeResponse:
    if not plus_behavior.can_add_multiple_nodes() and (await count_nodes()) >= 1:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Multiple nodes require P3 Plus edition",
        )
    node = await create_node(
        name=body.name,
        url=body.url,
        proxmox_node=body.proxmox_node,
        verify_ssl=body.verify_ssl,
        token_id=body.token_id,
        token_secret=body.token_secret,
        viewer_token_id=body.viewer_token_id,
        viewer_token_secret=body.viewer_token_secret,
        operator_token_id=body.operator_token_id,
        operator_token_secret=body.operator_token_secret,
        admin_token_id=body.admin_token_id,
        admin_token_secret=body.admin_token_secret,
        packer_token_id=body.packer_token_id,
        packer_token_secret=body.packer_token_secret,
        tofu_token_id=body.tofu_token_id,
        tofu_token_secret=body.tofu_token_secret,
        cluster_nodes=body.cluster_nodes,
        poll_interval=body.poll_interval,
        created_by=current_user.username,
    )
    # PROJ-76 Phase 2a: AC-2A-TOKEN-7 – Audit beim Setzen des tofu-Tokens
    if body.tofu_token_id or body.tofu_token_secret:
        await _audit_tofu_token_set(node, current_user.username)
    return _to_response(node)


@router.put("/{node_id}", response_model=NodeResponse)
async def edit_node(
    node_id: int,
    body: NodeUpdate,
    _: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> NodeResponse:
    if not plus_behavior.can_set_default_node():
        existing = await get_node(node_id)
        if not existing:
            raise HTTPException(status_code=404, detail="Node not found")
    # PROJ-76 Phase 2a / BUG-76-2A-1: Vorher-Zustand für den Audit-Vergleich.
    before_node = await get_node(node_id)
    node = await update_node(
        node_id,
        name=body.name,
        url=body.url,
        proxmox_node=body.proxmox_node,
        verify_ssl=body.verify_ssl,
        token_id=body.token_id,
        token_secret=body.token_secret,
        viewer_token_id=body.viewer_token_id,
        viewer_token_secret=body.viewer_token_secret,
        operator_token_id=body.operator_token_id,
        operator_token_secret=body.operator_token_secret,
        admin_token_id=body.admin_token_id,
        admin_token_secret=body.admin_token_secret,
        packer_token_id=body.packer_token_id,
        packer_token_secret=body.packer_token_secret,
        tofu_token_id=body.tofu_token_id,
        tofu_token_secret=body.tofu_token_secret,
        cluster_nodes=body.cluster_nodes,
        poll_interval=body.poll_interval,
    )
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    # PROJ-76 Phase 2a: AC-2A-TOKEN-7 – Audit NUR bei tatsächlicher tofu-Token-Änderung.
    # BUG-76-2A-1: NodeFormModal sendet die nicht-geheime tofu_token_id bei JEDER Bearbeitung
    # mit (nur leere Secret-Felder werden weggelassen). Ohne diesen Vergleich erzeugte jede
    # Node-Bearbeitung (z. B. reines Umbenennen) ein irreführendes "token set"-Audit. Wir
    # feuern daher nur, wenn ein neues Secret geliefert wurde ODER sich die Token-ID ändert.
    tofu_changed = (
        body.tofu_token_secret is not None
        or (
            body.tofu_token_id is not None
            and before_node is not None
            and body.tofu_token_id != before_node.tofu_token_id
        )
    )
    if tofu_changed:
        await _audit_tofu_token_set(node, _.username)

    # If this is the default node, sync portal_config
    if node.is_default:
        await set_config("proxmox_host", node.url, updated_by=_.username if hasattr(_, "username") else "admin")
        await set_config("proxmox_node", node.proxmox_node, updated_by="admin")

    return _to_response(node)


@router.delete("/{node_id}", status_code=204)
async def remove_node(
    node_id: int,
    current_user: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> None:
    node_before = await get_node(node_id)
    node_proxmox_name = node_before.proxmox_node if node_before else None
    node_name = node_before.name if node_before else str(node_id)

    # PROJ-47: Audit-Log für Node-Assignments BEVOR FK CASCADE sie löscht
    try:
        from backend.features.node_assignments.service import cleanup_assignments_for_node
        await cleanup_assignments_for_node(node_id, node_name, current_user.username)
    except Exception:
        pass

    # PROJ-48: Owner-Einträge soft-löschen bevor Node gelöscht wird (FK RESTRICT)
    try:
        from backend.features.owners.cleanup import on_node_delete
        await on_node_delete(node_id, current_user.username)
    except Exception:
        pass

    # PROJ-62: Pool-Members für diesen Node entfernen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_node_deleted_pools(node_id, current_user.username)
    except Exception:
        pass

    # PROJ-70: Scheduled-Jobs für diesen Node löschen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_node_deleted_scheduled_jobs(node_id, current_user.username)
    except Exception:
        pass

    # PROJ-77: Auto-Snapshot-Jobs für diesen Node deaktivieren
    try:
        await plus_behavior.on_node_deleted_auto_snapshots(node_id, current_user.username)
    except Exception:
        pass

    deleted = await delete_node(node_id)
    if not deleted:
        total = await count_nodes()
        if total <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot delete the last node",
            )
        raise HTTPException(status_code=404, detail="Node not found")
    try:
        from backend.features.sidebar_pins.service import cleanup_pins_for_resource
        await cleanup_pins_for_resource("node", str(node_id), current_user.username)
        if node_proxmox_name:
            await cleanup_pins_for_resource("node_tab", node_proxmox_name, current_user.username)
    except Exception:
        pass


@router.post("/{node_id}/test")
async def test_node_connection(
    node_id: int,
    _: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> dict:
    node = await get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    # Prefer viewer-token for the connection probe (least privilege); fall back
    # to the legacy generic token otherwise.
    probe_id = node.viewer_token_id or node.token_id
    probe_secret = node.viewer_token_secret or node.token_secret
    return await test_connection(
        url=node.url,
        token_id=probe_id,
        token_secret=probe_secret,
        verify_ssl=node.verify_ssl,
    )


@router.post("/{node_id}/test-token")
async def test_node_token(
    node_id: int,
    body: dict,
    _: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> dict:
    """Test a specific role token for a saved node."""
    role = body.get("role", "")
    if role not in ("viewer", "operator", "admin", "packer"):
        raise HTTPException(status_code=400, detail="role must be viewer/operator/admin/packer")
    node = await get_node(node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    token = _extract_token(node, role)
    if not token:
        return {"ok": False, "version": None, "error": f"Kein {role}-Token konfiguriert"}
    return await test_connection(
        url=node.url,
        token_id=token.token_id,
        token_secret=token.token_secret,
        verify_ssl=node.verify_ssl,
    )


@router.post("/default/{node_id}", status_code=200)
async def make_default_node(
    node_id: int,
    current_user: CurrentUser = Depends(require_admin_or("manage_nodes")),
) -> dict:
    ok = await set_default_node(node_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Node not found")
    node = await get_node(node_id)
    if node:
        await set_config("proxmox_host", node.url, updated_by=current_user.username)
        await set_config("proxmox_node", node.proxmox_node, updated_by=current_user.username)
    return {"ok": True}
