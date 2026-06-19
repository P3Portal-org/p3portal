# Token Usage in the Portal Backend

<!-- p3portal.org -->

Reference of which API endpoints use which Proxmox token.

## Token types

| Token | Proxmox role | Typical permissions |
|---|---|---|
| `viewer` | PVEViewer | VM.Audit, Sys.Audit – **no** Datastore.Audit |
| `operator` | PVEOperator | VM.Power, VM.Config.*, VM.Audit, Sys.Audit – **no** Datastore.Audit |
| `admin` | PVEAdmin / PVEDatastoreAdmin | All including Datastore.Audit, Datastore.Allocate |
| `packer` | Custom role | VM.Allocate, VM.Clone, Datastore.AllocateTemplate, VM.Config.Disk, **Sys.AccessNetwork** (required by PVE ≥ 8 for `download-url`) |

---

## cluster.py

### Read operations (dashboard, VM list, cluster status)

| Endpoint | Local users | Proxmox-login users |
|---|---|---|
| `GET /cluster/status` (node cards, VMs) | **viewer** (fan-out across nodes, Plus) or viewer of default node | session cookie |
| `GET /cluster/nodes/{node}` (node detail) | **viewer** (node-specific) | session cookie |
| `GET /cluster/vms/{node}/{vmid}` | **viewer** (node-specific) | session cookie |
| `GET /cluster/vms/{node}/{vmid}/detail` | **viewer** (node-specific) | session cookie |
| `GET /cluster/portal-nodes` | DB query, no token | **viewer** on default node (live `/nodes`) |

### Write operations (VM actions, snapshots)

| Endpoint | Local users | Proxmox-login users |
|---|---|---|
| `POST /cluster/vms/{node}/{vmid}/action` | **operator** | session cookie |
| `POST /cluster/vms/{node}/{vmid}/snapshot` | **operator** | session cookie |
| `DELETE /cluster/vms/{node}/{vmid}/snapshot` | **operator** | session cookie |

### LXC templates (Image Factory)

| Endpoint | Local users | Proxmox-login users | Note |
|---|---|---|---|
| `GET /cluster/lxc-templates` | **viewer** (fan-out) | session cookie | List installed templates |
| `GET /cluster/lxc-template-storages` | **admin** → operator → viewer | session cookie | Requires Datastore.Audit |
| `POST /cluster/lxc-templates/download` | **operator** | session cookie | Start `pveam download` |
| `DELETE /cluster/lxc-templates` | **admin** | session cookie | Delete template |
| `POST /cluster/lxc-templates/upload` | **admin** | session cookie | Upload template |

---

## packer.py (Image Factory – VM templates & ISO)

### Node dropdown & template listing

| Endpoint | Local users | Proxmox-login users |
|---|---|---|
| `GET /packer/nodes` | **viewer** (fan-out across nodes, Plus) | **viewer** via session |
| `GET /packer/proxmox-templates` | **viewer** (fan-out across nodes, Plus) | **viewer** via session |

### ISO management & Packer builds

| Endpoint | Token | Note |
|---|---|---|
| `POST /packer/iso/download` | **packer** → admin | Triggers Proxmox `download-url`; needs `Datastore.AllocateTemplate` + `Sys.AccessNetwork` |
| `DELETE /packer/iso/{node}` | **packer** → admin | Delete ISO via per-node storage API |
| `GET /packer/iso/task/{upid}` | **packer** → admin | Poll Proxmox download task |
| `POST /packer/build` | **packer** | Start build |
| `GET /packer/build/{id}/status` | **packer** | Build status |
| `DELETE /packer/proxmox-templates/{vmid}` | **packer** | Delete VM template |

For ISO write operations the code resolves the token as **packer → admin** (viewer is excluded — it never holds `Datastore.AllocateTemplate`). Read endpoints (`GET /packer/iso`, `GET /packer/iso/storages`) use the wider **admin → packer → viewer** fallback because mere listing works with any reader.

---

## Known limitations

### Sys.AccessNetwork required for ISO download (PVE ≥ 8)

Proxmox's `POST /storage/{storage}/download-url` endpoint performs an outbound HTTP fetch on behalf of the caller. From PVE 8 onwards Proxmox additionally checks `Sys.AccessNetwork` on `/nodes/{node}` (or any ancestor path) before allowing the network access. A token that has `Datastore.AllocateTemplate` but lacks `Sys.AccessNetwork` returns a `403 Permission check failed` with no detail field. Add `Sys.AccessNetwork` to your Packer role.

### Datastore.Audit missing on viewer & operator

`GET /api2/json/nodes/{node}/storage` requires `Datastore.Audit`. PVEViewer and PVEOperator do **not** have this permission by default. When the permission is missing, Proxmox returns **200 with an empty list** (not a 403).

**Affected:** `GET /cluster/lxc-template-storages`
**Workaround in the code:** admin → operator → viewer fallback chain.

### Recommended Proxmox role configuration

Grant `Datastore.Audit` on `/storage` to the operator token:

```
pveum aclmod /storage --roles PVEDatastoreUser --token portal-operator@pve!portal-operator
```

This removes the need for the admin token for storage listing.

---

## In-guest playbook runs (PROJ-83)

In-guest playbook runs connect to the guest **over SSH** (not through the Proxmox
API), using a dedicated service user `p3-ansible` inside the guest. The **MVP
needs no extra Proxmox token privilege**:

- **Manual onboarding** (paste the onboarding block into the guest) uses no token at all.
- **cloud-init delivery** ships the onboarding block as a vendor-data snippet on a
  Proxmox storage with the **"Snippets"** content type and sets `cicustom: vendor=...`
  on the VM. This uses the same token your deploy already uses — no additional privilege.

### Optional (NOT in the MVP): guest-exec onboarding

A later, optional convenience method could onboard/re-key **existing** VMs via the
QEMU guest agent (`/agent/exec`) or host-side `pct exec`. This executes **root code
in the guest** and would require the `VM.GuestAgent.*` (e.g. `VM.GuestAgent.Audit`
+ guest-exec) privileges on the **admin/management token tier** — never on the
viewer token. Example role grant (only if you build this optional path):

```
pveum role modify PortalAdmin -privs "...,VM.GuestAgent.Audit,VM.GuestAgent.Unrestricted"
```

The MVP deliberately does **not** require this. See
[ansible-inventory.md](ansible-inventory.md).
