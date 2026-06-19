# Firewall

Management of the **Proxmox firewall** at three levels. The firewall *filters* traffic – it does not route/NAT (Internet egress comes from the SDN subnet resp. a router VM).

## Levels
- **Datacenter** (via the tabs at the top) – cluster-wide rules, **security groups**, **IP sets** and **aliases**. With several installations, pick one at the top.
- **Node** – rules + options of a single host (pick the node at the top).
- **VM / LXC** – a guest's firewall lives on its detail page (tab "Firewall").

## Operating
- **Live apply:** changes take effect immediately (no pending/reload like the node interfaces).
- **Rule order matters** (evaluated top-down) → reorder rules with up/down.
- **Rule editor:** direction (in/out), action (ACCEPT/DROP/REJECT or security group), protocol/port **or** macro, source/destination (IP/CIDR or insert an alias/IPSet), ICMP type.
- **Deleting** a security group/IPSet/alias checks cluster-wide whether it is still referenced.

## For a rule to take effect
A rule only applies when **all** of these hold:
1. the global datacenter firewall is enabled,
2. the firewall options of that level are enabled,
3. **and** `firewall=1` on the relevant VM network interface (`netX`).

The global datacenter **enable** flag is intentionally read-only here (footgun protection against "locking the cluster out").

## Permissions
- Datacenter/node: admin or `manage_firewall` (node additionally node scope `node:manage_firewall`).
- VM/LXC: owner or operator right on the guest.
- Write access needs `Sys.Modify` (DC/node) resp. `VM.Config.Network` (guest) in the token.

<!-- p3portal.org -->
