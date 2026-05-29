# p3portal.org
from __future__ import annotations

from pydantic import BaseModel


class NodeInfo(BaseModel):
    node: str
    status: str           # "online" | "offline"
    cpu: float = 0.0      # fraction 0.0–1.0
    maxcpu: int = 0
    mem: int = 0          # bytes used
    maxmem: int = 0       # bytes total
    disk: int = 0         # bytes used
    maxdisk: int = 0      # bytes total
    uptime: int = 0       # seconds
    portal_node_name: str | None = None  # PROJ-30: Portal-Node-Name (z.B. "Production"); None im Single-Node-Betrieb
    portal_node_id: int | None = None    # PROJ-73: Portal-DB-Node-ID für Updates-Tab; None im Single-Node-Betrieb ohne konfigurierte Node
    response_time_ms: float | None = None  # Letzte Cache-Fetch-Dauer in ms; None für Proxmox-Login-User


class VmInfo(BaseModel):
    vmid: int
    name: str | None = None
    type: str             # "qemu" | "lxc"
    status: str           # "running" | "stopped" | "paused"
    node: str
    cpu: float = 0.0
    maxcpu: int = 0
    mem: int = 0
    maxmem: int = 0
    uptime: int = 0
    template: int = 0     # 1 wenn Proxmox-Template, sonst 0
    ctime: int | None = None  # Unix-Timestamp der Erstellung (aus VM-Config meta-Feld)
    ip: str | None = None  # erste nicht-loopback IPv4 (via Guest-Agent / LXC-Interfaces); None wenn nicht verfügbar
    permissions: list[str] | None = None  # None = full access (admin/proxmox); list = allowed actions for local users
    portal_node_name: str | None = None  # PROJ-30: Name der Portal-Registrierung; None im Single-Node-Betrieb
    portal_node_id: int | None = None    # PROJ-48: portal DB node ID (FK on nodes table); None im Single-Node-Betrieb


class ClusterStatusResponse(BaseModel):
    quorum: bool
    node_count: int
    ha_status: str        # "active" | "inactive" | "none"
    unreachable_nodes: list[str] = []  # PROJ-30: Portal-Node-Namen die nicht erreichbar waren
