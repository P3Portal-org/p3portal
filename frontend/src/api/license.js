// p3portal.org
import axios from 'axios'
import client from './client'

// No auth required – plain axios (not the JWT-interceptor client)
export async function getLicenseStatus() {
  const { data } = await axios.get('/api/license/status')
  return data
}

// Admin-only – requires JWT
export async function getLicenseDetails() {
  const { data } = await client.get('/api/license/details')
  return data
}

// Admin-only: upload a new plus.lic file
export async function uploadLicense(file) {
  const form = new FormData()
  form.append('file', file)
  const { data } = await client.post('/api/license/upload', form)
  return data
}

// Admin-only: rename plus.lic → plus.lic.disabled and revert to Core edition
export async function deactivateLicense() {
  const { data } = await client.delete('/api/license/deactivate')
  return data
}

// PROJ-94: Admin-only — start the one-time, 30-day Plus trial.
// 409 if a valid license is active or the trial was already used.
export async function startTrial() {
  const { data } = await client.post('/api/license/trial/start')
  return data
}
