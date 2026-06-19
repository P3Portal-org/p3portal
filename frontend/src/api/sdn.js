// p3portal.org
import api from './client'

/**
 * PROJ-80: API client for /api/sdn (SDN: zones, vnets, subnets).
 *
 * SDN is datacenter-wide *within one Proxmox installation*. P3 can manage several
 * independent installations (e.g. two standalone nodes not in a cluster), each
 * with its own /cluster/sdn. The optional `node` argument is a portal node id
 * selecting which installation to target; omit it for single-installation setups
 * (the backend falls back to the default node). Proxmox is the single source of
 * truth – no DB, no ETag, last writer wins. List endpoints never 500; they return
 * flags (sdn_unavailable / permission_denied / cluster_unreachable / detail).
 */

// Build axios config that carries the optional ?node=<portal_node_id>.
function cfg(node) {
  return node != null ? { params: { node } } : {}
}

// ── Zones ──────────────────────────────────────────────────────────────────
export async function listSdnZones(node) {
  const { data } = await api.get('/api/sdn/zones', cfg(node))
  return data // { items, has_pending, sdn_unavailable, permission_denied, cluster_unreachable, detail }
}

export async function createSdnZone(payload, node) {
  const { data } = await api.post('/api/sdn/zones', payload, cfg(node))
  return data // { id, warnings }
}

export async function updateSdnZone(zone, payload, node) {
  const { data } = await api.put(`/api/sdn/zones/${encodeURIComponent(zone)}`, payload, cfg(node))
  return data
}

export async function deleteSdnZone(zone, node) {
  await api.delete(`/api/sdn/zones/${encodeURIComponent(zone)}`, cfg(node))
}

export async function checkSdnZoneUsage(zone, node) {
  const { data } = await api.get(`/api/sdn/zones/${encodeURIComponent(zone)}/usage`, cfg(node))
  return data // { id, in_use, vnets: [...], incomplete }
}

// ── VNets ──────────────────────────────────────────────────────────────────
export async function listSdnVnets(node) {
  const { data } = await api.get('/api/sdn/vnets', cfg(node))
  return data
}

export async function createSdnVnet(payload, node) {
  const { data } = await api.post('/api/sdn/vnets', payload, cfg(node))
  return data
}

export async function updateSdnVnet(vnet, payload, node) {
  const { data } = await api.put(`/api/sdn/vnets/${encodeURIComponent(vnet)}`, payload, cfg(node))
  return data
}

export async function deleteSdnVnet(vnet, node) {
  await api.delete(`/api/sdn/vnets/${encodeURIComponent(vnet)}`, cfg(node))
}

export async function checkSdnVnetUsage(vnet, node) {
  const { data } = await api.get(`/api/sdn/vnets/${encodeURIComponent(vnet)}/usage`, cfg(node))
  return data // { id, in_use, vms: [{vmid,name,node,kind}], subnets: [...], incomplete }
}

// ── Subnets (nested under a VNet) ────────────────────────────────────────────
export async function listSdnSubnets(node) {
  const { data } = await api.get('/api/sdn/subnets', cfg(node))
  return data
}

export async function createSdnSubnet(payload, node) {
  const { data } = await api.post('/api/sdn/subnets', payload, cfg(node))
  return data
}

export async function updateSdnSubnet(vnet, subnet, payload, node) {
  const { data } = await api.put(
    `/api/sdn/subnets/${encodeURIComponent(vnet)}/${encodeURIComponent(subnet)}`,
    payload,
    cfg(node),
  )
  return data
}

export async function deleteSdnSubnet(vnet, subnet, node) {
  await api.delete(`/api/sdn/subnets/${encodeURIComponent(vnet)}/${encodeURIComponent(subnet)}`, cfg(node))
}

// ── Form helper: available bridges (per installation, for VLAN-zone picker) ───
export async function listSdnBridges(node) {
  const { data } = await api.get('/api/sdn/bridges', cfg(node))
  return data // { bridges: [...], incomplete }
}

// ── Aggregate pending + Apply / Revert (per installation!) ───────────────────
export async function getSdnPending(node) {
  const { data } = await api.get('/api/sdn', cfg(node))
  return data // { has_pending, counts, sdn_unavailable, cluster_unreachable, detail }
}

export async function applySdn(node) {
  await api.post('/api/sdn/apply', {}, cfg(node))
}

export async function revertSdn(node) {
  await api.post('/api/sdn/revert', {}, cfg(node))
}
