// p3portal.org
import api from './client'

export async function fetchPackerTemplates() {
  const { data } = await api.get('/api/packer')
  return data
}

export async function getPackerTemplate(id) {
  const { data } = await api.get(`/api/packer/${id}`)
  return data
}

export async function startPackerBuild(id, params) {
  const { data } = await api.post(`/api/packer/${id}/build`, { params })
  return data
}

export async function uploadPackerDefinition(zipFile) {
  const form = new FormData()
  form.append('zip_file', zipFile)
  const { data } = await api.post('/api/packer/upload', form)
  return data
}

export async function deletePackerTemplate(id) {
  const { data } = await api.delete(`/api/packer/${id}`)
  return data
}

export async function getPackerNodes() {
  const { data } = await api.get('/api/packer/nodes')
  return data
}

export async function getPackerIsos(node) {
  const { data } = await api.get('/api/packer/isos', { params: { node } })
  return data
}

export async function getPackerStorages(node) {
  const { data } = await api.get('/api/packer/storages', { params: { node } })
  return data
}

export async function getPackerIsoStorages(node) {
  const { data } = await api.get('/api/packer/iso-storages', { params: { node } })
  return data
}

export async function deletePackerIso(node, volid) {
  await api.delete('/api/packer/isos', { params: { node, volid } })
}

export async function queryIsoUrl(url) {
  const { data } = await api.post('/api/packer/isos/query-url', { url })
  return data
}

export async function downloadIso(payload) {
  const { data } = await api.post('/api/packer/isos/download', payload)
  return data
}

export async function fetchProxmoxTemplates() {
  const { data } = await api.get('/api/packer/proxmox-templates')
  return data
}

export async function deleteProxmoxTemplate(vmid) {
  await api.delete(`/api/packer/proxmox-templates/${vmid}`)
}

export async function getNextVmid() {
  const { data } = await api.get('/api/packer/next-vmid')
  return data
}

export async function getPackerDescription(templateId) {
  const { data } = await api.get(`/api/packer/${templateId}/description`)
  return data
}
