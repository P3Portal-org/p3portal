# p3portal.org
"""PROJ-47: Pydantic-Schemas für das Node-Assignments-Modul."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

# Whitelist erlaubter Node-Aktionen (additiv erweiterbar, kein DB-Schema-Change nötig)
VALID_NODE_ACTIONS: frozenset[str] = frozenset({
    "node:view_tasks",
    "node:view_backups",
    "node:upload_iso",
    "node:view_updates",    # PROJ-73: APT-Update-Stand lesen
    "node:refresh_updates", # PROJ-73: APT-Update-Fetch auslösen
})


class NodeAssignmentAddRequest(BaseModel):
    subject_type: Literal["user", "group"]
    subject_id: int
    role_preset_id: int


class NodeAssignmentUpdateRequest(BaseModel):
    role_preset_id: int


class NodeAssignmentResponse(BaseModel):
    id: int
    node_id: int
    subject_type: str
    subject_id: int
    subject_display: str | None = None
    role_preset_id: int
    preset_name: str | None = None
    preset_node_actions: list[str] = []
    added_at: str
    added_by: str


class MyNodeAssignmentEntry(BaseModel):
    node_id: int
    node_name: str
    role_preset_id: int
    preset_name: str
    preset_permissions: list[str]
    preset_node_actions: list[str]
    source: Literal["direct", "group"]
    source_group_name: str | None = None
