# Proxmox Setup – Service Accounts & API Tokens

<!-- p3portal.org -->

P3 Portal connects to Proxmox via API tokens. This document describes how to create the service accounts, roles and tokens that the portal needs.

> **Where the tokens are stored:** since the Multi-Node refactor, tokens are no longer set via environment variables. They are entered through the **Setup Wizard** on first start (or later in **System Settings → Nodes**) and stored encrypted in the portal database. Earlier `PROXMOX_*_TOKEN_*` env vars are deprecated and ignored.

---

## Overview

The portal uses up to **four** service accounts on Proxmox. The first three are mandatory; the `packer` account is only needed if you want to use the Image Factory / Packer template builds.

| Account | Token name | Role | Purpose |
|---|---|---|---|
| `portal-viewer@pve` | `portal-viewer` | `PortalViewer` | Dashboard read access for local portal users (viewer role) |
| `portal-operator@pve` | `portal-operator` | `PortalOperator` | VM power & snapshot actions for portal users (operator role) |
| `portal-admin@pve` | `portal-admin` | `PortalAdmin` | VM lifecycle & configuration (admin role) |
| `portal-packer@pve` *(optional)* | `portal-packer` | `PackerRole` | Backend account for Packer template builds + ISO download |

All accounts are PVE-internal users (realm `@pve`) — they cannot log in via SSH. Privilege Separation is **disabled** on all tokens, so each token inherits the full role permissions.

---

## Part A – Portal RBAC accounts

Local portal users get Proxmox access through three dedicated service accounts — one per portal role. The backend picks the right token automatically based on the user's portal role.

### Permissions per role

| Portal role | Proxmox account | Proxmox permissions |
|---|---|---|
| `viewer` | `portal-viewer@pve` | `VM.Audit`, `VM.GuestAgent.Audit`, `Pool.Audit`, `Sys.Audit`, `Datastore.Audit` |
| `operator` | `portal-operator@pve` | viewer perms + `VM.PowerMgmt`, `VM.Snapshot` |
| `admin` | `portal-admin@pve` | operator perms + `VM.Allocate`, `VM.Clone`, `VM.Config.{CPU,Memory,Disk,Network,HWType,Options,Cloudinit,CDROM}`, `Datastore.AllocateSpace`, `SDN.Use`, **`Sys.Audit`**, **`Sys.Modify`** |

> **`VM.GuestAgent.Audit`** is required for IP display and SSH-check of QEMU VMs in the dashboard. Without it, QEMU IPs and SSH status will be missing (LXC containers are not affected — they use a different API endpoint).

### Setup via CLI (recommended)

Run on any cluster node:

```bash
# 1. Create users (no password — tokens only)
pveum user add portal-viewer@pve   --comment "P3 Portal – read only"
pveum user add portal-operator@pve --comment "P3 Portal – operator"
pveum user add portal-admin@pve    --comment "P3 Portal – admin"

# 2. Create roles
pveum role add PortalViewer \
  --privs "VM.Audit,VM.GuestAgent.Audit,Pool.Audit,Sys.Audit,Datastore.Audit"

pveum role add PortalOperator \
  --privs "VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,Pool.Audit,Datastore.Audit"

pveum role add PortalAdmin \
  --privs "VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,VM.Allocate,VM.Clone,\
VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,\
VM.Config.HWType,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,\
Datastore.AllocateSpace,Datastore.Audit,SDN.Use,Pool.Audit,\
Sys.Audit,Sys.Modify"

# 3. Assign roles cluster-wide (path `/`, propagate to children)
pveum acl modify / --user portal-viewer@pve   --role PortalViewer   --propagate 1
pveum acl modify / --user portal-operator@pve --role PortalOperator --propagate 1
pveum acl modify / --user portal-admin@pve    --role PortalAdmin    --propagate 1

# 4. Create API tokens — note each token secret, it is shown only once
pveum user token add portal-viewer@pve   portal-viewer   --privsep 0
pveum user token add portal-operator@pve portal-operator --privsep 0
pveum user token add portal-admin@pve    portal-admin    --privsep 0
```

### Existing installation — patch roles in place

If the roles already exist, use `modify` to update the permission list:

```bash
pveum role modify PortalViewer   --privs "VM.Audit,VM.GuestAgent.Audit,Pool.Audit,Sys.Audit,Datastore.Audit"
pveum role modify PortalOperator --privs "VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,Pool.Audit,Datastore.Audit"
pveum role modify PortalAdmin    --privs "VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,VM.Allocate,VM.Clone,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.HWType,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,Datastore.AllocateSpace,Datastore.Audit,SDN.Use,Pool.Audit,Sys.Audit,Sys.Modify"
```

### Setup via Web UI

1. **Datacenter → Permissions → Roles → Create** — create three roles `PortalViewer`, `PortalOperator`, `PortalAdmin` with the permissions from the table above
2. **Datacenter → Permissions → Users → Add** — three users `portal-viewer`, `portal-operator`, `portal-admin` in realm `pve` (no password)
3. **Datacenter → Permissions → API Tokens → Add** — one token per user, **disable Privilege Separation**, copy the secret
4. **Datacenter → Permissions → Add → User Permission** — for each user: path `/`, the matching role, propagate ✓

### Common error messages

| Error | Missing permission | Fix |
|---|---|---|
| `Permission check failed (/vms/X, VM.Clone)` | `VM.Clone` on `PortalAdmin` | `pveum role modify PortalAdmin` (see above) |
| `Permission check failed (/vms/X, VM.Config.Memory|VM.Config.CPU|…)` | `VM.Config.*` on `PortalAdmin` | `pveum role modify PortalAdmin` |
| QEMU IPs not visible / SSH check failing | `VM.GuestAgent.Audit` missing | Patch all three roles |
| Storage pools empty in node details | `Datastore.Audit` on viewer/operator | Patch `PortalViewer` / `PortalOperator` |
| APT update list empty / 403 on refresh | `Sys.Modify` missing on `PortalAdmin` | `pveum role modify PortalAdmin` (see above); `Sys.Modify` is required by Proxmox even for reading the update list |

### Verify

```bash
# Viewer — list cluster resources
curl -k -s \
  -H "Authorization: PVEAPIToken=portal-viewer@pve!portal-viewer=<SECRET>" \
  https://<PROXMOX-HOST>:8006/api2/json/cluster/resources?type=vm \
  | python3 -m json.tool

# Show effective permissions of an account
pveum user permissions portal-viewer@pve
pveum user permissions portal-operator@pve
pveum user permissions portal-admin@pve
```

---

## Part B – Packer account *(optional)*

Only needed if you want to use the Image Factory / Packer template builds. The Packer account needs broader permissions than the RBAC accounts because Packer creates VMs, attaches ISOs, drives them through an unattended install and converts the result into a template.

> Ansible playbooks do **not** need a Proxmox account — they connect via SSH to target VMs.

### Permissions

| Category | Permission | Why |
|---|---|---|
| VM | `VM.Allocate`, `VM.Clone` | Create the build VM, mark it as template at the end |
| VM | `VM.Config.{CPU,Memory,Disk,HWType,Network,Options,Cloudinit,CDROM}` | Configure the build VM |
| VM | `VM.Console`, `VM.PowerMgmt`, `VM.Audit`, `VM.GuestAgent.Audit` | Control the build VM during installation |
| Datastore | `Datastore.Allocate`, `Datastore.AllocateSpace`, `Datastore.AllocateTemplate`, `Datastore.Audit` | Manage ISO content, allocate disk space, download ISOs |
| SDN | `SDN.Use` | Use network bridges (e.g. `vmbr0`) |
| System | `Sys.AccessNetwork` | Required by PVE ≥ 8 for the `download-url` endpoint (ISO download from the internet) |

### Setup via CLI

```bash
# 1. Create role
pveum role add PackerRole \
  --privs "VM.Allocate,VM.Clone,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,\
VM.Config.HWType,VM.Config.Network,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,\
VM.Console,VM.PowerMgmt,VM.Audit,VM.GuestAgent.Audit,\
Datastore.Allocate,Datastore.AllocateSpace,Datastore.AllocateTemplate,Datastore.Audit,\
SDN.Use,Sys.AccessNetwork"

# 2. Create user
pveum user add portal-packer@pve --comment "P3 Portal – Packer template builder"

# 3. Create API token (note the secret)
pveum user token add portal-packer@pve portal-packer --privsep 0

# 4a. VM-wide permissions
pveum acl modify /vms --user portal-packer@pve --role PackerRole --propagate 1

# 4b. Storage permissions (adjust pool names to your environment)
pveum acl modify /storage/local-lvm --user portal-packer@pve --role PackerRole --propagate 1
pveum acl modify /storage/local     --user portal-packer@pve --role PackerRole --propagate 1

# 4c. SDN permissions (adjust zone if needed; default is "localnetwork")
pveum acl modify /sdn/zones/localnetwork --user portal-packer@pve --role PackerRole --propagate 1

# 4d. Node permissions — required for ISO download via download-url on PVE ≥ 8
# Replace <node> with your actual node name (visible under Datacenter → Nodes)
pveum acl modify /nodes/<node> --user portal-packer@pve --role PackerRole --propagate 1
```

### Verify

```bash
# Token access
curl -k -s \
  -H "Authorization: PVEAPIToken=portal-packer@pve!portal-packer=<SECRET>" \
  https://<PROXMOX-HOST>:8006/api2/json/nodes | python3 -m json.tool

# Effective permissions
pveum user permissions portal-packer@pve
```

---

## Part C – Packer SSH key *(optional, only for unattended installs)*

Packer builds template VMs in two phases:

1. **Automated install** — the OS installer runs unattended (e.g. Debian preseed)
2. **Provisioning** — Packer SSHes into the freshly installed VM as `installuser` (or similar) and runs scripts

For phase 2 Packer needs a **private SSH key**. The matching public key is baked into the installer image via the preseed file. The private key must be available to the portal container at runtime.

> The private key is **not stored in Git** (it is excluded via `.gitignore`). Provide it once after the first start.

### Option A – Reuse an existing keypair

```bash
cp ~/.ssh/id_ed25519 packer/<your-template>/files/installuser
chmod 644 packer/<your-template>/files/installuser
```

### Option B – Generate a dedicated keypair

```bash
ssh-keygen -t ed25519 -f packer/<your-template>/files/installuser -N "" -C "packer-installuser"
# produces:
#   packer/<your-template>/files/installuser       ← private key (not in Git)
#   packer/<your-template>/files/installuser.pub   ← public key
chmod 644 packer/<your-template>/files/installuser

# Copy the public key into the preseed-referenced public-key file
cp packer/<your-template>/files/installuser.pub packer/<your-template>/files/id_ed25519.pub
```

### Why `644` instead of `600`?

The container runs as user `portal` (UID 1001). The `packer/` volume is mounted from the host and owned by a different UID. With `600` only the file owner can read — `portal` cannot access the key and Packer fails with *permission denied*.

Packer uses Go's SSH library (not OpenSSH), which does **not** enforce strict file permissions. `644` is safe enough here because the file only lives inside the container volume.

---

## Token configuration in the portal

Tokens are entered through the **Setup Wizard** on first start and stored encrypted in the portal database. No `.env` configuration is needed for tokens.

To update a token later, go to **System Settings → Nodes → Edit node** and paste the new token ID and secret.

### Multi-node

In a Plus deployment with several independent Proxmox installations, every node gets its own set of viewer/operator/admin (and optionally packer) tokens — they are not shared. Each token configuration is stored next to the corresponding node row.

---

## Notes

- All service accounts are **PVE-internal users** (`@pve`) — they cannot SSH into the cluster.
- **Privilege Separation** is disabled on all tokens so the token inherits the full role permissions.
- In a cluster with multiple Proxmox nodes, `--propagate 1` on path `/` makes the ACL apply to every node automatically.
- The RBAC accounts (Part A) and the Packer account (Part B) serve different purposes and run in parallel.
- Ansible does **not** need a Proxmox account — Ansible connects via SSH to the target VMs directly.
