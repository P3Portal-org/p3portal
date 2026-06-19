// p3portal.org
// PROJ-80: E2E-Tests für die cluster-weite SDN-Verwaltung + Netzwerk-Sidebar-Bereich.
// Testet: Sidebar-Gate (RBAC), zwei Bereiche (Node-Interfaces + SDN) mit feinem
// Bereichs-Gate, SDN-Liste (Zonen/VNets/Subnets), Pending-Badge + cluster-weites
// Apply/Revert mit Warnung, Suche, permission_denied, sdn_unavailable (EC-7),
// Zone-/VNet-/Subnet-Anlegen-Modals (inkl. VLAN-Tag-Abhängigkeit EC-9) und die
// Lösch-Nutzungsprüfung mit betroffenen Gästen.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":[],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN = H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5LCJ1c2VyX2lkIjoxfQ' + '.fake-sig'

// {"sub":"sdnmgr","auth_type":"local","role":"viewer","portal_permissions":["manage_sdn"],"exp":9999999999,"user_id":3}
const SDN_MANAGER_TOKEN = H + '.' +
  'eyJzdWIiOiJzZG5tZ3IiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOlsibWFuYWdlX3NkbiJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjN9' + '.fake-sig'

// {"sub":"netmgr","auth_type":"local","role":"operator","portal_permissions":["manage_networks"],"exp":9999999999,"user_id":4}
const NET_MANAGER_TOKEN = H + '.' +
  'eyJzdWIiOiJuZXRtZ3IiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsInBvcnRhbF9wZXJtaXNzaW9ucyI6WyJtYW5hZ2VfbmV0d29ya3MiXSwiZXhwIjo5OTk5OTk5OTk5LCJ1c2VyX2lkIjo0fQ' + '.fake-sig'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999,"user_id":2}
const VIEWER_TOKEN = H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjJ9' + '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_ME_ADMIN   = { id: 1, username: 'admin',  role: 'admin',    auth_type: 'local', portal_permissions: [], groups: [] }
const MOCK_ME_SDN     = { id: 3, username: 'sdnmgr', role: 'viewer',   auth_type: 'local', portal_permissions: ['manage_sdn'], groups: [] }
const MOCK_ME_NET     = { id: 4, username: 'netmgr', role: 'operator', auth_type: 'local', portal_permissions: ['manage_networks'], groups: [] }
const MOCK_ME_VIEWER  = { id: 2, username: 'viewer', role: 'viewer',   auth_type: 'local', portal_permissions: [], groups: [] }

// Two independent standalone installations (distinct portal_node_id) → SDN gets
// an installation selector; one Proxmox cluster would collapse to a single entry.
const CLUSTER_NODES = [
  { node: 'pve1', status: 'online', portal_node_id: 1, portal_node_name: 'Standort A' },
  { node: 'pve2', status: 'online', portal_node_id: 2, portal_node_name: 'Standort B' },
]

const SDN_ZONES = {
  items: [
    { id: 'zone1', type: 'simple', mtu: 1500, nodes: 'pve1', pending: false, state: null },
    { id: 'vlanz', type: 'vlan', bridge: 'vmbr0', pending: true, state: 'new' },
  ],
  has_pending: true,
}
const SDN_ZONES_NO_PENDING = {
  items: SDN_ZONES.items.map(z => ({ ...z, pending: false, state: null })),
  has_pending: false,
}
const SDN_VNETS = {
  items: [
    { id: 'vnet1', zone: 'vlanz', tag: 100, alias: 'frontend', vlanaware: false, pending: false, state: null },
  ],
  has_pending: false,
}
const SDN_SUBNETS = {
  items: [
    { id: 'zone1-10.0.0.0-24', vnet: 'vnet1', cidr: '10.0.0.0/24', gateway: '10.0.0.1', snat: true, pending: false, state: null },
  ],
  has_pending: false,
}
const SDN_UNAVAILABLE   = { items: [], sdn_unavailable: true }
const SDN_PERM_DENIED   = { items: [], permission_denied: true }
const VNET_USAGE = {
  id: 'vnet1', in_use: true, incomplete: false,
  vms: [{ vmid: 100, name: 'web', node: 'pve1', kind: 'qemu' }, { vmid: 101, name: 'db', node: 'pve2', kind: 'lxc' }],
  subnets: ['zone1-10.0.0.0-24'],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), token)
}

async function setupMocks(page, opts = {}) {
  const {
    me               = MOCK_ME_ADMIN,
    zones            = SDN_ZONES_NO_PENDING,
    vnets            = SDN_VNETS,
    subnets          = SDN_SUBNETS,
    vnetUsage        = VNET_USAGE,
    nodeAssignments  = [],
  } = opts

  const API = /localhost:\d+\/api\//

  await page.route(API, async route => {
    const url    = route.request().url()
    const method = route.request().method()

    // ── PROJ-80 SDN routes (LIFO: specific before generic) ───────────────────
    if (url.includes('/api/sdn/bridges'))                     return route.fulfill({ json: { bridges: ['vmbr0', 'vmbr1'], incomplete: false } })
    if (url.includes('/api/sdn/apply') && method === 'POST')  return route.fulfill({ status: 204 })
    if (url.includes('/api/sdn/revert') && method === 'POST') return route.fulfill({ status: 204 })
    if (url.match(/\/api\/sdn\/zones\/[^/]+\/usage/) && method === 'GET')
      return route.fulfill({ json: { id: 'zone1', in_use: false, vnets: [] } })
    if (url.match(/\/api\/sdn\/vnets\/[^/]+\/usage/) && method === 'GET')
      return route.fulfill({ json: vnetUsage })
    if (url.match(/\/api\/sdn\/zones\/[^/]+/) && method === 'PUT')    return route.fulfill({ json: { id: 'z', warnings: [] } })
    if (url.match(/\/api\/sdn\/zones\/[^/]+/) && method === 'DELETE') return route.fulfill({ status: 204 })
    if (url.includes('/api/sdn/zones') && method === 'POST')         return route.fulfill({ status: 201, json: { id: 'newz', warnings: [] } })
    if (url.includes('/api/sdn/zones'))                              return route.fulfill({ json: zones })
    if (url.match(/\/api\/sdn\/vnets\/[^/]+/) && method === 'PUT')    return route.fulfill({ json: { id: 'v', warnings: [] } })
    if (url.match(/\/api\/sdn\/vnets\/[^/]+/) && method === 'DELETE') return route.fulfill({ status: 204 })
    if (url.includes('/api/sdn/vnets') && method === 'POST')         return route.fulfill({ status: 201, json: { id: 'newv', warnings: [] } })
    if (url.includes('/api/sdn/vnets'))                             return route.fulfill({ json: vnets })
    if (url.match(/\/api\/sdn\/subnets\/[^/]+\/[^/]+/) && method === 'PUT')    return route.fulfill({ json: { id: 's', warnings: [] } })
    if (url.match(/\/api\/sdn\/subnets\/[^/]+\/[^/]+/) && method === 'DELETE') return route.fulfill({ status: 204 })
    if (url.includes('/api/sdn/subnets') && method === 'POST')       return route.fulfill({ status: 201, json: { id: 'news', warnings: [] } })
    if (url.includes('/api/sdn/subnets'))                          return route.fulfill({ json: subnets })

    // ── PROJ-79 networks (Node-Interfaces area reuses ComputeNetworkTab) ──────
    if (url.includes('/api/networks/devices')) return route.fulfill({ json: ['eth0', 'vmbr0'] })
    if (url.includes('/api/networks'))         return route.fulfill({ json: { interfaces: [], has_pending: false } })

    // ── Node assignments (area gate) ─────────────────────────────────────────
    if (url.includes('/api/me/node-assignments')) return route.fulfill({ json: nodeAssignments })

    // ── Notifications / Tooling ──────────────────────────────────────────────
    if (url.includes('/api/notifications/unread-summary'))
      return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications')) return route.fulfill({ json: [] })
    if (url.includes('/api/system/tooling'))
      return route.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } })

    // ── Node / Cluster ───────────────────────────────────────────────────────
    if (url.includes('/api/nodes/updates/summary')) return route.fulfill({ json: { entries: [] } })
    if (url.includes('/api/admin/nodes'))           return route.fulfill({ json: [] })
    if (url.includes('/api/cluster/status'))        return route.fulfill({ json: { quorum: true, node_count: 2, ha_status: 'none', unreachable_nodes: [] } })
    if (url.includes('/api/cluster/nodes'))         return route.fulfill({ json: CLUSTER_NODES })
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

async function goToNetwork(page, area = '') {
  await page.goto(area ? `/network?area=${area}` : '/network')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(600)
}

// ── AC-NAV-1: Sidebar-Gate ──────────────────────────────────────────────────────

test('AC-NAV-1: Sidebar-Punkt "Netzwerk" ist für Admin sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page)
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('a[href="/network"]')).toBeVisible({ timeout: 8000 })
})

test('AC-NAV-1: Sidebar-Punkt "Netzwerk" ist für manage_sdn sichtbar', async ({ page }) => {
  await setToken(page, SDN_MANAGER_TOKEN)
  await setupMocks(page, { me: MOCK_ME_SDN })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('a[href="/network"]')).toBeVisible({ timeout: 8000 })
})

test('AC-NAV-1: Sidebar-Punkt "Netzwerk" ist für rechtlosen Viewer NICHT sichtbar', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  await setupMocks(page, { me: MOCK_ME_VIEWER })
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('a[href="/network"]')).toHaveCount(0)
})

// ── AC-NAV-2 / AC-NAV-5: Bereiche & Bereichs-Gate ───────────────────────────────

test('AC-NAV-2: Admin sieht beide Bereiche (Node-Interfaces + SDN)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page)
  await goToNetwork(page)
  await expect(page.locator('button').filter({ hasText: 'Node-Interfaces' })).toBeVisible({ timeout: 8000 })
  await expect(page.locator('button').filter({ hasText: 'SDN (Cluster)' })).toBeVisible()
})

test('AC-NAV-5: SDN-Manager (manage_sdn) sieht nur SDN-Bereich, kein Node-Interfaces-Tab', async ({ page }) => {
  await setToken(page, SDN_MANAGER_TOKEN)
  await setupMocks(page, { me: MOCK_ME_SDN })
  await goToNetwork(page)
  await expect(page.locator('button').filter({ hasText: 'SDN (Cluster)' })).toBeVisible({ timeout: 8000 })
  await expect(page.locator('button').filter({ hasText: 'Node-Interfaces' })).toHaveCount(0)
  // SDN is the default area for an SDN-only manager → zones load.
  await expect(page.getByText('zone1', { exact: true })).toBeVisible({ timeout: 8000 })
})

test('AC-NAV-5: Netz-Manager (manage_networks) sieht nur Node-Interfaces, kein SDN-Tab', async ({ page }) => {
  await setToken(page, NET_MANAGER_TOKEN)
  await setupMocks(page, { me: MOCK_ME_NET })
  await goToNetwork(page)
  await expect(page.locator('button').filter({ hasText: 'Node-Interfaces' })).toBeVisible({ timeout: 8000 })
  await expect(page.locator('button').filter({ hasText: 'SDN (Cluster)' })).toHaveCount(0)
})

// ── Multi-Installation: Installations-Auswahl im SDN-Bereich ────────────────────

test('Multi-Installation: SDN-Bereich bietet eine Installations-Auswahl', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await page.getByText('zone1', { exact: true }).waitFor({ timeout: 8000 })
  const sel = page.locator('#sdn-install')
  await expect(sel).toBeVisible()
  await expect(sel.locator('option', { hasText: 'Standort A' })).toHaveCount(1)
  await expect(sel.locator('option', { hasText: 'Standort B' })).toHaveCount(1)
  // Switching installation keeps the SDN view working (remounts the tab).
  await sel.selectOption({ label: 'Standort B' })
  await expect(page.getByText('zone1', { exact: true })).toBeVisible({ timeout: 8000 })
})

// ── AC-LIST: Auflisten ──────────────────────────────────────────────────────────

test('AC-LIST-1: SDN-Bereich listet Zonen, VNets und Subnets', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await expect(page.getByText('zone1', { exact: true })).toBeVisible({ timeout: 8000 })
  await expect(page.getByText('vnet1').first()).toBeVisible()
  await expect(page.getByText('10.0.0.0/24')).toBeVisible()
})

test('AC-LIST-2: ausstehende Zone zeigt "neu"-Status-Badge', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await expect(page.getByText('neu', { exact: true })).toBeVisible({ timeout: 8000 })
})

test('AC-LIST-3: Suche grenzt entitätsübergreifend ein', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await page.getByText('zone1', { exact: true }).waitFor({ timeout: 8000 })
  // "simple" matcht nur den Typ von zone1; vlanz/vnet1 fallen raus.
  await page.getByPlaceholder(/Suche/).fill('simple')
  await expect(page.getByText('zone1', { exact: true })).toBeVisible()
  await expect(page.getByText('vlanz', { exact: true })).toHaveCount(0)
})

test('AC-LIST-4: permission_denied → "Kein Zugriff in Proxmox"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_PERM_DENIED })
  await goToNetwork(page, 'sdn')
  await expect(page.getByText(/Kein Zugriff in Proxmox/)).toBeVisible({ timeout: 8000 })
})

test('EC-7: sdn_unavailable → "SDN ist auf diesem Cluster nicht verfügbar"', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_UNAVAILABLE })
  await goToNetwork(page, 'sdn')
  await expect(page.getByText(/SDN ist auf diesem Cluster nicht verfügbar/)).toBeVisible({ timeout: 8000 })
})

// ── AC-APPLY: Übernehmen / Verwerfen (cluster-weit) ─────────────────────────────

test('AC-APPLY-1: Pending-Banner mit Übernehmen/Verwerfen', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await expect(page.getByRole('button', { name: /Übernehmen \(cluster-weit\)/ })).toBeVisible({ timeout: 8000 })
  await expect(page.getByRole('button', { name: 'Verwerfen' })).toBeVisible()
})

test('AC-APPLY-2: Übernehmen öffnet cluster-weite Warnung (ALLE Nodes)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await page.getByRole('button', { name: /Übernehmen \(cluster-weit\)/ }).click()
  await expect(page.getByText(/SDN-Änderungen cluster-weit übernehmen/)).toBeVisible({ timeout: 8000 })
  await expect(page.getByText(/auf ALLEN Nodes/)).toBeVisible()
})

// ── AC-CZ / AC-CV / AC-CS: Anlegen-Modals ───────────────────────────────────────

test('AC-CZ-1: "Zone anlegen" öffnet das Zonen-Modal', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page)
  await goToNetwork(page, 'sdn')
  await page.getByText('zone1', { exact: true }).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: '+ Zone anlegen' }).click()
  await expect(page.getByText('SDN-Zone anlegen')).toBeVisible()
  // VLAN-Typ wählen → Bridge-Pflichtfeld erscheint als Dropdown der Cluster-Bridges
  await page.selectOption('#sdnz-type', 'vlan')
  const bridgeField = page.locator('#sdnz-bridge')
  await expect(bridgeField).toBeVisible()
  await expect(bridgeField).toHaveJSProperty('tagName', 'SELECT')
  await expect(bridgeField.locator('option', { hasText: 'vmbr0' })).toHaveCount(1)
  await expect(bridgeField.locator('option', { hasText: 'Eigener Wert' })).toHaveCount(1)
})

test('AC-CV-1/EC-9: VNet-Modal zeigt VLAN-Tag nur bei VLAN-Zone', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await page.getByText('zone1', { exact: true }).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: '+ VNet anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'VNet anlegen' })).toBeVisible()
  // Default zone = zone1 (simple) → kein Tag-Feld
  await expect(page.locator('#sdnv-tag')).toHaveCount(0)
  // VLAN-Zone wählen → Tag-Feld erscheint (Pflicht)
  await page.selectOption('#sdnv-zone', 'vlanz')
  await expect(page.locator('#sdnv-tag')).toBeVisible()
})

test('AC-CS-1: "Subnet anlegen" öffnet das Subnet-Modal mit VNet-Dropdown', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await page.getByText('zone1', { exact: true }).waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: '+ Subnet anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Subnet anlegen' })).toBeVisible()
  await expect(page.locator('#sdns-vnet')).toBeVisible()
  await expect(page.locator('#sdns-cidr')).toBeVisible()
})

// ── AC-DEL: Löschen mit Nutzungsprüfung ─────────────────────────────────────────

test('AC-DEL-1/2: VNet löschen zeigt betroffene Gäste (cluster-weit)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { zones: SDN_ZONES })
  await goToNetwork(page, 'sdn')
  await page.getByText('vnet1').first().waitFor({ timeout: 8000 })
  // Im VNets-Abschnitt den Löschen-Button der Zeile klicken.
  const vnetRow = page.locator('tr', { hasText: 'vnet1' }).first()
  await vnetRow.getByRole('button', { name: 'Löschen' }).click()
  // Nutzungsprüfung listet die referenzierenden Gäste rot (im Dialog gescopet).
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/wird von .* als Bridge genutzt/)).toBeVisible({ timeout: 8000 })
  await expect(dialog.getByText(/web/)).toBeVisible()
  await expect(dialog.getByText(/db \(lxc/)).toBeVisible()
})
