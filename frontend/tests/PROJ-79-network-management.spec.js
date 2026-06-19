// p3portal.org
// PROJ-79: E2E-Tests für Netzwerk-Verwaltung (Node-Bridges & VLANs)
// Testet: Tab-Gate (RBAC), Liste, Pending-Banner, Filter, permission_denied,
// node_unreachable, Bridge-/VLAN-Anlegen-Modals, Lösch-Nutzungsprüfung, Reload-Warnung.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN = H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' + '.fake-sig'

// {"sub":"netmgr","auth_type":"local","role":"operator","portal_permissions":["manage_networks"],"exp":9999999999,"user_id":4}
const NET_MANAGER_TOKEN = H + '.' +
  'eyJzdWIiOiJuZXRtZ3IiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsInBvcnRhbF9wZXJtaXNzaW9ucyI6WyJtYW5hZ2VfbmV0d29ya3MiXSwiZXhwIjo5OTk5OTk5OTk5LCJ1c2VyX2lkIjo0fQ' + '.fake-sig'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999,"user_id":2}
const VIEWER_TOKEN = H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjJ9' + '.fake-sig'

// {"sub":"scoped","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999,"user_id":5}
const SCOPED_TOKEN = H + '.' +
  'eyJzdWIiOiJzY29wZWQiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjV9' + '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_ME_ADMIN     = { id: 1, username: 'admin',  role: 'admin',    auth_type: 'local', portal_permissions: ['manage_settings'], groups: [] }
const MOCK_ME_MANAGER   = { id: 4, username: 'netmgr', role: 'operator', auth_type: 'local', portal_permissions: ['manage_networks'], groups: [] }
const MOCK_ME_VIEWER    = { id: 2, username: 'viewer', role: 'viewer',   auth_type: 'local', portal_permissions: [], groups: [] }
const MOCK_ME_SCOPED    = { id: 5, username: 'scoped', role: 'viewer',   auth_type: 'local', portal_permissions: [], groups: [] }

const MOCK_NODE = {
  id: 1, name: 'Heimserver', proxmox_node: 'pve1',
  host_url: 'https://pve.example.com:8006', verify_ssl: false, is_default: true,
}
const CLUSTER_NODE = {
  node: 'pve1', status: 'online', portal_node_name: 'Heimserver', portal_node_id: 1,
  cpu: 0.3, maxcpu: 8, mem: 8589934592, maxmem: 34359738368,
  disk: 10737418240, maxdisk: 107374182400, uptime: 86400,
}
const NODE_DETAIL = {
  node: 'pve1', status: 'online', cpu: 0.3, maxcpu: 8,
  mem: 8589934592, maxmem: 34359738368, disk: 10737418240, maxdisk: 107374182400,
  uptime: 86400, pveversion: '8.2.0', storage_pools: [], network_interfaces: [],
}

const NETWORK_LIST = {
  interfaces: [
    { iface: 'vmbr0', type: 'bridge', cidr: '192.168.1.10/24', gateway: '192.168.1.1',
      autostart: true, active: true, pending: false, bridge_ports: ['eth0'],
      bridge_vlan_aware: false, comments: 'Management' },
    { iface: 'vmbr1', type: 'bridge', cidr: null, autostart: true, active: true,
      pending: true, bridge_ports: [], bridge_vlan_aware: true, comments: '' },
    { iface: 'vmbr0.100', type: 'vlan', cidr: '10.0.100.1/24', autostart: false,
      active: true, pending: false, vlan_id: 100, vlan_raw_device: 'vmbr0', comments: 'Gäste' },
  ],
  has_pending: true,
  permission_denied: false,
  node_unreachable: false,
}
const NETWORK_LIST_NO_PENDING = { ...NETWORK_LIST, has_pending: false,
  interfaces: NETWORK_LIST.interfaces.map(i => ({ ...i, pending: false })) }
const NETWORK_DENIED      = { interfaces: [], has_pending: false, permission_denied: true, node_unreachable: false }
const NETWORK_UNREACHABLE = { interfaces: [], has_pending: false, permission_denied: false, node_unreachable: true, detail: 'Verbindung fehlgeschlagen' }
const NETWORK_DEVICES     = ['eth0', 'eth1', 'vmbr0']
const USAGE_IN_USE = {
  iface: 'vmbr0', in_use: true, incomplete: false,
  usages: [{ vmid: 100, name: 'web', node: 'pve1', kind: 'qemu' }, { vmid: 101, name: 'db', node: 'pve1', kind: 'lxc' }],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), token)
}

async function setupMocks(page, opts = {}) {
  const {
    me               = MOCK_ME_ADMIN,
    networks         = NETWORK_LIST_NO_PENDING,
    nodeAssignments  = [],
    devices          = NETWORK_DEVICES,
    usage            = USAGE_IN_USE,
    createStatus     = 201,
    createBody       = { iface: 'vmbr5', warnings: [] },
    deleteStatus     = 204,
    reloadStatus     = 204,
  } = opts

  const API = /localhost:\d+\/api\//

  await page.route(API, async route => {
    const url    = route.request().url()
    const method = route.request().method()

    // ── PROJ-79 networks routes (LIFO: specific before generic) ─────────────
    if (url.includes('/api/networks/devices'))
      return route.fulfill({ json: devices })
    if (url.includes('/api/networks/reload') && method === 'POST')
      return route.fulfill({ status: reloadStatus })
    if (url.includes('/api/networks/revert') && method === 'POST')
      return route.fulfill({ status: 204 })
    if (url.match(/\/api\/networks\/[^/]+\/usage/) && method === 'GET')
      return route.fulfill({ json: usage })
    if (url.match(/\/api\/networks\/[^/]+/) && method === 'PUT')
      return route.fulfill({ json: { iface: 'vmbr1', warnings: [] } })
    if (url.match(/\/api\/networks\/[^/]+/) && method === 'DELETE')
      return route.fulfill({ status: deleteStatus })
    if (url.includes('/api/networks') && method === 'POST')
      return route.fulfill({ status: createStatus, json: createBody })
    if (url.includes('/api/networks'))
      return route.fulfill({ json: networks })

    // ── Node assignments (tab gate, PROJ-47) ─────────────────────────────────
    if (url.includes('/api/me/node-assignments')) return route.fulfill({ json: nodeAssignments })

    // ── Notifications / Tooling ──────────────────────────────────────────────
    if (url.includes('/api/notifications/unread-summary'))
      return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications')) return route.fulfill({ json: [] })
    if (url.includes('/api/system/tooling'))
      return route.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } })

    // ── Node / Cluster ───────────────────────────────────────────────────────
    if (url.includes('/api/node-assignments'))      return route.fulfill({ json: [] })
    if (url.includes('/api/nodes/updates/summary')) return route.fulfill({ json: { entries: [] } })
    if (url.match(/\/api\/nodes\/\d+\/updates/))    return route.fulfill({ json: { members: [] } })
    if (url.includes('/api/admin/nodes'))           return route.fulfill({ json: [MOCK_NODE] })
    if (url.includes('/api/cluster/status'))        return route.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/detail/)) return route.fulfill({ json: NODE_DETAIL })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/tasks/))  return route.fulfill({ json: [] })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/backups/))return route.fulfill({ json: [] })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/storage/))return route.fulfill({ json: [] })
    if (url.includes('/api/cluster/nodes'))         return route.fulfill({ json: [CLUSTER_NODE] })
    if (url.includes('/api/cluster/vms/ips'))       return route.fulfill({ json: {} })
    if (url.includes('/api/cluster/vms'))           return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))               return route.fulfill({ json: [] })

    // ── Auth & User ──────────────────────────────────────────────────────────
    if (url.includes('/api/license/status'))   return route.fulfill({ json: { edition: 'core', is_plus_edition: false, license_valid: false } })
    if (url.includes('/api/capabilities'))     return route.fulfill({ json: {} })
    if (url.includes('/api/me/permissions'))   return route.fulfill({ json: { roles: [], permissions: [], assignments: [] } })
    if (url.includes('/api/me'))               return route.fulfill({ json: me })
    if (url.includes('/api/setup/status'))     return route.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } })
    if (url.includes('/api/portal/config'))    return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    if (url.includes('/api/sidebar-pins'))     return route.fulfill({ json: [] })

    // ── catch-all ────────────────────────────────────────────────────────────
    if (url.includes('/api/alerts'))           return route.fulfill({ json: [] })
    if (url.includes('/api/scheduled-jobs'))   return route.fulfill({ json: [] })
    if (url.includes('/api/owners'))           return route.fulfill({ json: [] })
    if (url.includes('/api/playbooks'))        return route.fulfill({ json: [] })
    if (url.includes('/api/packer'))           return route.fulfill({ json: [] })
    if (url.includes('/api/admin'))            return route.fulfill({ json: [] })
    if (url.includes('/api/announcements'))    return route.fulfill({ json: [] })
    if (url.includes('/api/jobs'))             return route.fulfill({ json: [] })
    if (url.includes('/api/themes'))           return route.fulfill({ json: [] })
    if (url.includes('/api/i18n'))             return route.fulfill({ json: { lang_code: 'de' } })
    if (url.includes('/api/help'))             return route.fulfill({ json: [] })
    if (url.includes('/api/vms'))              return route.fulfill({ json: [] })

    await route.continue()
  })
}

/** Navigate to the Compute Node detail with the Netzwerk tab open. */
async function goToNetworkTab(page, nodeName = 'pve1') {
  await page.goto(`/compute?node=${encodeURIComponent(nodeName)}&tab=networks`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(700)
}

// ── AC-RBAC: Tab-Gate ─────────────────────────────────────────────────────────

test('AC-RBAC-1: Tab "Netzwerk" ist für Admin sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page)
  await goToNetworkTab(page)
  await expect(page.locator('button').filter({ hasText: /^Netzwerk$/ })).toBeVisible({ timeout: 8000 })
})

test('AC-RBAC-3: Tab ist für Nutzer mit manage_networks sichtbar', async ({ page }) => {
  await setToken(page, NET_MANAGER_TOKEN)
  await setupMocks(page, { me: MOCK_ME_MANAGER })
  await goToNetworkTab(page)
  await expect(page.locator('button').filter({ hasText: /^Netzwerk$/ })).toBeVisible({ timeout: 8000 })
})

test('AC-RBAC-3: Tab ist via node:manage_network-Zuweisung sichtbar', async ({ page }) => {
  await setToken(page, SCOPED_TOKEN)
  await setupMocks(page, {
    me: MOCK_ME_SCOPED,
    nodeAssignments: [{ node_name: 'pve1', preset_node_actions: ['node:manage_network'] }],
  })
  await goToNetworkTab(page)
  await expect(page.locator('button').filter({ hasText: /^Netzwerk$/ })).toBeVisible({ timeout: 8000 })
})

test('AC-RBAC-4: Tab ist für Viewer ohne Rechte NICHT sichtbar', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  // Realistic: a viewer's list call returns API 403 (server-side gate is authoritative).
  await setupMocks(page, { me: MOCK_ME_VIEWER, nodeAssignments: [] })
  await goToNetworkTab(page)
  // Page loaded (tab bar present) but the Netzwerk tab button must be hidden.
  await expect(page.locator('button').filter({ hasText: 'Node Details' })).toBeVisible({ timeout: 8000 })
  await expect(page.locator('button').filter({ hasText: /^Netzwerk$/ })).toHaveCount(0)
})

// ── AC-LIST: Auflisten ────────────────────────────────────────────────────────

test('AC-LIST-1: Bridges und VLANs werden gelistet', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_LIST })
  await goToNetworkTab(page)
  await expect(page.getByText('vmbr0', { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('vmbr1')).toBeVisible()   // cell also carries inline "VLAN-aware" label
  await expect(page.getByText('vmbr0.100', { exact: true })).toBeVisible()
})

test('AC-LIST-2: ausstehendes Interface zeigt "ausstehend"-Badge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_LIST })
  await goToNetworkTab(page)
  await expect(page.getByText('ausstehend', { exact: true })).toBeVisible({ timeout: 8000 })
})

test('AC-APPLY-1: Pending-Banner mit Übernehmen/Verwerfen-Buttons', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_LIST })
  await goToNetworkTab(page)
  await expect(page.getByText(/Übernehmen \(Reload\)/)).toBeVisible({ timeout: 8000 })
  await expect(page.getByText(/Verwerfen \(Revert\)/)).toBeVisible()
})

test('AC-LIST-4: Typ-Filter grenzt auf VLANs ein', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_LIST })
  await goToNetworkTab(page)
  await page.getByText('vmbr0.100', { exact: true }).waitFor({ timeout: 8000 })
  await page.selectOption('select', 'vlan')
  await expect(page.getByText('vmbr0', { exact: true })).toHaveCount(0)
  await expect(page.getByText('vmbr0.100', { exact: true })).toBeVisible()
})

test('AC-LIST-5: permission_denied → "Kein Zugriff in Proxmox"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_DENIED })
  await goToNetworkTab(page)
  await expect(page.getByText(/Kein Zugriff in Proxmox/)).toBeVisible({ timeout: 8000 })
})

test('AC-LIST-6: node_unreachable → Hinweis mit Ursache', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_UNREACHABLE })
  await goToNetworkTab(page)
  await expect(page.getByText(/Node nicht erreichbar/)).toBeVisible({ timeout: 8000 })
})

// ── AC-CB / AC-CV: Anlegen ────────────────────────────────────────────────────

test('AC-CB-1: "Bridge anlegen" öffnet das Bridge-Formular', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page)
  await goToNetworkTab(page)
  await page.getByRole('button', { name: '+ Bridge anlegen' }).click()
  await expect(page.getByText('Linux-Bridge anlegen')).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('VLAN-aware (802.1q)')).toBeVisible()
  await expect(page.locator('#br-name')).toBeVisible()
})

test('AC-CV-1: "VLAN anlegen" öffnet das VLAN-Formular mit abgeleitetem Namen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page)
  await goToNetworkTab(page)
  await page.getByRole('button', { name: '+ VLAN anlegen' }).click()
  await expect(page.getByText('VLAN-Interface anlegen')).toBeVisible({ timeout: 5000 })
  // raw device + tag → derived name preview
  await page.selectOption('#vl-rawdev', 'vmbr0')
  await page.fill('#vl-tag', '200')
  await expect(page.getByText('vmbr0.200')).toBeVisible()
})

test('AC-CB-4: Bridge anlegen ruft POST und schließt das Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  let posted = false
  await setupMocks(page)
  page.on('request', r => { if (r.method() === 'POST' && r.url().includes('/api/networks') && !r.url().includes('reload') && !r.url().includes('revert')) posted = true })
  await goToNetworkTab(page)
  await page.getByRole('button', { name: '+ Bridge anlegen' }).click()
  await page.fill('#br-name', 'vmbr5')
  await page.getByRole('button', { name: 'Bridge anlegen', exact: true }).click()
  await page.waitForTimeout(700)
  expect(posted).toBe(true)
  await expect(page.getByText('Linux-Bridge anlegen')).toHaveCount(0)
})

test('BUG-79-1: Pending-Banner bleibt nach Anlegen sichtbar (Backend meldet kein pending)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  // List reports has_pending:false even after create (PVE without per-iface pending flag).
  await setupMocks(page, { networks: NETWORK_LIST_NO_PENDING })
  await goToNetworkTab(page)
  // No banner initially.
  await expect(page.getByText(/Übernehmen \(Reload\)/)).toHaveCount(0)
  await page.getByRole('button', { name: '+ Bridge anlegen' }).click()
  await page.fill('#br-name', 'vmbr5')
  await page.getByRole('button', { name: 'Bridge anlegen', exact: true }).click()
  await page.waitForTimeout(700)
  // Sticky pendingHint keeps the apply banner visible despite has_pending:false.
  await expect(page.getByText(/Übernehmen \(Reload\)/)).toBeVisible({ timeout: 5000 })
})

// ── AC-DEL: Löschen mit Nutzungsprüfung ───────────────────────────────────────

test('AC-DEL-1/2: Löschen einer genutzten Bridge zeigt betroffene Gäste', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_LIST_NO_PENDING, usage: USAGE_IN_USE })
  await goToNetworkTab(page)
  await page.getByText('vmbr0', { exact: true }).waitFor({ timeout: 8000 })
  // first row delete button
  await page.getByRole('button', { name: 'Löschen' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/wird noch von .* genutzt/)).toBeVisible({ timeout: 5000 })
  await expect(dialog.getByText('web')).toBeVisible()
  await expect(dialog.getByText(/db/)).toBeVisible()
})

// ── AC-APPLY-2: Reload-Warnung ────────────────────────────────────────────────

test('AC-APPLY-2: "Übernehmen" zeigt Konnektivitäts-Warnung', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { networks: NETWORK_LIST })
  await goToNetworkTab(page)
  await page.getByRole('button', { name: /Übernehmen \(Reload\)/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/Konnektivität zum Node kann dabei kurz gestört sein/)).toBeVisible({ timeout: 5000 })
  await expect(dialog.getByText(/vmbr0/)).toBeVisible()
})
