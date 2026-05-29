# p3portal.org
from __future__ import annotations

from pydantic import BaseModel, field_validator

VALID_ACTIONS = {"view", "start", "stop", "reboot", "snapshot", "configure", "delete", "clone"}


def _validate_permissions(v: list[str]) -> list[str]:
    invalid = set(v) - VALID_ACTIONS
    if invalid:
        raise ValueError(f"Invalid actions: {invalid}. Allowed: {VALID_ACTIONS}")
    return list(dict.fromkeys(v))  # deduplicate, preserve order


from backend.features.node_assignments.schemas import VALID_NODE_ACTIONS


def _validate_node_actions(v: list[str]) -> list[str]:
    invalid = set(v) - VALID_NODE_ACTIONS
    if invalid:
        raise ValueError(
            f"Ungültige Node-Aktionen: {invalid}. Erlaubt: {sorted(VALID_NODE_ACTIONS)}"
        )
    return list(dict.fromkeys(v))


class PresetCreateRequest(BaseModel):
    name: str
    description: str = ""
    permissions: list[str]
    node_actions: list[str] = []

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name must not be empty")
        return v.strip()

    @field_validator("permissions")
    @classmethod
    def valid_permissions(cls, v: list[str]) -> list[str]:
        return _validate_permissions(v)

    @field_validator("node_actions")
    @classmethod
    def valid_node_actions(cls, v: list[str]) -> list[str]:
        return _validate_node_actions(v)


class PresetUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None
    node_actions: list[str] | None = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("name must not be empty")
        return v.strip() if v else v

    @field_validator("permissions")
    @classmethod
    def valid_permissions(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            return _validate_permissions(v)
        return v

    @field_validator("node_actions")
    @classmethod
    def valid_node_actions(cls, v: list[str] | None) -> list[str] | None:
        if v is not None:
            return _validate_node_actions(v)
        return v


class PresetResponse(BaseModel):
    id: int
    name: str
    description: str
    permissions: list[str]
    node_actions: list[str] = []
    created_at: str
    created_by: str
    assignment_count: int = 0


class AssignmentCreateRequest(BaseModel):
    resource_type: str
    resource_id: int
    preset_id: int
    portal_node_id: int | None = None

    @field_validator("resource_type")
    @classmethod
    def valid_resource_type(cls, v: str) -> str:
        if v not in ("vm", "lxc"):
            raise ValueError("resource_type must be 'vm' or 'lxc'")
        return v

    @field_validator("resource_id")
    @classmethod
    def positive_resource_id(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("resource_id must be positive")
        return v


class AssignmentResponse(BaseModel):
    id: int
    user_id: int
    resource_type: str
    resource_id: int
    portal_node_id: int | None
    node_name: str | None
    preset_id: int
    preset_name: str
    permissions: list[str]
    created_at: str
    created_by: str


class ResourcePermission(BaseModel):
    resource_type: str
    resource_id: int
    portal_node_id: int | None = None
    permissions: list[str]


class MyPermissionsResponse(BaseModel):
    bypass: bool
    assignments: list[ResourcePermission]
