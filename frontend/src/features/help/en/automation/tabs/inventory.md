# Ansible Inventory

This shows the guests (VMs/LXC) that P3 can configure via Ansible. The inventory is generated **live from Proxmox** — there is no maintained inventory file, and VMs deleted outside of P3 disappear automatically.

## Scopes
- **Mine** – your own guests (you are the owner). Available in every edition.
- **Pool** – the guests of a pool (Plus).
- **Global** – only guests that were explicitly onboarded with the global key (Plus).

## Groups
- **managed** – service user `p3-ansible` + key are set up **and** an IP is known → can be targeted.
- **unmanaged** – no management key injected (opt-out on deploy, or created externally).
- **no IP** – managed, but no IP can be determined (e.g. the QEMU guest agent is not running).

## Guest onboarding
For a guest to be managed, P3 sets up a service user **`p3-ansible`** (with NOPASSWD sudo) and installs the applicable public keys.

- **On deploy** this happens automatically via cloud-init (vendor-data) — the user chosen by the creator is left untouched.
- **Existing guests** are onboarded manually: click **Show onboarding block** and insert the block as root inside the guest. It is idempotent and requires **no** elevated Proxmox token privilege.

## Reset host key
P3 remembers the SSH host key on first contact (TOFU). If a guest was rebuilt (same IP, new host key), the next run aborts for safety. **Reset host key** deletes the remembered entry so the next run accepts the new key.

## Execution
Guest playbooks (those that don't run on `localhost`) show a **scope and host selector** in the playbook form. You can target the entire scope or individual managed hosts. The run goes through the normal job system with live log.

## Onboarding existing guests

VMs/LXC become manageable automatically **on deploy**. Guests created before P3 or created externally must be onboarded afterwards — in two ways:

### Own/adopted hosts: "Mark as managed"
A guest you own that is listed as **unmanaged** gets a **Mark as managed** action in the **Mine** view. **First** run the onboarding block inside the guest (service user `p3-ansible` + your key), then mark it — otherwise the later run fails. The host becomes executable in **your own scope**.

### Installation-wide (Plus, `manage_ansible_inventory`)
With the "manage Ansible inventory" permission an **Installation** scope appears. It lists **all** guests of an installation — independent of ownership — with managed status. Here you can onboard guests **individually or in bulk**:

- Onboarding injects the **global key** and makes the guest executable **without an owner** in the **global scope** (optionally also the pool key).
- The returned **onboarding block** must be inserted manually for existing guests (cloud-init only applies on first boot).
- Idempotent: already globally onboarded guests are skipped.

### Test connection (optional)
**Test connection** checks via SSH as `p3-ansible` whether the onboarding block actually took effect inside the guest. The test is **purely informative** — it changes nothing and does not block marking/onboarding. It is unavailable for guests without a determinable IP.

### "no run scope"
A guest marked as **managed** that lies in **no** executable scope (no owner, no pool, not global) is clearly flagged in the discovery view. Onboarding injects the global key and resolves it.
