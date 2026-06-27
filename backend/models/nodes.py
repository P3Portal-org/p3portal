# p3portal.org
from __future__ import annotations

from pydantic import BaseModel, field_validator


class NodeCreate(BaseModel):
    name: str
    url: str
    proxmox_node: str
    verify_ssl: bool = True
    token_id: str = ""
    token_secret: str = ""
    # Per-node role tokens (optional – fall back to global portal_config when empty)
    viewer_token_id: str = ""
    viewer_token_secret: str = ""
    operator_token_id: str = ""
    operator_token_secret: str = ""
    admin_token_id: str = ""
    admin_token_secret: str = ""
    packer_token_id: str = ""
    packer_token_secret: str = ""
    # PROJ-76 Phase 2a: OpenTofu engine token (optional per node, Plus-only usage)
    tofu_token_id: str = ""
    tofu_token_secret: str = ""
    # PROJ-26: additional PVE node names belonging to the same Proxmox installation
    cluster_nodes: list[str] = []
    # PROJ-33: how often (seconds) cluster data is refreshed from Proxmox
    poll_interval: int = 30

    @field_validator("name", "url", "proxmox_node")
    @classmethod
    def not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("must not be empty")
        return v.strip()

    @field_validator("url")
    @classmethod
    def valid_url(cls, v: str) -> str:
        v = v.strip().rstrip("/")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("must start with http:// or https://")
        return v

    @field_validator("poll_interval")
    @classmethod
    def valid_poll_interval(cls, v: int) -> int:
        if not (10 <= v <= 300):
            raise ValueError("poll_interval must be between 10 and 300 seconds")
        return v


class NodeUpdate(BaseModel):
    name: str | None = None
    url: str | None = None
    proxmox_node: str | None = None
    verify_ssl: bool | None = None
    token_id: str | None = None
    token_secret: str | None = None
    viewer_token_id: str | None = None
    viewer_token_secret: str | None = None
    operator_token_id: str | None = None
    operator_token_secret: str | None = None
    admin_token_id: str | None = None
    admin_token_secret: str | None = None
    packer_token_id: str | None = None
    packer_token_secret: str | None = None
    # PROJ-76 Phase 2a
    tofu_token_id: str | None = None
    tofu_token_secret: str | None = None
    # PROJ-26: None = don't change; [] = clear all cluster nodes
    cluster_nodes: list[str] | None = None
    # PROJ-33: None = don't change
    poll_interval: int | None = None

    @field_validator("url")
    @classmethod
    def valid_url(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip().rstrip("/")
        if not (v.startswith("http://") or v.startswith("https://")):
            raise ValueError("must start with http:// or https://")
        return v

    @field_validator("poll_interval")
    @classmethod
    def valid_poll_interval(cls, v: int | None) -> int | None:
        if v is None:
            return v
        if not (10 <= v <= 300):
            raise ValueError("poll_interval must be between 10 and 300 seconds")
        return v


class NodeResponse(BaseModel):
    id: int
    name: str
    url: str
    proxmox_node: str
    verify_ssl: bool
    token_id: str
    # Per-node role token IDs (secrets are NEVER returned)
    viewer_token_id: str = ""
    operator_token_id: str = ""
    admin_token_id: str = ""
    packer_token_id: str = ""
    tofu_token_id: str = ""  # PROJ-76 Phase 2a (secret never returned)
    cluster_nodes: list[str] = []  # PROJ-26
    poll_interval: int = 30        # PROJ-33
    position: int = 0              # globale Node-Reihenfolge
    is_default: bool
    created_at: str
    created_by: str


class NodeReorderRequest(BaseModel):
    node_ids: list[int]  # alle Node-IDs in gewünschter Reihenfolge
