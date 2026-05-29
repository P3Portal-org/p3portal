# Node Access Rights (Plus)

Node access rules grant users or groups the ability to perform specific actions on a Proxmox node without giving them full operator rights.

## Actions
- `node:view_tasks` – see the node's task log
- `node:view_backups` – see backup job results
- `node:upload_iso` – upload ISO images to the node
- `node:view_updates` – see the APT update list for the node
- `node:refresh_updates` – trigger a fresh APT update check

## Subject
Assign the rule to a **user** or a **group**. Group assignments apply to all current and future members.

## Use case
Grant a developer the right to upload ISOs to a specific dev node without making them a portal operator.

> **Requires** Plus licence (Core: 0 node assignments).

<!-- p3portal.org -->