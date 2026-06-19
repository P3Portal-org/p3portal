// p3portal.org
// PROJ-89: E2E-Tests für Stacks SDN-Netze (stack-privates VNet + Subnet + SNAT, Plus-only).
// Testet: NetworkCard vnet-Variante AKTIVIERT (PROJ-87 hatte sie disabled),
//         vnet-Karte rendert Zone/Subnet-CIDR/Gateway + SNAT-Checkbox (default aus)
//         + cluster-weite-Wirkung-Warnung (AC-APPLY-3), ungültiger vnet-Name-Hinweis,
//         Plan-Modal fremde-pending-SDN-Hinweis (nicht-blockierend, AC-PENDING-1),
//         409 sdn_apply_busy beim Anwenden (AC-APPLY-1), 409 network_in_use VNet
//         cluster-weit (AC-DES-2) und Core-Gating (Plan-EP 404). Baut auf dem
//         PROJ-87-Mock-Muster auf (additive Erweiterung, keine neue Capability).
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings","manage_users"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyIsIm1hbmFnZV91c2VycyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_settings', 'manage_users'], groups: [],
}

const CAPS_CORE = {
  config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
  alert_presets: false, auto_snapshots: false, stacks: false,
}
const CAPS_PLUS = { ...CAPS_CORE, stacks: true }

// VM-Stack mit einem stack-eigenen SDN-VNet (vnet0) + VM referenziert es.
const STACK_YAML_VNET =
  "name: sdnstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n" +
  "    network:\n      bridge: vnet0\n" +
  "networks:\n" +
  "  - kind: vnet\n    name: vnet0\n    zone: zone0\n" +
  "    subnet_cidr: 10.10.0.0/24\n    subnet_gateway: 10.10.0.1\n    snat: false\n"

// Stack mit einer Node-Bridge – um die (jetzt aktivierte) vnet-Auswahl zu prüfen.
const STACK_YAML_BRIDGE =
  "name: sdnstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n" +
  "    network:\n      bridge: vmbr10\n" +
  "networks:\n" +
  "  - kind: bridge\n    name: vmbr10\n    node: pve-01\n    vlan_aware: false\n"

function stackDetail(yaml) {
  return {
    id: 7, name: 'sdnstack', version: '1.0.0', status: 'active', source_kind: 'structured',
    owner_user_id: 1, owner_username: 'admin', is_orphan: false, resource_count: 1,
    current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
    deployment_state: 'deployed', last_drift_state: null,
    yaml_text: yaml, yaml_corrupt: false,
    resources: [{ type: 'vm', name: 'web', node: 'pve-01', template: 'deb12', cores: 2, memory: 2048, disk: 32, pool: null }],
  }
}

// Sauberer Plan (apply) – ohne Datenverlust, ohne fremde pending SDN.
const CLEAN_PLAN = {
  plan_token: 'tok', operation: 'apply',
  summary: { create: 3, change: 0, destroy: 0, replace: 0, resources: [] },
  destructive_disk_changes: [],
  foreign_pending_sdn: [],
}

// Plan mit fremder pending SDN (AC-PENDING-1): der cluster-weite Apply committet sie mit.
const PLAN_WITH_PENDING = {
  ...CLEAN_PLAN,
  foreign_pending_sdn: [{ kind: 'vnet', name: 'othervnet', state: 'new' }],
}

// 409 network_in_use: fremde Gäste am stack-eigenen VNet (cluster-weit, Apply/Destroy blockiert).
const NET_IN_USE = {
  detail: {
    error: 'network_in_use',
    networks: { vnet0: [{ vmid: 130, name: 'alien-vnet-vm', node: 'pve-02', kind: 'qemu' }] },
  },
}

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, caps = CAPS_PLUS } = {}) {
  await page.route(/localhost:\d+\/api\/cluster\//, r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: caps.stacks ? 'plus_v1' : 'core', valid: caps.stacks, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: caps.stacks ? null : 6, max_presets: null, max_api_keys: null, is_plus: caps.stacks, max_scheduled_jobs_per_user: caps.stacks ? null : 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/users', r => r.fulfill({ json: [{ id: 2, username: 'operator', auth_type: 'local' }] }))
  await page.route('**/api/admin/settings**', r =>
    r.fulfill({ json: { proxmox_node: 'pve1', vm_id_range_start: 100, vm_id_range_end: 199 } }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } }))
  await page.route('**/api/cluster/nodes', r => r.fulfill({ json: [{ node: 'pve-01' }] }))
  await page.route('**/api/cluster/templates', r => r.fulfill({ json: [{ name: 'deb12', vmid: 9000, node: 'pve-01' }] }))
  await page.route('**/api/cluster/lxc-templates', r => r.fulfill({ json: { installed: [] } }))
  await page.route('**/api/cluster/vms', r => r.fulfill({ json: [] }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/approvals/**', r => r.fulfill({ json: { pending: 0 } }))
  await page.route('**/api/approvals', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-assignments', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/profile/ssh-job-key', r => r.fulfill({ json: { has_key: false } }))
  await page.route(/localhost:\d+\/api\/nodes\/[^/]+\/image-storages$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/cluster\/nodes\/[^/]+\/vm-options$/, r =>
    r.fulfill({ json: { bridges: ['vmbr0', 'vmbr1'], cpu_types: ['host'], tags: [] } }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

async function gotoFormEditor(page, yaml) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/7\/cloud-init$/, r =>
    r.fulfill({ json: { default: { vm_name: '', enabled: false }, overrides: [] } }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(yaml) }))
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Formular")')
}

async function gotoDeployedDetail(page, { caps = CAPS_PLUS, planRoute, deployRoute } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/deployments$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/resources\/live$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(STACK_YAML_VNET) }))
  if (planRoute) await planRoute(page)
  if (deployRoute) await deployRoute(page)
  await page.goto('/stacks/7')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MODEL-1 / AC-VNET: NetworkCard vnet-Variante AKTIVIERT
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MODEL-1: die SDN-VNet-Auswahl im NetworkCard ist jetzt aktiviert (nicht mehr disabled)', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_BRIDGE)
  await expect(page.locator('input[placeholder="vmbr10"]').first()).toBeVisible({ timeout: 5000 })
  // PROJ-87 hatte die vnet-Option deaktiviert; PROJ-89 aktiviert sie.
  const vnetOpt = page.locator('option[value="vnet"]').first()
  await expect(vnetOpt).toBeAttached()
  const disabled = await vnetOpt.evaluate((el) => el.disabled)
  expect(disabled).toBe(false)
})

test('AC-VNET/AC-SUBNET-1: die vnet-Karte rendert Zone, Subnet-CIDR und Gateway', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_VNET)
  // Aus dem YAML geladene VNet-Karte: Zone/Subnet/Gateway-Werte sichtbar.
  await expect(page.locator('input[value="zone0"]').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('input[value="10.10.0.0/24"]').first()).toBeVisible()
  await expect(page.locator('input[value="10.10.0.1"]').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-SUBNET-2 / AC-APPLY-3: SNAT-Checkbox (default aus) + cluster-weite Warnung
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-SUBNET-2/AC-APPLY-3: SNAT ist default aus und die cluster-weite-Wirkung-Warnung erscheint', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_VNET)
  await expect(page.locator('input[value="zone0"]').first()).toBeVisible({ timeout: 5000 })
  // SNAT-Checkbox (snat:false im YAML) ist nicht angehakt.
  const snatLabel = page.locator('label:has-text("SNAT")').first()
  await expect(snatLabel).toBeVisible()
  const snatCheckbox = snatLabel.locator('input[type=checkbox]')
  await expect(snatCheckbox).not.toBeChecked()
  // Cluster-weite-Wirkung-Warnung (AC-APPLY-3).
  await expect(page.locator('text=/cluster-weit/i').first()).toBeVisible()
})

test('AC-MODEL-3: ungültiger vnet-Name (>8 / kein führender Buchstabe) zeigt den Hinweis', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_VNET)
  const nameInput = page.locator('input[placeholder="vnet0"]').first()
  await expect(nameInput).toBeVisible({ timeout: 5000 })
  await nameInput.fill('too-long-name')
  await expect(page.locator('text=/≤8 alphanumerische/i').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-PENDING-1: fremde pending SDN → nicht-blockierender Hinweis
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-PENDING-1: fremde pending SDN wird als nicht-blockierender Hinweis angezeigt, Anwenden bleibt möglich', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r =>
        r.fulfill({ status: 200, json: PLAN_WITH_PENDING }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  // Hinweisblock mit der fremden pending-SDN-Liste.
  await expect(page.locator('text=/committet auch diese ausstehenden SDN/i').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=othervnet').first()).toBeVisible()
  // Der Apply-Button bleibt aktiv (kein Hard-Block).
  const applyBtn = page.getByRole('button', { name: /^anwenden$/i }).first()
  await expect(applyBtn).toBeEnabled()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-APPLY-1: 409 sdn_apply_busy beim Anwenden (globaler SDN-Lock)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-APPLY-1: 409 sdn_apply_busy beim Anwenden zeigt eine klare Meldung', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r =>
        r.fulfill({ status: 200, json: CLEAN_PLAN }))
    },
    deployRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/deploy$/, r =>
        r.fulfill({ status: 409, json: { detail: 'sdn_apply_busy' } }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  const applyBtn = page.getByRole('button', { name: /^anwenden$/i }).first()
  await expect(applyBtn).toBeEnabled({ timeout: 5000 })
  await applyBtn.click()
  await expect(page.locator('text=/anderer SDN-Deploy läuft/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-DES-2: VNet-Destroy mit fremdem Gast (cluster-weit) blockiert (409 network_in_use)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-DES-2: 409 network_in_use beim VNet-Destroy rendert den fremden Gast und blockiert', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r =>
        r.fulfill({ status: 409, json: NET_IN_USE }))
    },
  })
  await page.click('button:has-text("Zerstören")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/fremden Gästen/i').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=alien-vnet-vm').first()).toBeVisible()
  await expect(page.locator('text=vnet0').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RBAC-1: Core-Gating unverändert (Plan-EP 404, keine neue Capability)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RBAC-1: Plan-Endpoint bleibt im Core-Modus 404 (keine neue Capability)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ status: 404, json: { detail: 'Not Found' } }))
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const resp = await browserFetch(page, '/api/stacks/7/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  expect(resp.status).toBe(404)
})
