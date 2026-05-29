# p3portal.org
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status

from backend.core.deps import CurrentUser, get_current_user, require_admin_or
from backend.core.plus_protocol import plus_behavior
from backend.models.rbac import (
    AssignmentCreateRequest,
    AssignmentResponse,
    MyPermissionsResponse,
    PresetCreateRequest,
    PresetResponse,
    PresetUpdateRequest,
    ResourcePermission,
)
from backend.services import rbac_service
from backend.services.local_auth import get_user_by_id
from backend.services.rbac_service import count_presets

router = APIRouter(prefix="/api/rbac", tags=["rbac"])


# ── Presets ───────────────────────────────────────────────────────────────────

@router.get("/presets", response_model=list[PresetResponse])
async def list_presets(_: CurrentUser = Depends(require_admin_or("manage_users"))) -> list[PresetResponse]:
    return await rbac_service.list_presets()


@router.post("/presets", response_model=PresetResponse, status_code=201)
async def create_preset(
    body: PresetCreateRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> PresetResponse:
    max_presets = plus_behavior.get_max_presets()
    if max_presets is not None:
        current_count = await count_presets()
        if current_count >= max_presets:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Core Edition: Maximale Preset-Anzahl ({max_presets}) erreicht. Upgrade auf P3 Plus für unbegrenzte Rollenpresets.",
            )
    return await rbac_service.create_preset(
        body.name, body.description, body.permissions,
        created_by=current_user.username,
        node_actions=body.node_actions,
    )


@router.put("/presets/{preset_id}", response_model=PresetResponse)
async def update_preset(
    preset_id: int,
    body: PresetUpdateRequest,
    _: CurrentUser = Depends(require_admin_or("manage_users")),
) -> PresetResponse:
    existing = await rbac_service.get_preset_by_id(preset_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset not found")
    updated = await rbac_service.update_preset(
        preset_id, body.name, body.description, body.permissions,
        node_actions=body.node_actions,
    )
    return updated


@router.delete("/presets/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: int,
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> Response:
    existing = await rbac_service.get_preset_by_id(preset_id)
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset not found")

    usage = await rbac_service.get_preset_usage_count(preset_id)
    if usage > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Preset is in use by {usage} assignment(s). Remove assignments first.",
        )

    # PROJ-47: Audit-Log für betroffene Node-Assignments (FK CASCADE löscht diese automatisch)
    try:
        from backend.features.node_assignments.service import get_assignment_count_for_preset
        import json as _json
        node_count = await get_assignment_count_for_preset(preset_id)
        if node_count > 0:
            from backend.services.audit_service import write_audit_log
            await write_audit_log(
                "node_assignment_removed",
                username=current_user.username,
                detail=_json.dumps({
                    "preset_id": preset_id,
                    "count": node_count,
                    "source": "preset_deleted",
                }),
            )
    except Exception:
        pass

    # PROJ-62: Pool-Assignments für dieses Preset entfernen (Plus-Protocol-Hook)
    try:
        await plus_behavior.on_role_preset_deleted_pools(preset_id, current_user.username)
    except Exception:
        pass

    await rbac_service.delete_preset(preset_id)
    return Response(status_code=204)


# ── User Assignments ──────────────────────────────────────────────────────────

@router.get("/users/{user_id}/assignments", response_model=list[AssignmentResponse])
async def list_assignments(
    user_id: int,
    _: CurrentUser = Depends(require_admin_or("manage_users")),
) -> list[AssignmentResponse]:
    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return await rbac_service.list_assignments(user_id)


@router.post("/users/{user_id}/assignments", response_model=AssignmentResponse, status_code=201)
async def create_assignment(
    user_id: int,
    body: AssignmentCreateRequest,
    current_user: CurrentUser = Depends(require_admin_or("manage_users")),
) -> AssignmentResponse:
    user = await get_user_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    preset = await rbac_service.get_preset_by_id(body.preset_id)
    if preset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Preset not found")

    try:
        return await rbac_service.create_assignment(
            user_id, body.resource_type, body.resource_id, body.preset_id,
            created_by=current_user.username,
            portal_node_id=body.portal_node_id,
        )
    except Exception as exc:
        if "UNIQUE constraint failed" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Assignment already exists for this user + resource",
            )
        raise


@router.delete("/users/{user_id}/assignments/{assignment_id}", status_code=204)
async def delete_assignment(
    user_id: int,
    assignment_id: int,
    _: CurrentUser = Depends(require_admin_or("manage_users")),
) -> Response:
    deleted = await rbac_service.delete_assignment(user_id, assignment_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    return Response(status_code=204)


# ── My Permissions ────────────────────────────────────────────────────────────

@router.get("/me/permissions", response_model=MyPermissionsResponse)
async def my_permissions(
    current_user: CurrentUser = Depends(get_current_user),
) -> MyPermissionsResponse:
    bypass = current_user.auth_type == "proxmox" or current_user.role == "admin"
    if bypass:
        return MyPermissionsResponse(bypass=True, assignments=[])

    user = await get_user_by_id_by_username_helper(current_user.username)
    if user is None:
        return MyPermissionsResponse(bypass=False, assignments=[])

    raw = await rbac_service.get_user_permissions(user["id"])
    assignments = [
        ResourcePermission(
            resource_type=p["resource_type"],
            resource_id=p["resource_id"],
            portal_node_id=p.get("portal_node_id"),
            permissions=p["permissions"],
        )
        for p in raw
    ]
    return MyPermissionsResponse(bypass=False, assignments=assignments)


async def get_user_by_id_by_username_helper(username: str) -> dict | None:
    from backend.services.local_auth import get_user_by_username
    return await get_user_by_username(username)
