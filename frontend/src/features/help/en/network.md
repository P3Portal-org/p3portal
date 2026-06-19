# Networking

Management of the **shared** Proxmox network infrastructure. Two areas via the tabs at the top:

## Node interfaces (per node)
Linux **bridges** and **VLAN interfaces** of a single Proxmox node (`/nodes/<node>/network`). Pick the node at the top.

- **Create / edit / delete** bridges (`vmbrN`) and VLAN interfaces.
- **Apply model:** changes are *pending* first (banner "N pending changes"). Only **Reload** activates them on the node, **Revert** undoes them.
- ⚠️ A reload can briefly affect **node connectivity** (e.g. if the management bridge is involved) – the dialog warns accordingly.
- **Delete** checks whether VMs/LXC still use the bridge (`netX: bridge=…`) and warns if it is in use.

## SDN (cluster)
Cluster-wide **Software-Defined Networking** (`/cluster/sdn`): **zones**, **VNets** and **subnets**.

- ⚠️ **Cluster-wide effect:** "Apply" (`PUT /cluster/sdn`) activates **all** pending SDN objects on **all** nodes at once.
- Pending objects carry a state badge (new / changed / deleted) until applied.
- **Delete** checks usage cluster-wide (VNet ← VM references, zone ← VNets).

## Permissions
- Node interfaces: admin, `manage_networks` or node scope `node:manage_network`.
- SDN: admin or `manage_sdn` (cluster-wide, no node scope).
- Write access needs an admin token with `Sys.Modify` (bridges) resp. `SDN.Allocate` (SDN).

> **Note:** Stack-owned networks (declarative via Stacks) are a separate mechanism – this page manages **shared**, manually maintained infrastructure.

<!-- p3portal.org -->
