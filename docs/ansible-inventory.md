<!-- p3portal.org -->
# Ansible Inventory & In-Guest Playbook Runs (PROJ-83)

P3 Portal can **create** VMs/LXC on your Proxmox installations through Ansible
playbooks that run `hosts: localhost` and talk to the Proxmox REST API. This
feature adds the ability to **configure the guests themselves** — run a playbook
*inside* a VM/LXC over SSH — via a **dynamically generated, scope-filtered
inventory**.

The inventory is **never materialised**. It is projected at job runtime from the
live source of truth (Proxmox) plus a minimal persisted state. A VM deleted
outside P3 simply stops appearing — there are no stale inventory entries to clean up.

---

## How it works

### Scopes (which hosts are in the inventory)
- **User** (Core): the VMs/LXC you own (PROJ-48 owner-assignment).
- **Pool** (Plus): the VMs/LXC of a pool you are a member/manager of (PROJ-46).
- **Global** (Plus, admin-only): only hosts that were explicitly opted into the
  global key.

### Groups (which hosts are runnable)
Each host is placed into exactly one group:
- `managed`   — P3 arranged management keys (`ssh_managed`) **and** a live IP is known → **runnable**.
- `unmanaged` — no management key (opt-out at deploy, or adopted/externally created VM).
- `no_ip`     — managed but no IP yet (no running QEMU guest agent / no LXC interface IP).

Only `managed` hosts are offered as run targets.

### Three key tiers
| Tier | Where | Covers |
|---|---|---|
| User key | per user (PROJ-14 SSH job key, Fernet at-rest) | User scope |
| Pool key | per pool (Plus, Fernet at-rest) | Pool scope |
| Global key | one per portal (Plus, Fernet at-rest, opt-in) | Global scope |

A host carries the public keys of **all scopes it belongs to** in the service
user's `authorized_keys`. A run in scope *S* uses the private key of *S*, so it
authenticates against any host that belongs to *S*. **Private keys are never
returned in API responses, logs or inventory dumps.**

### Host-key trust (TOFU with correction)
First contact accepts the host key (`StrictHostKeyChecking=accept-new`) and
remembers it per `(portal_node_id, vmid, kind)`. A later **mismatch** (e.g. a
rebuilt VM reusing the same IP) **aborts the run** with a clear message. Use the
**"Reset host key"** action to clear the remembered key so the next run re-learns
it (TOFU). Mismatches are never silently accepted.

---

## ⚠️ Security — what this changes in your guests

> **A service user `p3-ansible` with passwordless `sudo` is created in every
> *managed* guest.** This is intentional and is the connection account P3 uses.
> It is decoupled from the cloud-init user you create at deploy time.

### The onboarding block

There is **one canonical, idempotent onboarding block**. It:
1. creates the service user `p3-ansible` (only if it does not exist),
2. installs a sudoers drop-in `/etc/sudoers.d/p3-ansible` = `p3-ansible ALL=(ALL) NOPASSWD:ALL`
   (`0440`, validated with `visudo -cf`),
3. sets `~p3-ansible/.ssh/authorized_keys` to **exactly** the managed public keys
   (set-overwrite, so removed key tiers fall out cleanly).

The only variable in the block is the **list of public keys** — pure data, fed
through a single-quoted heredoc, never interpolated into a shell-evaluated
string (no command injection). The block is idempotent and POSIX-portable
(Debian/Ubuntu **and** RHEL/Rocky).

Whether a playbook escalates is decided by the playbook author via the
`become: true/false` flag in `meta.yaml`. **No sudo/become password is stored or
asked for** (consistent with the LAN-/VPN-only trust model).

### Two MVP delivery methods (same block)

**(a) Manual** — the portal **shows** the block ("Show onboarding block" in the
inventory view); you paste it into the guest. Works for **any** host (new,
existing, adopted, even non-Proxmox later). **Needs no extra Proxmox token
privilege.**

**(b) cloud-init `runcmd` via vendor-data** — at deploy time P3 can ship the
block as a cloud-init **vendor-data** snippet:
- Proxmox keeps generating the **user-data** (`ciuser` / `sshkeys`) itself, and
  the vendor-data `runcmd` is **merged** on top → **no conflict** with the user
  you created.
- A `#cloud-config` snippet is placed on a Proxmox storage with the **"Snippets"**
  content type, and the VM is pointed at it via
  `cicustom: vendor=<storage>:snippets/...`.
- It runs **only on first boot** of a fresh deploy. **Needs no extra Proxmox
  token privilege.**

> **user-data vs vendor-data:** Proxmox owns the user-data. We never touch it. We
> only add a vendor-data file, which cloud-init merges. That is why the user you
> define at deploy time is left intact.

**Fallback** — if the image is not cloud-init capable, there is no "Snippets"
storage, or the VM already exists/was adopted (cloud-init only runs on first
boot), use the **manual block** (always available).

**LXC note:** `cicustom` is QEMU-only, so for LXC the MVP path is the **manual
block** (the keys still land in `p3-ansible`'s `authorized_keys`; only the
delivery and IP-discovery paths differ — the inventory treats both uniformly).

### Optional, NOT in the MVP: guest-exec / `pct exec`

A later convenience method could onboard/re-key **existing** VMs without operator
action by running the block via the QEMU guest agent (`/agent/exec`) or host-side
`pct exec`. This is **deliberately excluded from the MVP** because it executes
**root code in the guest over the token** and requires elevated
`VM.GuestAgent.*` privileges on the admin/management token tier. See
[token-usage.md](token-usage.md) for the privilege it would need. **The MVP needs
none of this.**

---

## Running an in-guest playbook

1. Mark the playbook as a guest playbook in its `meta.yaml`:
   ```yaml
   targets: guest      # default is "localhost" (fully backwards compatible)
   become: true        # optional; runs with sudo via p3-ansible (no password)
   ```
2. In the playbook form, choose the **scope** (User / Pool / Global) and the
   **target hosts** (whole scope or individual hosts). Only `managed` hosts are
   selectable; `unmanaged` / `no_ip` are listed with a reason but not runnable.
3. The run executes through the normal job system with a live log. The generated
   inventory is passed as `inventory=` to `ansible_runner.run()`.

Existing `hosts: localhost` playbooks are unaffected (no inventory, no scope
selector).

---

## RBAC

- **Execution** is scope-/ownership-gated: User = owner; Pool = pool
  member/manager; Global = admin. The PROJ-49/63 playbook whitelist still limits
  *which* playbooks can run at all.
- **Management** (cross-scope inventory view, key rotation, pool/global key
  management) requires the delegable Plus permission
  **`manage_ansible_inventory`** (default admin, delegable via PROJ-27) — separate
  from execution.
- Pool/Global scope endpoints return **404** in Core / unlicensed Plus.

---

## Known limits (MVP)

- A VM that **changes pool** keeps the old pool key until it is re-keyed (manual
  "re-deploy keys" action; no automatic re-keying).
- Key rotation (pool/global) does not retro-actively re-key already-deployed VMs —
  they keep the old key until the next injection.
- No periodic reachability sweep, no manual IP override, no self-healing run if a
  key was manually removed in the guest.

See [meta-yaml-reference.md](meta-yaml-reference.md) for the `targets` / `become`
flags and [token-usage.md](token-usage.md) / [proxmox-setup.md](proxmox-setup.md)
for the (none-needed-for-MVP) privilege notes.
