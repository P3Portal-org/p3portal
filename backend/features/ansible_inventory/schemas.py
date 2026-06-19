# p3portal.org
"""PROJ-83: Pydantic-Schemas für den Ansible-Inventory-Router."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class HostEntryOut(BaseModel):
    host_ref: str
    portal_node_id: int
    proxmox_node: str | None = None
    vmid: int
    kind: str
    group: Literal["managed", "unmanaged", "no_ip"]
    ip: str | None = None
    ansible_user: str


class InventoryOut(BaseModel):
    scope: str
    scope_ref: int | None = None
    error: str | None = None
    hosts: list[HostEntryOut] = []


class OnboardingBlockOut(BaseModel):
    block: str
    vendor_data: str
    key_count: int


class ResetHostKeyOut(BaseModel):
    detail: str


# ── PROJ-84 ───────────────────────────────────────────────────────────────────

class MarkManagedOut(BaseModel):
    detail: str          # "managed"
    host_ref: str
    in_run_scope: bool   # AC-RUN-2: liegt der Host in einem ausführbaren Scope?


class ConnectivityTestOut(BaseModel):
    ok: bool
    reason: str          # ok | no_ip | no_key | auth_failed | host_key_changed | timeout | unreachable | error
