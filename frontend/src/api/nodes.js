// p3portal.org
import api from './client'

export async function fetchNodes() {
  const { data } = await api.get('/api/admin/nodes')
  return data
}

export async function createNode(payload) {
  const { data } = await api.post('/api/admin/nodes', payload)
  return data
}

export async function updateNode(id, payload) {
  const { data } = await api.put(`/api/admin/nodes/${id}`, payload)
  return data
}

export async function deleteNode(id) {
  await api.delete(`/api/admin/nodes/${id}`)
}

export async function testNodeConnection(id) {
  const { data } = await api.post(`/api/admin/nodes/${id}/test`)
  return data
}

export async function testNodeToken(id, role) {
  const { data } = await api.post(`/api/admin/nodes/${id}/test-token`, { role })
  return data
}

export async function setDefaultNode(id) {
  const { data } = await api.post(`/api/admin/nodes/default/${id}`)
  return data
}

export async function reorderNodes(nodeIds) {
  const { data } = await api.put('/api/admin/nodes/reorder', { node_ids: nodeIds })
  return data
}
