// p3portal.org
// PROJ-83: API-Client für das Ansible-Inventory (In-Guest-Playbook-Runs).
import api from '../../api/client'

/**
 * Listet die Hosts eines Scopes (user|pool|global), gruppiert in
 * managed/unmanaged/no_ip. Pool/Global sind Plus → 404 in Pure Core.
 */
export async function fetchInventoryHosts(scope = 'user', scopeRef = null) {
  const params = { scope }
  if (scopeRef != null) params.scope_ref = scopeRef
  const { data } = await api.get('/api/ansible-inventory/hosts', { params })
  return data
}

/**
 * Holt den kanonischen Onboarding-Block (Service-User p3-ansible + NOPASSWD-sudo
 * + zutreffende Public Keys) zum manuellen Einfügen + die cloud-init vendor-data.
 */
export async function fetchOnboardingBlock(scope = 'user', scopeRef = null, globalOptIn = false) {
  const params = { scope, global_opt_in: globalOptIn }
  if (scopeRef != null) params.scope_ref = scopeRef
  const { data } = await api.get('/api/ansible-inventory/onboarding-block', { params })
  return data
}

/** Löscht den gemerkten Host-Key → nächster Run re-TOFUt. */
export async function resetHostKey(portalNodeId, kind, vmid) {
  const { data } = await api.post(
    `/api/ansible-inventory/hosts/${portalNodeId}/${kind}/${vmid}/reset-host-key`,
  )
  return data
}

// ── Key-Management (Plus, manage_ansible_inventory) ──────────────────────────
export async function fetchGlobalPublicKey() {
  const { data } = await api.get('/api/ansible-inventory/keys/global/public')
  return data
}

export async function rotateGlobalKey() {
  const { data } = await api.post('/api/ansible-inventory/keys/global/rotate')
  return data
}

export async function fetchPoolPublicKey(poolId) {
  const { data } = await api.get(`/api/ansible-inventory/keys/pool/${poolId}/public`)
  return data
}

export async function rotatePoolKey(poolId) {
  const { data } = await api.post(`/api/ansible-inventory/keys/pool/${poolId}/rotate`)
  return data
}

// ── PROJ-84: Discovery + Onboarding bestehender Hosts ────────────────────────

/**
 * Node-/installations-weite Discovery: alle QEMU+LXC einer Installation mit
 * Managed-/Run-Scope-Status (Plus, manage_ansible_inventory → 404 in Pure Core).
 */
export async function fetchDiscovery(portalNodeId) {
  const { data } = await api.get('/api/ansible-inventory/discovery', {
    params: { node: portalNodeId },
  })
  return data
}

/**
 * Onboardet einen bestehenden Host ownership-frei (Global-Key, optional Pool-Key)
 * → Global-Scope-ausführbar. Liefert den Onboarding-Block zum manuellen Einfügen.
 */
export async function onboardHost(portalNodeId, kind, vmid, includePoolKey = false) {
  const { data } = await api.post('/api/ansible-inventory/onboard', {
    portal_node_id: portalNodeId,
    kind,
    vmid,
    include_pool_key: includePoolKey,
  })
  return data
}

/** Bulk-Onboarding mehrerer Hosts (Partial-Success: onboarded/skipped/failed). */
export async function onboardBulk(hosts, includePoolKey = false) {
  const { data } = await api.post('/api/ansible-inventory/onboard/bulk', {
    hosts,
    include_pool_key: includePoolKey,
  })
  return data
}

/**
 * Markiert einen eigenen/adoptierten Host als verwaltet (`ssh_managed=true`),
 * ohne Ownership zu ändern (User-Scope). RBAC: Owner ODER manage_ansible_inventory.
 */
export async function markManaged(portalNodeId, kind, vmid) {
  const { data } = await api.post(
    `/api/ansible-inventory/hosts/${portalNodeId}/${kind}/${vmid}/mark-managed`,
  )
  return data
}

/** Informativer SSH-Verbindungstest als p3-ansible (setzt keinen Zustand). */
export async function testConnection(portalNodeId, kind, vmid) {
  const { data } = await api.post(
    `/api/ansible-inventory/hosts/${portalNodeId}/${kind}/${vmid}/test-connection`,
  )
  return data
}
