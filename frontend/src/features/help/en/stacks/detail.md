# Stack Detail

This is where you view the stack and deploy it. The state **badge** in the header shows: not deployed / deploying / deployed / partial / out-of-sync / destroying / destroyed.

## Tabs
- **YAML** – the current definition.
- **Real VMs** – the guests actually created (link to the detail page).
- **Deployments** – history of deploy/destroy runs with live log.
- **Versions** – definition history (diff, restore).

## Deploying (two-step plan gate)
1. **Deploy** opens the **plan**: create / change / **destroy** per resource.
2. Only after confirmation is **exactly this plan** applied (as a job with live log).
- **Data loss** (disk/mountpoint removed/shrunk) additionally requires typing the stack name.
- If the definition changes between plan and apply → **409**, re-plan.

## Drift
**Check drift** compares the definition against reality (stack-owned guests only); runs automatically after each deploy.

## Destroy
Removes all of the stack's resources (incl. stack-owned networks). **Blocked (409)** when **foreign** guests are attached to a stack-owned network – they are listed.

## SDN specifics
An SDN network has a **cluster-wide** effect. Parallel SDN deploys are **serialised** (otherwise a short "an SDN deploy is running"). Before apply you are warned if the cluster-wide apply would also commit **foreign pending** SDN changes (you can continue).

> **Requires** a Plus license + a `PortalTofu` token with the necessary rights on the node.

<!-- p3portal.org -->
