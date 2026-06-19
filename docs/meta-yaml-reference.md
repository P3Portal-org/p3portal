# meta.yaml – Reference

<!-- p3portal.org -->

Every Ansible playbook and every Packer build that should be executable through P3 Portal needs a companion `meta.yaml` file next to it. This file describes the script for the portal: display name, description, visibility — and, most importantly, the form fields the user should fill in to start it.

> **Important:** the file must be named exactly `meta.yaml` (not `.yml`).
> The backend scans the `ansible/` and `packer/` mounts recursively for this exact filename.

This reference documents all fields and parameter types. Examples are for illustration — you are not locked into any specific use case.

---

## Ansible – meta.yaml

### Location

One `meta.yaml` per playbook, alongside the playbook files:

```
ansible/
  example-playbook/
    meta.yaml
    playbook.yml
    tasks/
```

or flat for single-file playbooks:

```
ansible/
  meta.yaml
  example-playbook.yml
```

### Required fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name in the portal |
| `description` | string | Short description (1–2 sentences) |
| `playbook` | string | Filename of the playbook (e.g. `example-playbook.yml`) |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `required_role` | string | Restrict visibility (see roles) |
| `category` | string | Tab in the playbook section (see categories) |
| `parameters` | list | Form fields (see parameter types) |
| `presets` | list | Quick-pick preset values |

### Roles (`required_role`)

| Value | Visible to |
|---|---|
| not set / `null` | everyone (viewer, operator, admin) |
| `"operator"` | operator, admin; viewer does not see the playbook |
| `"admin"` | admin only |

The value is a **portal role name** (`viewer`, `operator`, `admin`), not a Proxmox role name.

### Categories (`category`)

| Value | Tab in the portal |
|---|---|
| `vm_deployment` | VM Deployment |
| `lxc_deployment` | LXC Deployment |
| `vm_lxc_config` | VM / LXC Configuration |
| not set | hidden (does not appear in any tab) |

### Presets

Presets fill several form fields at once. The keys in `values` must be `id` values from your `parameters` block.

```yaml
presets:
  - label: "Small"
    values:
      cpu_cores: 2
      memory_mb: 2048
  - label: "Large"
    values:
      cpu_cores: 8
      memory_mb: 8192
```

### Minimal example (Ansible)

```yaml
name: "Example playbook"
description: "What this playbook does — a one-liner."
playbook: "example-playbook.yml"
parameters:
  - id: target_name
    label: "Target name"
    type: string
    required: true
```

### Example using Proxmox-specific parameters

For a typical VM-provisioning playbook several specialised parameter types are available (see the “Parameter types” section below):

```yaml
name: "New VM from template"
description: "Clones an existing template and boots the new VM."
playbook: "deploy-vm.yml"
required_role: "operator"
category: "vm_deployment"
parameters:
  - id: proxmox_node
    label: "Proxmox node"
    type: proxmox_node
    required: true
  - id: template_id
    label: "Template"
    type: proxmox_template
    required: true
  - id: vm_name
    label: "Name of the new VM"
    type: string
    required: true
  - id: cpu_cores
    label: "CPU cores"
    type: integer
    required: true
    default: 2
    min: 1
    max: 32
  - id: memory_mb
    label: "RAM (MB)"
    type: integer
    required: true
    default: 2048
    min: 512
```

---

## Packer – meta.yaml

### Location

```
packer/
  example-template/
    meta.yaml
    template.pkr.hcl
```

### Required fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Display name in the portal |
| `description` | string | Short description |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `required_role` | string | Visibility (same logic as Ansible) |
| `parameters` | list | Form fields |

> Packer builds have **no** `category` field (no tab grouping), **no** `playbook` field (the build is derived from the directory) and **no** `presets` field.

### Special parameter IDs (Packer)

These four `id` values get special UI treatment from the portal — independent of the `type` you set:

| `id` | UI | Behaviour |
|---|---|---|
| `node` | Node dropdown | Lists available Proxmox nodes; clears dependent fields on change |
| `storage_pool` | Storage dropdown | Filtered by the chosen node; auto-fills from admin settings |
| `iso_file` | ISO dropdown | Filtered by the chosen node; includes a download button for new ISOs |
| `vm_id` | Number + refresh | Auto-fills with the next free ID from the configured range |

### Example (Packer)

```yaml
name: "Example template"
description: "Builds a VM template from an ISO with cloud-init."
required_role: "operator"
parameters:
  - id: vm_id
    label: "Template VM ID"
    type: integer
    required: true
    min: 1000
    max: 1999
  - id: node
    label: "Proxmox node"
    type: string
    required: true
  - id: storage_pool
    label: "Storage pool"
    type: string
    required: false
  - id: iso_file
    label: "ISO file"
    type: string
    required: false
```

---

## Parameter types – reference

Applies to **both** (Ansible and Packer) unless noted otherwise.

### `string`

Single-line text input.

```yaml
- id: hostname
  label: "Hostname"
  type: string
  required: true
  default: "example-host"
```

### `integer`

Number input with optional bounds.

```yaml
- id: cpu_cores
  label: "CPU cores"
  type: integer
  required: true
  default: 2
  min: 1
  max: 32
```

> **Ansible special case:** a parameter with `id: vm_id` and `type: integer` automatically gets a refresh button that loads the next free VM ID from the configured playbook VM-ID range.

### `dropdown`

Select list with fixed options. Requires `options`.

```yaml
- id: os_type
  label: "Operating system"
  type: dropdown
  required: true
  options:
    - label: "Ubuntu 24.04"
      value: "ubuntu2404"
    - label: "Debian 12"
      value: "debian12"
```

### `bool`

Checkbox (true / false).

```yaml
- id: enable_feature
  label: "Enable feature"
  type: bool
  required: false
  default: true
```

### `ssh_key`

Multi-line text field for an SSH public key. Includes a checkbox “Use profile SSH key” that auto-fills the field with the key stored in the user profile.

```yaml
- id: ssh_key
  label: "SSH public key"
  type: ssh_key
  required: false
```

> Only useful if your playbook actually consumes the key (e.g. writes it to `authorized_keys`).

### `proxmox_node` *(Ansible only)*

Dropdown listing all available Proxmox nodes (from the cluster API). Auto-selects the first node. Controls the filtering of `proxmox_template`.

```yaml
- id: proxmox_node
  label: "Proxmox node"
  type: proxmox_node
  required: true
```

> **Order matters:** place this **before** `proxmox_template`, because the template dropdown is populated only after the node is chosen.

### `proxmox_template` *(Ansible only)*

Dropdown listing all VM templates on the selected node. Auto-fills from the admin setting “default template per node”.

```yaml
- id: template_id
  label: "Template"
  type: proxmox_template
  required: true
```

> Always place this **after** `proxmox_node`. The parameter name (`id`) is free to choose.

### `ip_config` *(Ansible only)*

Combined field for Proxmox cloud-init network configuration. Shows a dropdown (DHCP / Static); on “Static”, additional inputs appear for IP address, prefix length and gateway.

The value is passed to Ansible as a Proxmox-style string:

- DHCP: `ip=dhcp`
- Static: `ip=192.168.1.100/24,gw=192.168.1.1`

```yaml
- id: network_config
  label: "Network (cloud-init)"
  type: ip_config
  required: true
  default: "ip=dhcp"
```

### `target_host` *(Ansible only)*

Dropdown listing all running VMs and LXC containers in the cluster. Forwards the IP of the chosen machine to Ansible (typically as the Ansible target host).

```yaml
- id: target_host
  label: "Target VM"
  type: target_host
  required: true
```

### `vm_access` *(Ansible only)*

Combined field for VM access configuration (cloud-init): root password, user configuration, SSH key selection. The backend splits this field into several Ansible variables.

```yaml
- id: vm_access
  label: "Configure VM access"
  type: vm_access
  required: true
```

> At most one `vm_access` field per playbook. Usually placed at the end of the form.

---

## Shared parameter properties

| Property | Required | Description |
|---|---|---|
| `id` | yes | Variable name passed to Ansible/Packer (snake_case recommended) |
| `label` | yes | Field label shown in the form |
| `type` | yes | Field type (see above) |
| `required` | no | `true` = required field (default: `false`) |
| `default` | no | Pre-filled value when the form opens |
| `min` | no | Minimum value (only for `type: integer`) |
| `max` | no | Maximum value (only for `type: integer`) |
| `options` | no | Selection options (only for `type: dropdown`) |

---

## Top-level playbook properties (PROJ-83)

In addition to the parameter list, a playbook's `meta.yaml` supports two top-level
flags that mark it as an **in-guest playbook** (run *inside* a VM/LXC over SSH
instead of `hosts: localhost`):

| Property | Required | Description |
|---|---|---|
| `targets` | no | `localhost` (default) or `guest`. `guest` enables the scope + host selector in the playbook form and runs the playbook against the dynamic inventory over SSH. Default `localhost` is fully backwards compatible. |
| `become` | no | `true`/`false` (default `false`). When `true`, the run uses `--become` (passwordless `sudo` via the `p3-ansible` service user). No become password is stored or asked for. |

```yaml
name: "Install Docker"
description: "Installs Docker inside the target guests"
playbook: "configure_docker.yml"
targets: guest        # run inside the guest, not on localhost
become: true          # needs root in the guest
parameters: []
```

> **Convention:** a *guest playbook* is `hosts: <something other than localhost>`
> (commonly `hosts: all` or `hosts: managed`). P3 only inspects the `targets`
> flag, not the playbook body. The generated inventory contains only the selected,
> *managed* target hosts, so `hosts: all` hits exactly those.

See [ansible-inventory.md](ansible-inventory.md) for the full model (scopes, key
tiers, the `p3-ansible` service user, onboarding block, host-key TOFU).
