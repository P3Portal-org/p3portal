# p3portal.org
"""PROJ-73: Node-Update-Router – 3 HTTP endpoints for APT update state."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.features.node_updates.schemas import NodeUpdateResponse, NodeUpdateSummaryResponse
from backend.features.node_updates.service import (
    _can_refresh,
    _can_view,
    get_summary_for_user,
    get_updates_for_portal_node,
    refresh_portal_node,
)
from backend.routers.auth import get_current_user
from backend.services.nodes_service import list_nodes

router = APIRouter(prefix="/api/nodes", tags=["node-updates"])


async def _get_node_or_404(portal_node_id: int):
    nodes = await list_nodes()
    for n in nodes:
        if n.id == portal_node_id:
            return n
    raise HTTPException(status_code=404, detail="node_not_found")


@router.get("/updates/summary", response_model=NodeUpdateSummaryResponse)
async def get_updates_summary(current_user=Depends(get_current_user)):
    """Return flat list of member update states visible to the caller."""
    return await get_summary_for_user(current_user)


@router.get("/{portal_node_id}/updates", response_model=NodeUpdateResponse)
async def get_node_updates(
    portal_node_id: int,
    current_user=Depends(get_current_user),
):
    """Return persisted APT update state for all members of a portal node."""
    if not await _can_view(current_user, portal_node_id):
        raise HTTPException(status_code=403, detail="forbidden")
    node = await _get_node_or_404(portal_node_id)
    return await get_updates_for_portal_node(portal_node_id, node)


@router.post("/{portal_node_id}/updates/refresh", response_model=NodeUpdateResponse)
async def refresh_node_updates(
    portal_node_id: int,
    current_user=Depends(get_current_user),
):
    """Trigger a manual APT refresh for all members of a portal node."""
    if not await _can_refresh(current_user, portal_node_id):
        raise HTTPException(status_code=403, detail="forbidden")
    node = await _get_node_or_404(portal_node_id)
    return await refresh_portal_node(
        portal_node_id,
        node,
        is_manual=True,
        username=current_user.username,
    )
