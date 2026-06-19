// p3portal.org
import api from './client'

/**
 * PROJ-79: API client for /api/networks (node bridges & VLAN interfaces).
 * Every call requires ?node=<proxmox_node> to identify the Proxmox installation.
 * Proxmox is the single source of truth – no DB, last writer wins.
 */

export async function listNetworkInterfaces(node) {
  const { data } = await api.get('/api/networks', { params: { node } })
  return data // { interfaces, has_pending, permission_denied, node_unreachable, detail }
}

export async function listNetworkDevices(node) {
  const { data } = await api.get('/api/networks/devices', { params: { node } })
  return data // [ "vmbr0", "eth0", ... ]
}

export async function createNetworkInterface(node, payload) {
  const { data } = await api.post('/api/networks', payload, { params: { node } })
  return data // { iface, warnings }
}

export async function updateNetworkInterface(node, iface, payload) {
  const { data } = await api.put(`/api/networks/${encodeURIComponent(iface)}`, payload, { params: { node } })
  return data // { iface, warnings }
}

export async function checkNetworkInterfaceUsage(node, iface) {
  const { data } = await api.get(`/api/networks/${encodeURIComponent(iface)}/usage`, { params: { node } })
  return data // { iface, in_use, usages: [{vmid,name,node,kind}], incomplete }
}

export async function deleteNetworkInterface(node, iface) {
  await api.delete(`/api/networks/${encodeURIComponent(iface)}`, { params: { node } })
}

export async function reloadNetwork(node) {
  await api.post('/api/networks/reload', {}, { params: { node } })
}

export async function revertNetwork(node) {
  await api.post('/api/networks/revert', {}, { params: { node } })
}
