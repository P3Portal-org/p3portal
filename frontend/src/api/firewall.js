// p3portal.org
import api from './client'

/**
 * PROJ-90: API client for /api/firewall (Proxmox firewall: datacenter / node / VM).
 *
 * Imperative CRUD over the three Proxmox firewall levels. Proxmox is the single
 * source of truth – no DB, no ETag, last writer wins, **live-apply** (no
 * pending/reload like PROJ-79/80). List endpoints never 500; they return flags
 * (permission_denied / node_unreachable / detail). Rules are position-indexed
 * (`pos`); reordering uses Proxmox' native `moveto` via the dedicated /move route.
 *
 * Datacenter firewall is per Proxmox installation: the optional `installation`
 * argument is a portal node id selecting which installation to target (Muster SDN
 * PROJ-80); omit it for single-installation setups. VM firewall ops take the
 * proxmox `node` to disambiguate VMID collisions across standalone installations.
 */

function cfg(params) {
  const p = {}
  for (const [k, v] of Object.entries(params || {})) if (v != null) p[k] = v
  return Object.keys(p).length ? { params: p } : {}
}

// ════════════════════════════════════════════════════════════════════════════
// Datacenter  (/api/firewall/datacenter/...)
// ════════════════════════════════════════════════════════════════════════════

export async function getDcOptions(installation) {
  const { data } = await api.get('/api/firewall/datacenter/options', cfg({ installation }))
  return data // { enable, policy_in, policy_out, log_ratelimit, ebtables, permission_denied, node_unreachable, detail }
}
export async function updateDcOptions(payload, installation) {
  await api.put('/api/firewall/datacenter/options', payload, cfg({ installation }))
}

// ── Datacenter rules ─────────────────────────────────────────────────────────
export async function listDcRules(installation) {
  const { data } = await api.get('/api/firewall/datacenter/rules', cfg({ installation }))
  return data // { rules, permission_denied, node_unreachable, detail }
}
export async function createDcRule(payload, installation) {
  await api.post('/api/firewall/datacenter/rules', payload, cfg({ installation }))
}
export async function updateDcRule(pos, payload, installation) {
  await api.put(`/api/firewall/datacenter/rules/${pos}`, payload, cfg({ installation }))
}
export async function moveDcRule(pos, moveto, installation) {
  await api.post(`/api/firewall/datacenter/rules/${pos}/move`, { moveto }, cfg({ installation }))
}
export async function deleteDcRule(pos, installation) {
  await api.delete(`/api/firewall/datacenter/rules/${pos}`, cfg({ installation }))
}

// ── Security groups ──────────────────────────────────────────────────────────
export async function listSecurityGroups(installation) {
  const { data } = await api.get('/api/firewall/datacenter/groups', cfg({ installation }))
  return data // { items: [{group, comment, digest}], permission_denied, node_unreachable, detail }
}
export async function createSecurityGroup(payload, installation) {
  const { data } = await api.post('/api/firewall/datacenter/groups', payload, cfg({ installation }))
  return data
}
export async function deleteSecurityGroup(group, installation) {
  await api.delete(`/api/firewall/datacenter/groups/${encodeURIComponent(group)}`, cfg({ installation }))
}
export async function listGroupRules(group, installation) {
  const { data } = await api.get(`/api/firewall/datacenter/groups/${encodeURIComponent(group)}/rules`, cfg({ installation }))
  return data
}
export async function createGroupRule(group, payload, installation) {
  await api.post(`/api/firewall/datacenter/groups/${encodeURIComponent(group)}/rules`, payload, cfg({ installation }))
}
export async function updateGroupRule(group, pos, payload, installation) {
  await api.put(`/api/firewall/datacenter/groups/${encodeURIComponent(group)}/rules/${pos}`, payload, cfg({ installation }))
}
export async function moveGroupRule(group, pos, moveto, installation) {
  await api.post(`/api/firewall/datacenter/groups/${encodeURIComponent(group)}/rules/${pos}/move`, { moveto }, cfg({ installation }))
}
export async function deleteGroupRule(group, pos, installation) {
  await api.delete(`/api/firewall/datacenter/groups/${encodeURIComponent(group)}/rules/${pos}`, cfg({ installation }))
}

// ── IPSets (datacenter-global) ───────────────────────────────────────────────
export async function listIpSets(installation) {
  const { data } = await api.get('/api/firewall/datacenter/ipsets', cfg({ installation }))
  return data // { items: [{name, comment}], ... }
}
export async function createIpSet(payload, installation) {
  const { data } = await api.post('/api/firewall/datacenter/ipsets', payload, cfg({ installation }))
  return data
}
export async function deleteIpSet(name, installation) {
  await api.delete(`/api/firewall/datacenter/ipsets/${encodeURIComponent(name)}`, cfg({ installation }))
}
export async function listIpSetEntries(name, installation) {
  const { data } = await api.get(`/api/firewall/datacenter/ipsets/${encodeURIComponent(name)}/entries`, cfg({ installation }))
  return data // { entries: [{cidr, nomatch, comment}], ... }
}
export async function addIpSetEntry(name, payload, installation) {
  await api.post(`/api/firewall/datacenter/ipsets/${encodeURIComponent(name)}/entries`, payload, cfg({ installation }))
}
export async function deleteIpSetEntry(name, cidr, installation) {
  // cidr may contain '/' → backend route uses {cidr:path}; encode the whole token.
  await api.delete(`/api/firewall/datacenter/ipsets/${encodeURIComponent(name)}/entries/${cidr}`, cfg({ installation }))
}

// ── Aliases (datacenter-global) ──────────────────────────────────────────────
export async function listAliases(installation) {
  const { data } = await api.get('/api/firewall/datacenter/aliases', cfg({ installation }))
  return data // { items: [{name, cidr, comment, ipversion}], ... }
}
export async function createAlias(payload, installation) {
  const { data } = await api.post('/api/firewall/datacenter/aliases', payload, cfg({ installation }))
  return data
}
export async function updateAlias(name, payload, installation) {
  await api.put(`/api/firewall/datacenter/aliases/${encodeURIComponent(name)}`, payload, cfg({ installation }))
}
export async function deleteAlias(name, installation) {
  await api.delete(`/api/firewall/datacenter/aliases/${encodeURIComponent(name)}`, cfg({ installation }))
}

// ── Macros / refs (read-only, rule-editor dropdowns) ─────────────────────────
export async function listMacros(installation) {
  const { data } = await api.get('/api/firewall/datacenter/macros', cfg({ installation }))
  return data // [{macro, descr}]
}
export async function listRefs(installation) {
  const { data } = await api.get('/api/firewall/datacenter/refs', cfg({ installation }))
  return data // [{type, name, ref, comment}]
}

// ── Usage check (SG / IPSet / Alias deletion, cluster-wide fan-out) ──────────
export async function checkUsage(kind, name, installation) {
  const { data } = await api.get(
    `/api/firewall/datacenter/usage/${encodeURIComponent(kind)}/${encodeURIComponent(name)}`,
    cfg({ installation }),
  )
  return data // { kind, name, in_use, usages: [{level, node, vmid, kind, group, pos, rule}], incomplete }
}

// ════════════════════════════════════════════════════════════════════════════
// Node  (/api/firewall/nodes/{node}/...)
// ════════════════════════════════════════════════════════════════════════════

export async function getNodeOptions(node) {
  const { data } = await api.get(`/api/firewall/nodes/${encodeURIComponent(node)}/options`)
  return data // { enable, log_level_*, ..., global_firewall_enabled, permission_denied, node_unreachable, detail }
}
export async function updateNodeOptions(node, payload) {
  await api.put(`/api/firewall/nodes/${encodeURIComponent(node)}/options`, payload)
}
export async function listNodeRules(node) {
  const { data } = await api.get(`/api/firewall/nodes/${encodeURIComponent(node)}/rules`)
  return data
}
export async function createNodeRule(node, payload) {
  await api.post(`/api/firewall/nodes/${encodeURIComponent(node)}/rules`, payload)
}
export async function updateNodeRule(node, pos, payload) {
  await api.put(`/api/firewall/nodes/${encodeURIComponent(node)}/rules/${pos}`, payload)
}
export async function moveNodeRule(node, pos, moveto) {
  await api.post(`/api/firewall/nodes/${encodeURIComponent(node)}/rules/${pos}/move`, { moveto })
}
export async function deleteNodeRule(node, pos) {
  await api.delete(`/api/firewall/nodes/${encodeURIComponent(node)}/rules/${pos}`)
}

// ════════════════════════════════════════════════════════════════════════════
// VM/LXC  (/api/firewall/vms/{vmid}/...)
// ════════════════════════════════════════════════════════════════════════════

export async function getGuestOptions(vmid, node) {
  const { data } = await api.get(`/api/firewall/vms/${vmid}/options`, cfg({ node }))
  return data // { enable, dhcp, ..., global_firewall_enabled, permission_denied, node_unreachable, detail }
}
export async function updateGuestOptions(vmid, payload, node) {
  await api.put(`/api/firewall/vms/${vmid}/options`, payload, cfg({ node }))
}
export async function listGuestRules(vmid, node) {
  const { data } = await api.get(`/api/firewall/vms/${vmid}/rules`, cfg({ node }))
  return data
}
export async function createGuestRule(vmid, payload, node) {
  await api.post(`/api/firewall/vms/${vmid}/rules`, payload, cfg({ node }))
}
export async function updateGuestRule(vmid, pos, payload, node) {
  await api.put(`/api/firewall/vms/${vmid}/rules/${pos}`, payload, cfg({ node }))
}
export async function moveGuestRule(vmid, pos, moveto, node) {
  await api.post(`/api/firewall/vms/${vmid}/rules/${pos}/move`, { moveto }, cfg({ node }))
}
export async function deleteGuestRule(vmid, pos, node) {
  await api.delete(`/api/firewall/vms/${vmid}/rules/${pos}`, cfg({ node }))
}

// ── Guest IPSets (local to the VM/LXC) ───────────────────────────────────────
export async function listGuestIpSets(vmid, node) {
  const { data } = await api.get(`/api/firewall/vms/${vmid}/ipsets`, cfg({ node }))
  return data
}
export async function createGuestIpSet(vmid, payload, node) {
  const { data } = await api.post(`/api/firewall/vms/${vmid}/ipsets`, payload, cfg({ node }))
  return data
}
export async function deleteGuestIpSet(vmid, name, node) {
  await api.delete(`/api/firewall/vms/${vmid}/ipsets/${encodeURIComponent(name)}`, cfg({ node }))
}
export async function listGuestIpSetEntries(vmid, name, node) {
  const { data } = await api.get(`/api/firewall/vms/${vmid}/ipsets/${encodeURIComponent(name)}/entries`, cfg({ node }))
  return data
}
export async function addGuestIpSetEntry(vmid, name, payload, node) {
  await api.post(`/api/firewall/vms/${vmid}/ipsets/${encodeURIComponent(name)}/entries`, payload, cfg({ node }))
}
export async function deleteGuestIpSetEntry(vmid, name, cidr, node) {
  await api.delete(`/api/firewall/vms/${vmid}/ipsets/${encodeURIComponent(name)}/entries/${cidr}`, cfg({ node }))
}

// ── Guest Aliases (local to the VM/LXC) ──────────────────────────────────────
export async function listGuestAliases(vmid, node) {
  const { data } = await api.get(`/api/firewall/vms/${vmid}/aliases`, cfg({ node }))
  return data
}
export async function createGuestAlias(vmid, payload, node) {
  const { data } = await api.post(`/api/firewall/vms/${vmid}/aliases`, payload, cfg({ node }))
  return data
}
export async function updateGuestAlias(vmid, name, payload, node) {
  await api.put(`/api/firewall/vms/${vmid}/aliases/${encodeURIComponent(name)}`, payload, cfg({ node }))
}
export async function deleteGuestAlias(vmid, name, node) {
  await api.delete(`/api/firewall/vms/${vmid}/aliases/${encodeURIComponent(name)}`, cfg({ node }))
}

// ── Shared error mapper for firewall write paths ─────────────────────────────
export function firewallErrMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return typeof d === 'string' ? d : 'Fehlende Proxmox-Privilegien für die Firewall-Verwaltung.'
  // PROJ-91: die Firewall dieses Gastes wird vom Stack verwaltet (1-Engine-Regel).
  if (s === 409 && d && typeof d === 'object' && d.error === 'guest_firewall_managed_by_stack') {
    return `Die Firewall dieses Gastes wird vom Stack „${d.stack_name}" verwaltet – bitte über die Stack-Definition bearbeiten.`
  }
  if (s === 409) return typeof d === 'string' ? d : 'Ein Objekt mit diesem Namen existiert bereits.'
  if (s === 422) return typeof d === 'string' ? d : 'Ungültige Eingabe – bitte Felder prüfen.'
  if (s === 503) return 'Admin-Token (Sys.Modify) für diese Installation nicht konfiguriert.'
  if (s === 502) return 'Proxmox nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Ausführen der Aktion.'
}
