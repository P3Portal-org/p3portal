# p3portal.org
"""PROJ-80: Schemas für die cluster-weite SDN-Verwaltung (Zonen / VNets / Subnets).

Proxmox ist Single Source of Truth — es gibt keine DB-Tabelle. Diese Modelle
beschreiben nur die Request-/Response-Form und kapseln das Mapping auf die
Proxmox-Parameter sowie die serverseitige Validierung (422 vor Proxmox).

Unterschied zu PROJ-79 (Node-Netzwerk): SDN ist **cluster-weit** (Datacenter-
Ebene, kein ?node=), und Subnets sind in PVE **unter dem VNet genested**
(`/cluster/sdn/vnets/{vnet}/subnets`). Die PVE-Subnet-ID ist
`{zone}-{cidr-mit-Bindestrich}` (z. B. `zone1-10.0.0.0-24`).
"""
from __future__ import annotations

import ipaddress
import re

from pydantic import BaseModel, Field, field_validator, model_validator

# SDN object IDs: alphanumeric, must start with a letter, ≤ 8 chars (PVE limit, EC-8).
_SDN_ID_RE = re.compile(r"^[A-Za-z][A-Za-z0-9]{0,7}$")

# Plausible MTU band (soft warning outside, not a blocker).
_MTU_SOFT_MIN = 576
_MTU_SOFT_MAX = 9000


def _validate_cidr(value: str) -> None:
    """Raise ValueError if *value* is not a valid IPv4/IPv6 network CIDR (e.g. 10.0.0.0/24)."""
    ipaddress.ip_network(value, strict=False)


def _validate_ip(value: str) -> None:
    ipaddress.ip_address(value)  # raises ValueError on bad input


# ── Read models ──────────────────────────────────────────────────────────────

class SdnZone(BaseModel):
    """A single SDN zone as returned to the frontend."""
    id: str                          # zone id
    type: str                        # "simple" | "vlan" | (other types passed through read-only)
    mtu: int | None = None
    nodes: str | None = None         # comma/space separated node list
    bridge: str | None = None        # VLAN zone: the trunk bridge
    dns: str | None = None
    dnszone: str | None = None
    ipam: str | None = None
    pending: bool = False            # staged change not yet applied
    state: str | None = None         # "new" | "changed" | "deleted" (when pending)


class SdnVnet(BaseModel):
    id: str                          # vnet id
    zone: str | None = None
    tag: int | None = None           # VLAN tag (VLAN zones)
    alias: str | None = None
    vlanaware: bool = False
    pending: bool = False
    state: str | None = None


class SdnSubnet(BaseModel):
    id: str                          # PVE subnet id ({zone}-{cidr-dash})
    vnet: str | None = None
    cidr: str | None = None
    gateway: str | None = None
    snat: bool = False
    pending: bool = False
    state: str | None = None


class _SdnListBase(BaseModel):
    has_pending: bool = False
    sdn_unavailable: bool = False    # pve-sdn package missing / SDN not available (EC-7)
    permission_denied: bool = False
    cluster_unreachable: bool = False
    detail: str | None = None


class SdnZoneListResponse(_SdnListBase):
    items: list[SdnZone] = []


class SdnVnetListResponse(_SdnListBase):
    items: list[SdnVnet] = []


class SdnSubnetListResponse(_SdnListBase):
    items: list[SdnSubnet] = []


class SdnPendingResponse(BaseModel):
    has_pending: bool = False
    counts: dict[str, int] = {}      # {"zones": n, "vnets": n, "subnets": n}
    sdn_unavailable: bool = False
    cluster_unreachable: bool = False
    detail: str | None = None


class SdnUsageEntryVm(BaseModel):
    vmid: int
    name: str
    node: str
    kind: str                        # "qemu" | "lxc"


class SdnUsageResponse(BaseModel):
    """Usage of an SDN object before deletion (AC-DEL-1)."""
    id: str
    in_use: bool = False
    vms: list[SdnUsageEntryVm] = []          # VNet → guests referencing it (cluster-wide fan-out)
    vnets: list[str] = []                    # Zone → vnets in it
    subnets: list[str] = []                  # VNet → subnets attached to it
    incomplete: bool = False                 # best-effort: some VM configs unread


class SdnWriteResponse(BaseModel):
    id: str
    warnings: list[str] = []


class SdnBridgesResponse(BaseModel):
    """Bridge names available across the cluster (for the VLAN-zone bridge picker).

    SDN is cluster-wide, so this is the union of the Linux/OVS bridges found on
    the online cluster nodes (best-effort; ``incomplete`` if a node could not be
    read). Never 500 — empty list + flag instead.
    """
    bridges: list[str] = []
    incomplete: bool = False


# ── Write requests ───────────────────────────────────────────────────────────

class SdnZoneWriteRequest(BaseModel):
    """Create or fully edit an SDN zone (Simple or VLAN).

    Same body for POST (create) and PUT (update); the router supplies the zone id
    from the path on update. ``type`` is immutable in PVE and is therefore only
    sent on create (``to_proxmox_params(for_update=True)`` omits it).
    """
    type: str                        # "simple" | "vlan"
    zone: str
    mtu: int | None = Field(default=None, ge=128, le=65520)  # hard bounds; soft 576-9000
    nodes: str | None = None
    bridge: str | None = None        # required for VLAN zones (AC-CZ-2)
    dns: str | None = None
    dnszone: str | None = None
    ipam: str | None = None

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in ("simple", "vlan"):
            raise ValueError("type must be 'simple' or 'vlan'")
        return v

    @field_validator("zone")
    @classmethod
    def _valid_zone_id(cls, v: str) -> str:
        if not _SDN_ID_RE.match(v):
            raise ValueError(
                f"Invalid zone id {v!r}: must start with a letter, be alphanumeric and ≤ 8 chars"
            )
        return v

    @model_validator(mode="after")
    def _type_specific(self) -> "SdnZoneWriteRequest":
        if self.type == "vlan" and not (self.bridge and self.bridge.strip()):
            raise ValueError("VLAN zone requires a 'bridge'")
        return self

    def soft_warnings(self) -> list[str]:
        warnings: list[str] = []
        if self.mtu is not None and not (_MTU_SOFT_MIN <= self.mtu <= _MTU_SOFT_MAX):
            warnings.append(f"MTU {self.mtu} is outside the typical range {_MTU_SOFT_MIN}-{_MTU_SOFT_MAX}")
        return warnings

    def to_proxmox_params(self, for_update: bool = False) -> dict:
        """Map to the Proxmox /cluster/sdn/zones parameter dict.

        On create the router adds ``zone`` (id) explicitly. ``type`` is immutable,
        so it is only sent on create.
        """
        params: dict = {}
        if not for_update:
            params["type"] = self.type
        if self.mtu is not None:
            params["mtu"] = self.mtu
        if self.nodes:
            params["nodes"] = self.nodes
        if self.type == "vlan" and self.bridge:
            params["bridge"] = self.bridge
        if self.dns:
            params["dns"] = self.dns
        if self.dnszone:
            params["dnszone"] = self.dnszone
        if self.ipam:
            params["ipam"] = self.ipam
        return params


class SdnVnetWriteRequest(BaseModel):
    """Create or fully edit an SDN VNet.

    ``tag`` is required when the parent zone is a VLAN zone — the router enforces
    that (it knows the zone type from the zone list, EC-9); here we only range-check.
    """
    vnet: str
    zone: str
    tag: int | None = Field(default=None, ge=1, le=4094)
    alias: str | None = None
    vlanaware: bool = False

    @field_validator("vnet")
    @classmethod
    def _valid_vnet_id(cls, v: str) -> str:
        if not _SDN_ID_RE.match(v):
            raise ValueError(
                f"Invalid vnet id {v!r}: must start with a letter, be alphanumeric and ≤ 8 chars"
            )
        return v

    @field_validator("zone")
    @classmethod
    def _valid_zone(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("zone is required")
        return v

    def to_proxmox_params(self, for_update: bool = False) -> dict:
        """Map to the Proxmox /cluster/sdn/vnets parameter dict.

        On create the router adds ``vnet`` (id) explicitly. ``zone`` is sent on both
        create and update (PVE allows reassigning a VNet's zone).
        """
        params: dict = {"zone": self.zone}
        if self.tag is not None:
            params["tag"] = self.tag
        if self.alias:
            params["alias"] = self.alias
        params["vlanaware"] = 1 if self.vlanaware else 0
        return params


class SdnSubnetWriteRequest(BaseModel):
    """Create or fully edit an SDN subnet (always nested under a VNet)."""
    vnet: str
    cidr: str
    gateway: str | None = None
    snat: bool = False

    @field_validator("vnet")
    @classmethod
    def _valid_vnet(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("vnet is required")
        return v

    @field_validator("cidr")
    @classmethod
    def _valid_cidr(cls, v: str) -> str:
        try:
            _validate_cidr(v)
        except ValueError:
            raise ValueError(f"Invalid CIDR: {v!r} (expected e.g. 10.0.0.0/24)")
        return v

    @field_validator("gateway")
    @classmethod
    def _valid_gateway(cls, v: str | None) -> str | None:
        if v:
            try:
                _validate_ip(v)
            except ValueError:
                raise ValueError(f"Invalid gateway IP: {v!r}")
        return v

    def soft_warnings(self) -> list[str]:
        """Non-blocking advisory: gateway outside the subnet."""
        warnings: list[str] = []
        if self.cidr and self.gateway:
            try:
                net = ipaddress.ip_network(self.cidr, strict=False)
                gw = ipaddress.ip_address(self.gateway)
                if gw not in net:
                    warnings.append(f"gateway {self.gateway} is outside subnet {net}")
            except ValueError:
                pass
        return warnings

    def to_proxmox_params(self, for_update: bool = False) -> dict:
        """Map to the Proxmox /cluster/sdn/vnets/{vnet}/subnets parameter dict.

        On create PVE wants ``subnet`` (the CIDR) + ``type=subnet``; on update the
        subnet id is in the path so neither is sent again.
        """
        params: dict = {}
        if not for_update:
            params["type"] = "subnet"
            params["subnet"] = self.cidr
        if self.gateway:
            params["gateway"] = self.gateway
        params["snat"] = 1 if self.snat else 0
        return params
