# Stacks – Overview

A **stack** describes a group of related infrastructure (VMs, LXC containers and optionally its own networks) **declaratively** – you state *what* should exist, not *how* it is created. P3 realises the stack via the **OpenTofu** engine.

## What a stack contains
- **VMs** (cloned from a template) and **LXC containers** (from an ostemplate tarball)
- optionally **multiple disks** per VM
- optionally **login/IP** (cloud-init: user, password, SSH keys, static IP)
- optionally **stack-owned networks** (node bridge or SDN VNet with subnet/SNAT)

## Lifecycle
1. **Draft** – create/edit the stack (YAML or form), validate.
2. **Deploy** – on the detail page review the **plan** and apply it → the resources are created for real.
3. **Drift / Edit** – detect deviations, change the definition, re-deploy.
4. **Destroy** – the whole stack (incl. stack-owned networks) is removed again.

## Key rules
- **Stack-managed VMs/LXC are locked** against manual changes (CPU/RAM/disk) in the dashboard – changes go through the stack definition (single source of truth).
- Each stack's **state** is the truth about the real infrastructure it manages – foreign VMs are never touched.
- A stack belongs to **one** Proxmox installation.

## Using the list
- **Search** by name, **+ Create stack** opens the editor.
- Per row: version, status, deployment state, owner, **Edit** / **Delete**.

> **Requires** a Plus license.

<!-- p3portal.org -->
