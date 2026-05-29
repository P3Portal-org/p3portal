// p3portal.org
// PROJ-73: Node-Updates API-Client
import api from '../../api/client'

export async function fetchNodeUpdatesSummary() {
  const { data } = await api.get('/api/nodes/updates/summary')
  return data
}

export async function fetchNodeUpdates(portalNodeId) {
  const { data } = await api.get(`/api/nodes/${portalNodeId}/updates`)
  return data
}

export async function refreshNodeUpdates(portalNodeId) {
  const { data } = await api.post(`/api/nodes/${portalNodeId}/updates/refresh`)
  return data
}
