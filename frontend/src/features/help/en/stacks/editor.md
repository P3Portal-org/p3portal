# Stack Editor

This is where you define the stack. Two views, **bidirectionally synced**:

- **Form** (default) – guided cards for VMs, LXC containers and networks.
- **YAML** – the raw definition (single source of truth). Invalid YAML shows an inline hint; the last valid state is kept.

## Resources
- **VM** – template, node, CPU/RAM, root disk, optionally **additional disks** (size + datastore + bus) and **VMID**.
- **LXC** – ostemplate (from the Image Factory), rootfs, **mountpoints**, **features** (nesting/keyctl/fuse), **unprivileged** (secure default).
- **Count (instances)** > 1 creates several named guests.

## Cloud-Init (login & IP)
Its own tab. Login (user/password/SSH keys) and IP mode (DHCP/static) are stored **encrypted** and separate from the YAML – **no plaintext secret in the version history**. Stack default + per-VM override.

## Networks
- **Node bridge** – node-local, low-risk.
- **SDN VNet** – stack-owned overlay with subnet/gateway, optionally **SNAT** (Internet egress). **Cluster-wide effect** – flagged accordingly in the editor.
- Guests attach to the created network via its **name**; stack-owned networks are removed on destroy.

## Validate & versions
- **Validate** checks structure + semantics (node/template/pool); warnings do not block saving.
- Every save creates a **version** (history, diff, restore). Concurrent edits are detected via **ETag** (conflict dialog).

> **Deploying** happens on the detail page. **Requires** a Plus license.

<!-- p3portal.org -->
