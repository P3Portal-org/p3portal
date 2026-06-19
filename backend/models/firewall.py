# p3portal.org
"""PROJ-90: Schemas für die Proxmox-Firewall-Verwaltung (Datacenter / Node / Gast).

Proxmox ist Single Source of Truth — es gibt **keine DB-Tabelle**. Diese Modelle
beschreiben nur die Request-/Response-Form und kapseln das Mapping auf die
Proxmox-Parameter sowie die serverseitige Validierung (422 vor Proxmox).

Die Firewall greift **live** (der pve-firewall-Dienst beobachtet /etc/pve/firewall/) —
es gibt kein Pending/Apply wie bei PROJ-79/80. Regeln sind positions-indiziert
(``pos``); Umsortieren nutzt Proxmox' natives ``moveto`` (siehe Router).

Read-Parsing (PVE-Versions-Drift) passiert im Router via ``_s``/``_i``/``_b``;
diese Modelle halten nur die Felder und die Schreib-Validatoren.
"""
from __future__ import annotations

import ipaddress
import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Proxmox firewall object names (security groups / ipsets / aliases): must start
# with a letter, then alphanumeric / dash / underscore (EC-12).
_FW_NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")

_RULE_TYPES = {"in", "out", "group"}
_RULE_ACTIONS = {"ACCEPT", "DROP", "REJECT"}
_POLICY_VALUES = {"ACCEPT", "DROP", "REJECT"}


def _addr_token_ok(token: str) -> bool:
    """Is a single source/dest token a valid IP / CIDR / range / alias / +ipset?

    Lenient by design — Proxmox does the authoritative validation; we only catch
    obvious typos. Accepts: ``+ipsetname``, an alias name, a bare IP, a CIDR, or an
    ``a-b`` IP range.
    """
    token = token.strip()
    if not token:
        return False
    if token.startswith("+"):  # ipset reference
        return bool(_FW_NAME_RE.match(token[1:]))
    if _FW_NAME_RE.match(token):  # alias name (existence is router's pre-check)
        return True
    try:
        ipaddress.ip_network(token, strict=False)  # bare IP or CIDR
        return True
    except ValueError:
        pass
    if "-" in token:  # IP range a-b
        a, _, b = token.partition("-")
        try:
            ipaddress.ip_address(a.strip())
            ipaddress.ip_address(b.strip())
            return True
        except ValueError:
            return False
    try:
        ipaddress.ip_address(token)
        return True
    except ValueError:
        return False


def _validate_addr_spec(value: str | None, field: str) -> str | None:
    if value is None or value.strip() == "":
        return None
    for token in value.split(","):
        if not _addr_token_ok(token):
            raise ValueError(
                f"Invalid {field} segment {token.strip()!r} "
                "(expected IP / CIDR / range / alias name / +ipset)"
            )
    return value


# ── Shared rule helpers (reused by FirewallRuleWriteRequest + PROJ-91 StackFirewallRule) ──

def validate_rule_semantics(
    rule_type: str,
    action: str | None,
    macro: str | None,
    proto: str | None,
    sport: str | None,
    dport: str | None,
) -> None:
    """Shared firewall-rule semantics (AC-RULE-1/2).

    Action depends on direction (a ``group`` rule's action is a security-group
    name; ``in``/``out`` need ACCEPT/DROP/REJECT), and ``macro`` is mutually
    exclusive with explicit proto/ports (EC-4). Raised by both the PROJ-90
    imperative request model and the PROJ-91 declarative stack rule so the rules
    behave identically in both paths. Raises ValueError on violation.
    """
    if rule_type == "group":
        if not (action and action.strip()):
            raise ValueError("group rule requires a security-group name as action")
    else:  # in / out
        if action not in _RULE_ACTIONS:
            raise ValueError(f"action must be one of {sorted(_RULE_ACTIONS)} for in/out rules")
    if macro and (proto or sport or dport):
        raise ValueError(
            "macro and explicit proto/sport/dport are mutually exclusive "
            "(a macro already defines protocol and ports)"
        )


def rule_to_proxmox_params(rule, *, with_pos: bool = False) -> dict:
    """Map a firewall-rule object → the Proxmox firewall rule parameter dict.

    Duck-typed on the rule's attributes so it serves both ``FirewallRuleWriteRequest``
    (PROJ-90, optional ``pos``) and ``StackFirewallRule`` (PROJ-91, no ``pos`` —
    declarative list order). Booleans → 0/1; ``icmp_type`` → ``icmp-type``.
    """
    params: dict = {
        "type": rule.type,
        "action": rule.action,
        "enable": 1 if rule.enable else 0,
    }
    if rule.macro:
        params["macro"] = rule.macro
    if rule.source:
        params["source"] = rule.source
    if rule.dest:
        params["dest"] = rule.dest
    if rule.proto:
        params["proto"] = rule.proto
    if rule.sport:
        params["sport"] = rule.sport
    if rule.dport:
        params["dport"] = rule.dport
    if rule.iface:
        params["iface"] = rule.iface
    if rule.log:
        params["log"] = rule.log
    if rule.comment is not None:
        params["comment"] = rule.comment
    if rule.icmp_type:
        params["icmp-type"] = rule.icmp_type
    if with_pos and getattr(rule, "pos", None) is not None:
        params["pos"] = rule.pos
    return params


# ── Shared list/options flags (never-500 reads, Muster SDN) ───────────────────

class _FwFlags(BaseModel):
    permission_denied: bool = False     # AC-LIST-4 / AC-RBAC-3 (read lacks privilege)
    node_unreachable: bool = False      # AC-LIST-5 (node offline / connection error)
    detail: str | None = None


# ── Rules (read) ──────────────────────────────────────────────────────────────

class FirewallRule(BaseModel):
    """A single firewall rule as returned to the frontend (any level)."""
    pos: int
    type: str                            # "in" | "out" | "group"
    action: str                          # "ACCEPT"|"DROP"|"REJECT" or a security-group name
    enable: bool = True
    macro: str | None = None
    source: str | None = None
    dest: str | None = None
    proto: str | None = None
    sport: str | None = None
    dport: str | None = None
    iface: str | None = None
    log: str | None = None
    comment: str | None = None
    icmp_type: str | None = None
    ipversion: int | None = None


class FirewallRulesResponse(_FwFlags):
    rules: list[FirewallRule] = []


# ── Rules (write) ─────────────────────────────────────────────────────────────

class FirewallRuleWriteRequest(BaseModel):
    """Create or fully edit a firewall rule (any level).

    Macro and explicit proto/port are mutually exclusive (EC-4): a macro already
    defines protocol + ports. ``pos`` (POST only) inserts at a position; omit to
    append. Moving an existing rule uses the dedicated move endpoint (``moveto``).
    """
    type: str
    action: str
    enable: bool = True
    macro: str | None = None
    source: str | None = None
    dest: str | None = None
    proto: str | None = None
    sport: str | None = None
    dport: str | None = None
    iface: str | None = None
    log: str | None = None
    comment: str | None = None
    icmp_type: str | None = None
    pos: int | None = Field(default=None, ge=0)

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in _RULE_TYPES:
            raise ValueError(f"type must be one of {sorted(_RULE_TYPES)}")
        return v

    @field_validator("source")
    @classmethod
    def _valid_source(cls, v: str | None) -> str | None:
        return _validate_addr_spec(v, "source")

    @field_validator("dest")
    @classmethod
    def _valid_dest(cls, v: str | None) -> str | None:
        return _validate_addr_spec(v, "dest")

    @model_validator(mode="after")
    def _semantics(self) -> "FirewallRuleWriteRequest":
        validate_rule_semantics(
            self.type, self.action, self.macro, self.proto, self.sport, self.dport
        )
        return self

    def to_proxmox_params(self, *, with_pos: bool = False) -> dict:
        """Map to the Proxmox firewall rule parameter dict (booleans → 0/1)."""
        return rule_to_proxmox_params(self, with_pos=with_pos)


class FirewallRuleMoveRequest(BaseModel):
    """Move an existing rule to a new position (Proxmox-native ``moveto``)."""
    moveto: int = Field(..., ge=0)


# ── Options (read + write), per level ─────────────────────────────────────────

class DcFirewallOptionsResponse(_FwFlags):
    """Datacenter firewall options. ``enable`` is read-only (Entscheidung #4)."""
    enable: bool | None = None           # read-only display; not settable via this API
    policy_in: str | None = None
    policy_out: str | None = None
    log_ratelimit: str | None = None
    ebtables: bool | None = None


class DcFirewallOptionsUpdate(BaseModel):
    """Editable datacenter options — **no** ``enable`` (read-only, 422 on extra)."""
    model_config = ConfigDict(extra="forbid")

    policy_in: str | None = None
    policy_out: str | None = None
    log_ratelimit: str | None = None
    ebtables: bool | None = None

    @field_validator("policy_in", "policy_out")
    @classmethod
    def _valid_policy(cls, v: str | None) -> str | None:
        if v is not None and v not in _POLICY_VALUES:
            raise ValueError(f"policy must be one of {sorted(_POLICY_VALUES)}")
        return v

    def to_proxmox_params(self) -> dict:
        params: dict = {}
        if self.policy_in is not None:
            params["policy_in"] = self.policy_in
        if self.policy_out is not None:
            params["policy_out"] = self.policy_out
        if self.log_ratelimit is not None:
            params["log_ratelimit"] = self.log_ratelimit
        if self.ebtables is not None:
            params["ebtables"] = 1 if self.ebtables else 0
        return params


class NodeFirewallOptionsResponse(_FwFlags):
    enable: bool | None = None
    log_level_in: str | None = None
    log_level_out: str | None = None
    smurf_log_level: str | None = None
    tcp_flags_log_level: str | None = None
    nf_conntrack_max: int | None = None
    nf_conntrack_tcp_timeout_established: int | None = None
    ndp: bool | None = None
    nosmurfs: bool | None = None
    global_firewall_enabled: bool | None = None   # EC-1 / AC-HINT-1 (best-effort)


class NodeFirewallOptionsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enable: bool | None = None
    log_level_in: str | None = None
    log_level_out: str | None = None
    smurf_log_level: str | None = None
    tcp_flags_log_level: str | None = None
    nf_conntrack_max: int | None = Field(default=None, ge=0)
    nf_conntrack_tcp_timeout_established: int | None = Field(default=None, ge=0)
    ndp: bool | None = None
    nosmurfs: bool | None = None

    def to_proxmox_params(self) -> dict:
        params: dict = {}
        if self.enable is not None:
            params["enable"] = 1 if self.enable else 0
        for f in ("log_level_in", "log_level_out", "smurf_log_level", "tcp_flags_log_level"):
            val = getattr(self, f)
            if val is not None:
                params[f] = val
        if self.nf_conntrack_max is not None:
            params["nf_conntrack_max"] = self.nf_conntrack_max
        if self.nf_conntrack_tcp_timeout_established is not None:
            params["nf_conntrack_tcp_timeout_established"] = self.nf_conntrack_tcp_timeout_established
        if self.ndp is not None:
            params["ndp"] = 1 if self.ndp else 0
        if self.nosmurfs is not None:
            params["nosmurfs"] = 1 if self.nosmurfs else 0
        return params


class GuestFirewallOptionsResponse(_FwFlags):
    enable: bool | None = None
    dhcp: bool | None = None
    macfilter: bool | None = None
    ndp: bool | None = None
    radv: bool | None = None
    ipfilter: bool | None = None
    policy_in: str | None = None
    policy_out: str | None = None
    log_level_in: str | None = None
    log_level_out: str | None = None
    global_firewall_enabled: bool | None = None   # EC-1 / AC-HINT-1 (best-effort)


class GuestFirewallOptionsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enable: bool | None = None
    dhcp: bool | None = None
    macfilter: bool | None = None
    ndp: bool | None = None
    radv: bool | None = None
    ipfilter: bool | None = None
    policy_in: str | None = None
    policy_out: str | None = None
    log_level_in: str | None = None
    log_level_out: str | None = None

    @field_validator("policy_in", "policy_out")
    @classmethod
    def _valid_policy(cls, v: str | None) -> str | None:
        if v is not None and v not in _POLICY_VALUES:
            raise ValueError(f"policy must be one of {sorted(_POLICY_VALUES)}")
        return v

    def to_proxmox_params(self) -> dict:
        params: dict = {}
        for f in ("enable", "dhcp", "macfilter", "ndp", "radv", "ipfilter"):
            val = getattr(self, f)
            if val is not None:
                params[f] = 1 if val else 0
        for f in ("policy_in", "policy_out", "log_level_in", "log_level_out"):
            val = getattr(self, f)
            if val is not None:
                params[f] = val
        return params


# ── Security Groups ───────────────────────────────────────────────────────────

class SecurityGroup(BaseModel):
    group: str
    comment: str | None = None
    digest: str | None = None


class SecurityGroupListResponse(_FwFlags):
    items: list[SecurityGroup] = []


class SecurityGroupCreateRequest(BaseModel):
    group: str
    comment: str | None = None

    @field_validator("group")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        if not _FW_NAME_RE.match(v):
            raise ValueError(
                f"Invalid security-group name {v!r}: must start with a letter and "
                "contain only letters, digits, '-' or '_'"
            )
        return v

    def to_proxmox_params(self) -> dict:
        params: dict = {"group": self.group}
        if self.comment:
            params["comment"] = self.comment
        return params


# ── IPSets ────────────────────────────────────────────────────────────────────

class IpSet(BaseModel):
    name: str
    comment: str | None = None


class IpSetEntry(BaseModel):
    cidr: str
    nomatch: bool = False
    comment: str | None = None


class IpSetListResponse(_FwFlags):
    items: list[IpSet] = []


class IpSetEntriesResponse(_FwFlags):
    entries: list[IpSetEntry] = []


class IpSetCreateRequest(BaseModel):
    name: str
    comment: str | None = None

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        if not _FW_NAME_RE.match(v):
            raise ValueError(
                f"Invalid IPSet name {v!r}: must start with a letter and contain "
                "only letters, digits, '-' or '_'"
            )
        return v

    def to_proxmox_params(self) -> dict:
        params: dict = {"name": self.name}
        if self.comment:
            params["comment"] = self.comment
        return params


class IpSetEntryRequest(BaseModel):
    cidr: str
    nomatch: bool = False
    comment: str | None = None

    @field_validator("cidr")
    @classmethod
    def _valid_cidr(cls, v: str) -> str:
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError:
            raise ValueError(f"Invalid IP/CIDR: {v!r}")
        return v

    def to_proxmox_params(self) -> dict:
        params: dict = {"cidr": self.cidr}
        if self.nomatch:
            params["nomatch"] = 1
        if self.comment:
            params["comment"] = self.comment
        return params


# ── Aliases ───────────────────────────────────────────────────────────────────

class FirewallAlias(BaseModel):
    name: str
    cidr: str | None = None
    comment: str | None = None
    ipversion: int | None = None


class AliasListResponse(_FwFlags):
    items: list[FirewallAlias] = []


class AliasWriteRequest(BaseModel):
    """Create or fully edit an alias (name + IP/CIDR + optional comment)."""
    name: str
    cidr: str
    comment: str | None = None

    @field_validator("name")
    @classmethod
    def _valid_name(cls, v: str) -> str:
        if not _FW_NAME_RE.match(v):
            raise ValueError(
                f"Invalid alias name {v!r}: must start with a letter and contain "
                "only letters, digits, '-' or '_'"
            )
        return v

    @field_validator("cidr")
    @classmethod
    def _valid_cidr(cls, v: str) -> str:
        try:
            ipaddress.ip_network(v, strict=False)
        except ValueError:
            raise ValueError(f"Invalid IP/CIDR: {v!r}")
        return v

    def to_proxmox_params(self, *, for_update: bool = False) -> dict:
        # On create PVE wants both name and cidr; on update the name is in the path
        # and PVE expects the new value under ``cidr`` (rename via ``rename`` is OOS).
        params: dict = {"cidr": self.cidr}
        if not for_update:
            params["name"] = self.name
        if self.comment is not None:
            params["comment"] = self.comment
        return params


# ── Macros / Refs (read-only, rule-editor dropdowns) ──────────────────────────

class FirewallMacro(BaseModel):
    macro: str
    descr: str | None = None


class FirewallRef(BaseModel):
    type: str                            # "alias" | "ipset"
    name: str
    ref: str | None = None
    comment: str | None = None


# ── Usage (SG / IPSet / Alias deletion check, cluster-wide fan-out) ───────────

class FirewallUsageEntry(BaseModel):
    level: str                           # "datacenter" | "node" | "guest"
    node: str | None = None
    vmid: int | None = None
    kind: str | None = None              # "qemu" | "lxc"
    group: str | None = None             # set when the referencing rule lives in a security group
    pos: int
    rule: str                            # human-readable rule summary


class FirewallUsageResponse(BaseModel):
    kind: str                            # "group" | "ipset" | "alias"
    name: str
    in_use: bool = False
    usages: list[FirewallUsageEntry] = []
    incomplete: bool = False             # best-effort: some configs could not be read
