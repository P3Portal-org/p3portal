# p3portal.org
"""PROJ-79: Schemas für die Node-Netzwerk-Verwaltung (Bridges & VLANs).

Proxmox ist Single Source of Truth — es gibt keine DB-Tabelle. Diese Modelle
beschreiben nur die Request-/Response-Form und kapseln das Mapping auf die
Proxmox-Parameter sowie die serverseitige Validierung (422 vor Proxmox).
"""
from __future__ import annotations

import ipaddress
import re

from pydantic import BaseModel, Field, field_validator, model_validator

# Interface-Namen
_BRIDGE_NAME_RE = re.compile(r"^vmbr\d{1,4}$")
# VLAN-Interface: <raw-device>.<vid>  (z. B. vmbr0.100, eth0.100, bond0.100)
#                 oder freier Name (z. B. vlan100) wenn Raw-Device + Tag separat gesetzt sind
_VLAN_NAME_RE = re.compile(r"^[A-Za-z][\w.\-]{0,14}$")

# Plausible MTU-Bandbreite (weiche Warnung außerhalb, kein Blocker — EC-11)
_MTU_SOFT_MIN = 576
_MTU_SOFT_MAX = 9000


def _validate_cidr(value: str) -> None:
    """Raise ValueError if *value* is not a valid IPv4/IPv6 CIDR (e.g. 10.0.0.1/24)."""
    ipaddress.ip_interface(value)  # raises ValueError on bad input


def _validate_ip(value: str) -> None:
    ipaddress.ip_address(value)  # raises ValueError on bad input


class NetworkInterface(BaseModel):
    """A single node network interface as returned to the frontend."""
    iface: str
    type: str                       # "bridge" | "vlan" | (other, passed through read-only)
    method: str | None = None       # static | manual | dhcp
    cidr: str | None = None
    gateway: str | None = None
    cidr6: str | None = None
    gateway6: str | None = None
    mtu: int | None = None
    autostart: bool = False
    comments: str | None = None
    active: bool | None = None       # currently applied/up (soweit PVE liefert)
    pending: bool = False            # staged change not yet reloaded
    # bridge-specific
    bridge_ports: list[str] = []
    bridge_vlan_aware: bool = False
    bridge_vids: str | None = None
    # vlan-specific
    vlan_raw_device: str | None = None
    vlan_id: int | None = None


class NetworkListResponse(BaseModel):
    interfaces: list[NetworkInterface] = []
    has_pending: bool = False
    permission_denied: bool = False
    node_unreachable: bool = False
    detail: str | None = None


class NetworkUsageEntry(BaseModel):
    vmid: int
    name: str
    node: str
    kind: str   # "qemu" | "lxc"


class NetworkUsageResponse(BaseModel):
    iface: str
    in_use: bool = False
    usages: list[NetworkUsageEntry] = []
    incomplete: bool = False   # True if some VM configs could not be checked (best-effort)


class NetworkWriteResponse(BaseModel):
    iface: str
    warnings: list[str] = []


class NetworkIfaceWriteRequest(BaseModel):
    """Create or fully edit a bridge or VLAN interface.

    Same body for POST (create) and PUT (update); the router supplies the iface
    name from the path on update.
    """
    type: str                       # "bridge" | "vlan"
    iface: str
    # common
    cidr: str | None = None
    gateway: str | None = None
    cidr6: str | None = None
    gateway6: str | None = None
    mtu: int | None = Field(default=None, ge=128, le=65520)  # hard bounds; soft range 576-9000
    autostart: bool = False
    comments: str | None = None
    # bridge-specific
    bridge_ports: list[str] = []
    bridge_vlan_aware: bool = False
    bridge_vids: str | None = None
    # vlan-specific
    vlan_raw_device: str | None = None
    vlan_id: int | None = Field(default=None, ge=1, le=4094)

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in ("bridge", "vlan"):
            raise ValueError("type must be 'bridge' or 'vlan'")
        return v

    @field_validator("cidr", "cidr6")
    @classmethod
    def _valid_cidr(cls, v: str | None) -> str | None:
        if v:
            try:
                _validate_cidr(v)
            except ValueError:
                raise ValueError(f"Invalid CIDR: {v!r} (expected e.g. 10.0.0.1/24)")
        return v

    @field_validator("gateway", "gateway6")
    @classmethod
    def _valid_gateway(cls, v: str | None) -> str | None:
        if v:
            try:
                _validate_ip(v)
            except ValueError:
                raise ValueError(f"Invalid gateway IP: {v!r}")
        return v

    @field_validator("bridge_vids")
    @classmethod
    def _valid_vids(cls, v: str | None) -> str | None:
        if not v:
            return v
        # accept space/comma separated single VIDs and ranges: "2-4094 10 20-30"
        tokens = re.split(r"[\s,]+", v.strip())
        for tok in tokens:
            if not tok:
                continue
            if not re.fullmatch(r"\d{1,4}(-\d{1,4})?", tok):
                raise ValueError(f"Invalid VLAN VIDs token: {tok!r} (use e.g. '2-4094' or '10 20')")
        return v

    @model_validator(mode="after")
    def _type_specific(self) -> "NetworkIfaceWriteRequest":
        if self.type == "bridge":
            if not _BRIDGE_NAME_RE.match(self.iface):
                raise ValueError(f"Bridge name must match vmbrN (got {self.iface!r})")
        else:  # vlan
            if not _VLAN_NAME_RE.match(self.iface):
                raise ValueError(f"Invalid VLAN interface name: {self.iface!r}")
            # Either the name encodes <dev>.<vid>, or raw-device + tag are given explicitly.
            has_dotted = "." in self.iface and self.iface.rsplit(".", 1)[1].isdigit()
            if not has_dotted and (not self.vlan_raw_device or self.vlan_id is None):
                raise ValueError(
                    "VLAN needs either a <device>.<vid> name or both vlan_raw_device and vlan_id"
                )
        return self

    def soft_warnings(self) -> list[str]:
        """Non-blocking advisories (EC-10/11): gateway outside subnet, MTU outside 576-9000."""
        warnings: list[str] = []
        if self.cidr and self.gateway:
            try:
                net = ipaddress.ip_interface(self.cidr).network
                gw = ipaddress.ip_address(self.gateway)
                if gw not in net:
                    warnings.append(f"gateway {self.gateway} is outside subnet {net}")
            except ValueError:
                pass
        if self.mtu is not None and not (_MTU_SOFT_MIN <= self.mtu <= _MTU_SOFT_MAX):
            warnings.append(f"MTU {self.mtu} is outside the typical range {_MTU_SOFT_MIN}-{_MTU_SOFT_MAX}")
        return warnings

    def to_proxmox_params(self) -> dict:
        """Map to the Proxmox POST/PUT /nodes/{node}/network parameter dict.

        No free string building — every field is placed explicitly. Boolean flags
        become 0/1 as Proxmox expects.
        """
        params: dict = {
            "type": self.type,
            "autostart": 1 if self.autostart else 0,
        }
        if self.cidr:
            params["cidr"] = self.cidr
        if self.gateway:
            params["gateway"] = self.gateway
        if self.cidr6:
            params["cidr6"] = self.cidr6
        if self.gateway6:
            params["gateway6"] = self.gateway6
        if self.mtu is not None:
            params["mtu"] = self.mtu
        if self.comments:
            params["comments"] = self.comments

        if self.type == "bridge":
            # bridge_ports is a space-separated string; omit when empty.
            ports = [p for p in self.bridge_ports if p]
            if ports:
                params["bridge_ports"] = " ".join(ports)
            params["bridge_vlan_aware"] = 1 if self.bridge_vlan_aware else 0
            if self.bridge_vlan_aware and self.bridge_vids:
                params["bridge_vids"] = self.bridge_vids
        else:  # vlan
            if self.vlan_raw_device:
                params["vlan-raw-device"] = self.vlan_raw_device
            if self.vlan_id is not None:
                params["vlan-id"] = self.vlan_id

        return params
