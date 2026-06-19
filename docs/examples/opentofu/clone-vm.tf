# p3portal.org
#
# ── REFERENCE ONLY — NOT APPLICATION CODE ────────────────────────────────────
# Stacks engine lifecycle proof. Hand-written reference Terraform/OpenTofu
# config used to validate the engine plumbing (binary, offline provider mirror,
# per-node token via env, native state encryption, apply/plan/destroy, drift)
# against a real Proxmox host. See docs/opentofu-foundation.md for the runbook.
#
# In the product, this kind of config is *generated* from the structured P3
# stack model at deploy time (Phase 2b, as .tf.json). Do not edit a real stack
# by hand-writing HCL — this file exists purely as a manual verification aid.
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_providers {
    proxmox = {
      source = "bpg/proxmox"
      # Must match the version mirrored into the Plus image
      # (build ARG BPG_PROVIDER_VERSION). Resolved from /opt/tofu/plugin-mirror.
      version = "~> 0.109"
    }
  }
}

# No inline credentials: the bpg provider reads PROXMOX_VE_ENDPOINT,
# PROXMOX_VE_API_TOKEN and PROXMOX_VE_INSECURE from the environment, injected by
# backend/plus/stacks/engine.py (build_tofu_env) — or manually for this proof.
provider "proxmox" {}

variable "node_name" {
  type        = string
  description = "Proxmox node name the build VM is created on (e.g. \"pve\")."
}

variable "template_id" {
  type        = number
  description = "VMID of an existing template to clone (e.g. a cloud-init Debian template)."
}

resource "proxmox_virtual_environment_vm" "proof" {
  name      = "p3-tofu-proof"
  node_name = var.node_name

  clone {
    vm_id = var.template_id
    full  = true
  }

  cpu {
    cores = 1
  }

  memory {
    dedicated = 1024
  }

  # Proxmox assigns the VMID automatically — no collision with foreign VMs, and
  # OpenTofu only ever tracks the resources in this stack's own state file.
}
