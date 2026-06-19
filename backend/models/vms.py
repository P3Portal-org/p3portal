# p3portal.org
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class SnapshotCreateRequest(BaseModel):
    name: str
    description: str = ""

    @field_validator("name")
    @classmethod
    def valid_name(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r"^[a-zA-Z0-9_\-]{1,40}$", v):
            raise ValueError("name must be 1–40 alphanumeric characters, dashes, or underscores")
        return v


class SnapshotInfo(BaseModel):
    name: str
    description: str = ""
    parent: str = ""
    snaptime: int | None = None


class VmTaskResponse(BaseModel):
    task_id: str


class VmConfigUpdateRequest(BaseModel):
    """Resource changes applied to a VM/LXC config (CPU/RAM and a few flags).

    All fields optional; only provided ones are applied as a config diff.
    ``sockets`` is QEMU-only, ``swap`` is LXC-only — both are ignored for the
    other type. ``description`` set to an empty string removes the field.
    """
    cores: int | None = None
    sockets: int | None = None      # QEMU only
    memory: int | None = None       # MB
    swap: int | None = None         # LXC only, MB
    onboot: bool | None = None
    protection: bool | None = None
    description: str | None = None

    @field_validator("cores", "sockets")
    @classmethod
    def positive(cls, v: int | None) -> int | None:
        if v is not None and not (1 <= v <= 1024):
            raise ValueError("must be between 1 and 1024")
        return v

    @field_validator("memory")
    @classmethod
    def valid_memory(cls, v: int | None) -> int | None:
        if v is not None and not (16 <= v <= 4194304):
            raise ValueError("memory (MB) must be between 16 and 4194304")
        return v

    @field_validator("swap")
    @classmethod
    def valid_swap(cls, v: int | None) -> int | None:
        if v is not None and not (0 <= v <= 4194304):
            raise ValueError("swap (MB) must be between 0 and 4194304")
        return v


class ServiceAccountStatusResponse(BaseModel):
    viewer: bool
    operator: bool
    admin: bool


# ── VM Detail Page models (PROJ-29) ───────────────────────────────────────────

class NetworkInterface(BaseModel):
    id: str        # "net0", "net1"
    model: str     # "virtio", "e1000", etc.
    bridge: str    # "vmbr0"
    mac: str       # "AA:BB:CC:DD:EE:FF"


class DiskConfig(BaseModel):
    id: str       # "scsi0", "rootfs", "mp0"
    storage: str  # "local-lvm"
    size: str     # raw Proxmox value: "32G", "512M", "1T"
    # PROJ-81: p3-<uuid8> serial if we set it at attach time (forward-compat for
    # the Phase 2 in-guest automation, which finds the disk via /dev/disk/by-id).
    serial: str | None = None


# ── PROJ-81: VM Disk Management (manual, Proxmox-only) ────────────────────────

class DiskAttachRequest(BaseModel):
    """Attach (=create + attach) an additional disk to a QEMU VM."""
    size_gb: int = Field(..., ge=1, le=131072)        # 1 GiB .. 128 TiB
    storage: str
    bus: Literal["scsi", "virtio", "sata"] = "scsi"

    @field_validator("storage")
    @classmethod
    def storage_valid(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("storage must not be empty")
        # Defense-in-depth: a Proxmox storage id is alphanumeric plus ._- only.
        # Rejecting other characters prevents smuggling extra disk-config options
        # (e.g. ",import-from=...") into the volume spec built at attach time.
        if not re.fullmatch(r"[A-Za-z0-9._-]+", v):
            raise ValueError("storage contains invalid characters")
        return v


class DiskResizeRequest(BaseModel):
    """Grow an existing disk. Proxmox can only grow, never shrink."""
    size_gb: int = Field(..., ge=1, le=131072)


class ImageStorageInfo(BaseModel):
    """A node storage that can hold VM disk images (content type 'images')."""
    name: str           # Proxmox storage id
    type: str = ""      # "lvmthin", "dir", "zfspool", ...
    avail: int = 0      # bytes free
    total: int = 0      # bytes total
    used: int = 0       # bytes used


class DiskListResponse(BaseModel):
    """Disk list after a mutating operation, plus the affected slot."""
    disks: list[DiskConfig]
    disk: str | None = None   # the created/resized/removed slot


class VmDetailResponse(BaseModel):
    vmid: int
    name: str
    type: str             # "qemu" | "lxc"
    status: str           # "running" | "stopped" | "paused"
    node: str
    ip: str | None = None
    uptime: int = 0
    tags: list[str] = []
    is_template: bool = False
    cpu_usage: float | None = None   # None when stopped
    cpu_cores: int = 1
    mem_used: int | None = None      # bytes; None when stopped
    mem_total: int = 0               # bytes
    bios: str = ""
    ostype: str = ""
    networks: list[NetworkInterface] = []
    disks: list[DiskConfig] = []
    # PROJ-32: extended config fields (from existing vm_config call, no extra API call)
    cpu_type: str | None = None
    sockets: int | None = None
    onboot: bool | None = None
    protection: bool | None = None
    description: str | None = None
    lxc_hostname: str | None = None      # LXC only
    lxc_ostemplate: str | None = None    # LXC only
    # PROJ-48: portal DB node ID (FK on nodes table), needed for owner endpoints
    portal_node_id: int | None = None
    # PROJ-76 Phase 2b: {stack_id, stack_name} when this VM is stack-managed (else None)
    managed_by_stack: dict | None = None


# ── PROJ-32: Guest-Info & LXC-Interface models ────────────────────────────────

class FilesystemInfo(BaseModel):
    mountpoint: str
    total_bytes: int
    used_bytes: int
    fstype: str


class GuestInfoResponse(BaseModel):
    os_name: str | None = None
    os_version: str | None = None
    kernel: str | None = None
    arch: str | None = None
    hostname: str | None = None
    timezone: str | None = None
    timezone_offset: int | None = None   # seconds from UTC
    filesystems: list[FilesystemInfo] = []
    truncated_count: int = 0


class LxcNetworkInterface(BaseModel):
    name: str
    inet: str | None = None    # IPv4 with prefix, e.g. "192.168.1.10/24"
    inet6: str | None = None   # IPv6 with prefix
    hwaddr: str | None = None  # MAC address


class BackupFile(BaseModel):
    volid: str            # "local:backup/vzdump-qemu-100-..."
    filename: str         # "vzdump-qemu-100-..."
    created_at: int | None = None   # Unix timestamp
    size: int = 0         # bytes
    storage: str          # "local"


class BackupRetention(BaseModel):
    keep_last: int | None = Field(None, ge=0)
    keep_daily: int | None = Field(None, ge=0)
    keep_weekly: int | None = Field(None, ge=0)
    keep_monthly: int | None = Field(None, ge=0)

    def to_proxmox_param(self) -> str | None:
        """Serialize to Proxmox prune-backups string, e.g. 'keep-last=7,keep-daily=5'."""
        parts = []
        if self.keep_last is not None:
            parts.append(f"keep-last={self.keep_last}")
        if self.keep_daily is not None:
            parts.append(f"keep-daily={self.keep_daily}")
        if self.keep_weekly is not None:
            parts.append(f"keep-weekly={self.keep_weekly}")
        if self.keep_monthly is not None:
            parts.append(f"keep-monthly={self.keep_monthly}")
        return ",".join(parts) if parts else None

    @classmethod
    def from_proxmox_param(cls, value: str | None) -> "BackupRetention":
        """Parse a Proxmox prune-backups string back into structured fields."""
        if not value:
            return cls()
        if not isinstance(value, str):
            # Some PVE versions / API shapes may return this non-string; coerce defensively.
            value = str(value)
        result: dict[str, int] = {}
        for part in value.split(","):
            part = part.strip()
            if "=" in part:
                k, v = part.split("=", 1)
                mapping = {
                    "keep-last": "keep_last",
                    "keep-daily": "keep_daily",
                    "keep-weekly": "keep_weekly",
                    "keep-monthly": "keep_monthly",
                }
                if k in mapping:
                    try:
                        result[mapping[k]] = int(v)
                    except ValueError:
                        pass
        return cls(**result)


class BackupSchedule(BaseModel):
    """Datacenter-wide Proxmox backup job schedule. Additively extended for PROJ-78."""
    id: str
    schedule: str         # "0 2 * * *" or Proxmox calendar event
    storage: str
    mode: str             # "snapshot" | "stop" | "suspend"
    compress: str = ""    # "zstd" | "lzo" | "gzip" | "0"
    enabled: bool = True
    comment: str = ""
    # VM-selection fields (PROJ-78 — optional, absent in older API responses)
    vmid: str | None = None      # comma-separated VMID list
    pool: str | None = None      # Proxmox pool name
    all: int | None = None       # 1 = all guests
    exclude: str | None = None   # comma-separated VMIDs to exclude
    mailto: str | None = None    # email recipient
    retention: BackupRetention | None = None  # parsed from prune-backups


class BackupJobCreateRequest(BaseModel):
    """Request body for creating or fully replacing a Proxmox backup job (PROJ-78)."""
    schedule: str
    storage: str
    mode: Literal["snapshot", "stop", "suspend"] = "snapshot"
    compress: Literal["zstd", "lzo", "gzip", "0"] = "zstd"
    enabled: bool = True
    comment: str = ""
    mailto: str = ""
    # VM-selection: exactly one of all_vms, vmids, pool, or exclude must be set
    all_vms: bool = False
    vmids: str = ""     # comma-separated VMIDs, e.g. "100,101,102"
    pool: str = ""
    exclude: str = ""   # used with all_vms=True; comma-sep VMIDs to skip
    retention: BackupRetention = BackupRetention()

    def validate_selection(self) -> None:
        """Raise ValueError if no VM-selection mode is active."""
        if not self.all_vms and not self.vmids and not self.pool:
            raise ValueError("At least one VM-selection mode must be active (all, vmids, or pool)")

    def to_proxmox_params(self) -> dict:
        """Build the parameter dict for Proxmox POST/PUT /cluster/backup."""
        params: dict = {
            "schedule": self.schedule,
            "storage": self.storage,
            "mode": self.mode,
            "compress": self.compress,
            "enabled": 1 if self.enabled else 0,
        }
        if self.comment:
            params["comment"] = self.comment
        if self.mailto:
            params["mailto"] = self.mailto
        if self.all_vms:
            params["all"] = 1
            if self.exclude:
                params["exclude"] = self.exclude
        elif self.vmids:
            params["vmid"] = self.vmids
        elif self.pool:
            params["pool"] = self.pool
        prune = self.retention.to_proxmox_param()
        if prune:
            params["prune-backups"] = prune
        return params


class BackupJobUpdateRequest(BackupJobCreateRequest):
    """Request body for PUT /cluster/backup/{id}. Same fields as Create."""
    pass


class VmBackupsResponse(BaseModel):
    backups: list[BackupFile] = []
    schedules: list[BackupSchedule] = []
    storages: list[str] = []  # available backup storage names on this node


class BackupCreateRequest(BaseModel):
    storage: str
    mode: Literal["snapshot", "stop", "suspend"] = "snapshot"
    compress: Literal["zstd", "lzo", "gzip", "0"] = "zstd"


class BackupDeleteRequest(BaseModel):
    volid: str
    storage: str
