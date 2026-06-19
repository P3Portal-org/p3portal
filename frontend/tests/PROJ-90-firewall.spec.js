// p3portal.org
// PROJ-90: E2E-Tests für die Proxmox-Firewall-Verwaltung (Core, Datacenter/Node/VM).
// Testet: Sidebar-Gate (AC-UI-1), FirewallPage-Bereiche Datacenter+Node mit
// feinem Bereichs-Gate (AC-RBAC-1), Datacenter-Regel-Liste in Auswertungs-
// Reihenfolge (AC-LIST-1), SG/IPSets/Aliases-Sub-Tabs (AC-LIST-3), DC-enable
// read-only (AC-OPT-3), Global-disabled-Banner (AC-HINT-1), permission_denied-
// Banner statt leerer Liste (AC-LIST-4), Suche (AC-LIST-6) und den Regel-Editor
// (AC-RULE-1: Macro/Proto-Toggle + Position).
// Reine Read-View über gemockte API-Routen (kein echtes Backend); die server-
// seitige RBAC/422-Durchsetzung deckt das Backend-pytest ab (inkl. BUG-90-1).
import { test, expect } from '@playwright/test'

// Standard-Base64 (atob-kompatibel) + kompaktes JSON, S618-Lehre.
function mkToken(payload) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

const ADMIN_TOKEN = mkToken({ sub: 'admin', auth_type: 'local', role: 'admin', portal_permissions: [], exp: 9999999999, user_id: 1 })
const FW_MANAGER_TOKEN = mkToken({ sub: 'fwmgr', auth_type: 'local', role: 'operator', portal_permissions: ['manage_firewall'], exp: 9999999999, user_id: 3 })
const NODE_SCOPED_TOKEN = mkToken({ sub: 'ns', auth_type: 'local', role: 'operator', portal_permissions: [], exp: 9999999999, user_id: 4 })
const VIEWER_TOKEN = mkToken({ sub: 'viewer', auth_type: 'local', role: 'viewer', portal_permissions: [], exp: 9999999999, user_id: 2 })

const MOCK_ME_ADMIN = { id: 1, username: 'admin', role: 'admin', auth_type: 'local', portal_permissions: [], groups: [] }
const MOCK_ME_FW = { id: 3, username: 'fwmgr', role: 'operator', auth_type: 'local', portal_permissions: ['manage_firewall'], groups: [] }
const MOCK_ME_NS = { id: 4, username: 'ns', role: 'operator', auth_type: 'local', portal_permissions: [], groups: [] }
const MOCK_ME_VIEWER = { id: 2, username: 'viewer', role: 'viewer', auth_type: 'local', portal_permissions: [], groups: [] }

// One Proxmox installation (single portal_node_id → no installation selector).
const CLUSTER_NODES = [{ node: 'pve1', status: 'online', portal_node_id: 1, portal_node_name: 'Standort A' }]

const DC_RULES = {
  rules: [
    { pos: 0, type: 'in', action: 'ACCEPT', enable: true, source: '10.0.0.0/24', dest: null, proto: 'tcp', dport: '443', comment: 'web' },
    { pos: 1, type: 'in', action: 'DROP', enable: false, source: null, dest: null, comment: 'block all' },
    { pos: 2, type: 'group', action: 'webservers', enable: true, comment: 'sg ref' },
  ],
}
const DC_OPTIONS_ON = { enable: true, policy_in: 'DROP', policy_out: 'ACCEPT', ebtables: false }
const DC_OPTIONS_OFF = { enable: false, policy_in: 'ACCEPT', policy_out: 'ACCEPT', ebtables: false }
const GROUPS = { items: [{ group: 'webservers', comment: 'web tier' }] }
const IPSETS = { items: [{ name: 'trusted', comment: 'office' }] }
const ALIASES = { items: [{ name: 'gateway', cidr: '10.0.0.1', comment: 'GW' }] }
const NODE_OPTIONS = { enable: true, log_level_in: 'info', global_firewall_enabled: true }
const NODE_RULES = { rules: [{ pos: 0, type: 'in', action: 'ACCEPT', enable: true, source: '192.168.0.0/16', comment: 'lan' }] }

async function setToken(page, token) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), token)
}

async function setupMocks(page, opts = {}) {
  const {
    me = MOCK_ME_ADMIN,
    dcRules = DC_RULES,
    dcOptions = DC_OPTIONS_ON,
    nodeAssignments = [],
  } = opts

  const API = /localhost:\d+\/api\//

  await page.route(API, async route => {
    const url = route.request().url()

    // ── PROJ-90 firewall routes (LIFO: specific before generic) ──────────────
    if (url.includes('/api/firewall/datacenter/options')) return route.fulfill({ json: dcOptions })
    if (url.includes('/api/firewall/datacenter/rules'))   return route.fulfill({ json: dcRules })
    if (url.includes('/api/firewall/datacenter/groups'))  return route.fulfill({ json: GROUPS })
    if (url.includes('/api/firewall/datacenter/ipsets'))  return route.fulfill({ json: IPSETS })
    if (url.includes('/api/firewall/datacenter/aliases')) return route.fulfill({ json: ALIASES })
    if (url.includes('/api/firewall/datacenter/macros'))  return route.fulfill({ json: [{ macro: 'HTTP', descr: 'Web' }, { macro: 'SSH', descr: 'Secure shell' }] })
    if (url.includes('/api/firewall/datacenter/refs'))    return route.fulfill({ json: [{ type: 'alias', name: 'gateway', comment: 'GW' }, { type: 'ipset', name: 'trusted', comment: 'office' }] })
    if (url.match(/\/api\/firewall\/nodes\/[^/]+\/options/)) return route.fulfill({ json: NODE_OPTIONS })
    if (url.match(/\/api\/firewall\/nodes\/[^/]+\/rules/))   return route.fulfill({ json: NODE_RULES })
    if (url.includes('/api/firewall'))                    return route.fulfill({ json: {} })

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
    if (url.includes('/api/cluster/status'))        return route.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } })
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
    if (url.includes('/api/alerts'))         return route.fulfill({ json: [] })
    if (url.includes('/api/scheduled-jobs')) return route.fulfill({ json: [] })
    if (url.includes('/api/owners'))         return route.fulfill({ json: [] })
    if (url.includes('/api/playbooks'))      return route.fulfill({ json: [] })
    if (url.includes('/api/packer'))         return route.fulfill({ json: [] })
    if (url.includes('/api/admin'))          return route.fulfill({ json: [] })
    if (url.includes('/api/announcements'))  return route.fulfill({ json: [] })
    if (url.includes('/api/jobs'))           return route.fulfill({ json: [] })
    if (url.includes('/api/themes'))         return route.fulfill({ json: [] })
    if (url.includes('/api/i18n'))           return route.fulfill({ json: { lang_code: 'de' } })
    if (url.includes('/api/help'))           return route.fulfill({ json: [] })
    if (url.includes('/api/vms'))            return route.fulfill({ json: [] })

    await route.continue()
  })
}

// ── AC-UI-1: Sidebar gate ─────────────────────────────────────────────────────

test('AC-UI-1: admin sees the Firewall sidebar entry and reaches the page', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall')
  await expect(page.locator('a[href="/firewall"]')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Firewall' })).toBeVisible()
})

test('AC-UI-1: manage_firewall user sees the Firewall sidebar entry', async ({ page }) => {
  await setToken(page, FW_MANAGER_TOKEN)
  await setupMocks(page, { me: MOCK_ME_FW })
  await page.goto('/firewall')
  await expect(page.locator('a[href="/firewall"]')).toBeVisible()
})

test('AC-UI-1: a plain viewer does NOT see the Firewall sidebar entry', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)
  await setupMocks(page, { me: MOCK_ME_VIEWER })
  await page.goto('/')
  // give the sidebar time to render
  await page.waitForTimeout(300)
  await expect(page.locator('a[href="/firewall"]')).toHaveCount(0)
})

// ── AC-UI-1 / AC-RBAC-1: page areas ───────────────────────────────────────────

test('AC-UI-1: admin sees both Datacenter and Node areas', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall')
  await expect(page.getByRole('button', { name: 'Datacenter', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Node', exact: true })).toBeVisible()
})

test('AC-RBAC-1: node:manage_firewall-only user sees the Node area but not Datacenter', async ({ page }) => {
  await setToken(page, NODE_SCOPED_TOKEN)
  await setupMocks(page, {
    me: MOCK_ME_NS,
    nodeAssignments: [{ node_name: 'pve1', preset_node_actions: ['node:manage_firewall'] }],
  })
  await page.goto('/firewall')
  await expect(page.getByRole('button', { name: 'Node', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Datacenter', exact: true })).toHaveCount(0)
})

// ── AC-LIST: datacenter rules + objects ───────────────────────────────────────

test('AC-LIST-1: datacenter rules are listed in evaluation order with action + source', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall?area=datacenter')
  await expect(page.getByText('ACCEPT')).toBeVisible()
  await expect(page.getByText('10.0.0.0/24')).toBeVisible()
  await expect(page.getByText('→ webservers')).toBeVisible()
})

test('AC-LIST-3: datacenter has Security-Groups / IPSets / Aliases sub-tabs', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall?area=datacenter')
  await page.getByRole('button', { name: 'Security-Groups' }).click()
  await expect(page.getByText('webservers')).toBeVisible()
  await page.getByRole('button', { name: 'IPSets' }).click()
  await expect(page.getByText('trusted')).toBeVisible()
  await page.getByRole('button', { name: 'Aliases' }).click()
  await expect(page.getByText('gateway')).toBeVisible()
})

test('AC-OPT-3: datacenter enable is shown read-only', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall?area=datacenter')
  await page.getByRole('button', { name: 'Optionen' }).click()
  await expect(page.getByText(/Globale Firewall:/)).toBeVisible()
  await expect(page.getByText(/nur lesbar/)).toBeVisible()
})

test('AC-HINT-1: global-disabled banner appears when the datacenter firewall is off', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN, dcOptions: DC_OPTIONS_OFF })
  await page.goto('/firewall?area=datacenter')
  await expect(page.getByText(/globale Datacenter-Firewall ist/)).toBeVisible()
})

test('AC-LIST-4: permission_denied renders a banner instead of a silent empty list', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN, dcRules: { permission_denied: true } })
  await page.goto('/firewall?area=datacenter')
  await expect(page.getByText(/Kein Zugriff in Proxmox/)).toBeVisible()
})

test('AC-LIST-6: search filters the datacenter rules', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall?area=datacenter')
  await expect(page.getByText('ACCEPT')).toBeVisible()
  await page.getByPlaceholder(/Suche/).fill('block all')
  await expect(page.getByText('DROP')).toBeVisible()
  await expect(page.getByText('ACCEPT')).toHaveCount(0)
})

// ── AC-RULE-1 / EC-4: rule editor ─────────────────────────────────────────────

test('AC-RULE-1/EC-4: rule editor toggles between Macro and custom proto/ports', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall?area=datacenter')
  await page.getByRole('button', { name: '+ Regel anlegen' }).click()
  await expect(page.getByRole('heading', { name: 'Firewall-Regel anlegen' })).toBeVisible()
  // custom mode by default → proto <select> present, no macro <select>
  await expect(page.getByLabel('Protokoll')).toBeVisible()
  await expect(page.getByLabel('Macro', { exact: true })).toHaveCount(0)
  // switch to macro → macro <select> appears, proto <select> gone (EC-4 mutual exclusion)
  await page.getByLabel(/Macro \(vordefinierter Dienst\)/).check()
  await expect(page.getByLabel('Macro', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Protokoll')).toHaveCount(0)
})

// ── AC-UI-1: Node area ────────────────────────────────────────────────────────

test('AC-UI-1: Node area lists the node rules behind the node selector', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupMocks(page, { me: MOCK_ME_ADMIN })
  await page.goto('/firewall?area=node')
  await expect(page.getByText('192.168.0.0/16')).toBeVisible()
})
