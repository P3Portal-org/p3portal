# p3portal.org
"""PROJ-73: Pydantic-Schemas für das Node-Updates-Modul."""
from __future__ import annotations

from pydantic import BaseModel


class PackageUpdate(BaseModel):
    name: str
    version_old: str
    version_new: str
    is_security: bool


class MemberUpdateState(BaseModel):
    """Stand eines einzelnen Proxmox-Members (eine Zeile in node_updates)."""
    portal_node_id: int
    proxmox_node_name: str
    last_check_at: str | None
    last_success_at: str | None
    last_error: str | None
    packages: list[PackageUpdate]
    package_count: int
    security_count: int
    is_stale: bool


class NodeUpdateResponse(BaseModel):
    """Antwort für GET /api/nodes/{portal_node_id}/updates."""
    portal_node_id: int
    portal_node_name: str
    members: list[MemberUpdateState]


class NodeUpdateSummaryEntry(BaseModel):
    """Eine Zeile im Summary (eine pro Proxmox-Member)."""
    portal_node_id: int
    portal_node_name: str
    proxmox_node_name: str
    package_count: int
    security_count: int
    last_success_at: str | None
    last_check_at: str | None
    last_error: str | None
    is_stale: bool


class NodeUpdateSummaryResponse(BaseModel):
    """Antwort für GET /api/nodes/updates/summary."""
    entries: list[NodeUpdateSummaryEntry]
