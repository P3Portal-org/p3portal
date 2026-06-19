# p3portal.org
#
# ── REFERENCE ONLY — NOT APPLICATION CODE ────────────────────────────────────
# PROJ-89 bpg-bump SDN probe. Hand-written reference for Spike step 3 (see
# docs/sdn-bpg-bump-spike.md): verify bpg 0.109 SDN resources against a real
# Proxmox cluster — does the cluster-wide PUT /cluster/sdn fire only via the
# applier (so zone/vnet/subnet stay "pending" without it)?
#
# Attribute names + types are CONFIRMED against the real bpg-0.109 provider
# schema (S654, data/bpg-0109-schema.json). What still needs a real apply to
# observe: the pending-vs-committed behaviour and any value semantics.
#
# In the product, SDN would be *generated* from the structured P3 stack model
# (PROJ-89 transpile), never hand-written.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_providers {
    proxmox = {
      source  = "bpg/proxmox"
      version = "~> 0.109"
    }
  }
}

# No inline credentials — provider reads PROXMOX_VE_ENDPOINT / PROXMOX_VE_API_TOKEN
# / PROXMOX_VE_INSECURE from the env. The token needs SDN.Allocate (PortalAdmin
# has it since PROJ-80/S598; PortalTofu does NOT yet — a PROJ-89 setup item).
provider "proxmox" {}

# ── Zone (cluster-wide). MVP scope = Simple or VLAN. ──────────────────────────
resource "proxmox_virtual_environment_sdn_zone_simple" "probe" {
  id    = "p3probe"   # zone id, <=8 chars
  nodes = ["pve"]     # set(string) — real node name(s)
  ipam  = "pve"
}

# ── VNet (cluster-wide, references the zone) ──────────────────────────────────
resource "proxmox_virtual_environment_sdn_vnet" "probe" {
  id   = "p3vnet"
  zone = proxmox_virtual_environment_sdn_zone_simple.probe.id
  # tag = 100        # number — only for VLAN/QinQ zones, omit for Simple
}

# ── Subnet (gateway + SNAT — confirmed: snat is a bool attribute in 0.109) ─────
resource "proxmox_virtual_environment_sdn_subnet" "probe" {
  vnet    = proxmox_virtual_environment_sdn_vnet.probe.id
  cidr    = "10.99.0.0/24"  # subnet id is computed as "<zone>-<cidr>"
  gateway = "10.99.0.1"
  snat    = true            # → the internet-egress mechanism PROJ-89 wants
}

# ── Applier (THE global-apply gate) ───────────────────────────────────────────
# 0.109 replaces the old double-applier hack with on_create/on_destroy (bool):
# the cluster-wide PUT /cluster/sdn fires when this resource is created/destroyed.
#
# Gate observation: comment this resource OUT and apply only zone/vnet/subnet →
# they must stay *pending* in the PVE UI (not committed cluster-wide). Then add
# it back → PVE SDN is committed on ALL nodes (incl. any manual PROJ-80 pending
# changes — irreducible; engine._SDN_APPLY_LOCK must serialize this in PROJ-89).
resource "proxmox_virtual_environment_sdn_applier" "probe" {
  depends_on = [proxmox_virtual_environment_sdn_subnet.probe]
  on_create  = true
  on_destroy = true
}
