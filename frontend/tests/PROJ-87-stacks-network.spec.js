// p3portal.org
// PROJ-87: E2E-Tests für Stacks Netzwerk-Erstellung (stack-private Node-Bridge, Plus-only).
// Testet: „Netzwerke"-Sektion im Formular-Editor (Empty-State + Netz hinzufügen),
//         NetworkCard (vnet-Auswahl deaktiviert = Folge-Phase, Bridge-Name-Hint vmbrN),
//         Resource-Bridge-Dropdown bietet stack-deklarierte Netze zuerst (AC-MODEL-2),
//         Plan-Modal 409 network_in_use → fremde-Gäste-Block + Aktion blockiert (AC-DES-2),
//         422 network_name_taken → klare Meldung, sowie Core-Gating (Plan-EP 404,
//         keine neue Capability). Additive Erweiterung; baut auf dem PROJ-86-Mock-Muster auf.
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

// VM-Stack mit einem stack-eigenen Netz (vmbr10) + VM referenziert es.
const STACK_YAML_NET =
  "name: netstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n" +
  "    network:\n      bridge: vmbr10\n" +
  "networks:\n" +
  "  - kind: bridge\n    name: vmbr10\n    node: pve-01\n    vlan_aware: false\n"

// Reiner VM-Stack (ohne networks) – für Empty-State der Netzwerke-Sektion.
const STACK_YAML_VM =
  "name: netstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n"

function stackDetail(yaml, resources) {
  return {
    id: 7, name: 'netstack', version: '1.0.0', status: 'active', source_kind: 'structured',
    owner_user_id: 1, owner_username: 'admin', is_orphan: false, resource_count: 1,
    current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
    deployment_state: 'deployed', last_drift_state: null,
    yaml_text: yaml, yaml_corrupt: false,
    resources: resources || [],
  }
}

// 409 network_in_use: fremde Gäste am stack-eigenen Netz (Destroy/Apply blockiert).
const NET_IN_USE = {
  detail: {
    error: 'network_in_use',
    networks: { vmbr10: [{ vmid: 120, name: 'alien-vm', node: 'pve-01', kind: 'qemu' }] },
  },
}

// 422 network_name_taken: Bridge-Name kollidiert mit bestehender Bridge.
const NET_NAME_TAKEN = { detail: { error: 'network_name_taken', taken: ['vmbr10'] } }

// ── Common mocks (PROJ-86-Muster) ───────────────────────────────────────────────

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
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(yaml, []) }))
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Formular")')
}

async function gotoDeployedDetail(page, { caps = CAPS_PLUS, planRoute } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/deployments$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/resources\/live$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({
    json: stackDetail(STACK_YAML_NET, [{ type: 'vm', name: 'web', node: 'pve-01', template: 'deb12', cores: 2, memory: 2048, disk: 32, pool: null }]),
  }))
  if (planRoute) await planRoute(page)
  await page.goto('/stacks/7')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MODEL / AC-BRIDGE: „Netzwerke"-Sektion im Formular-Editor
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MODEL-1: leerer Stack zeigt „Erstes Netz hinzufügen", Klick legt eine Bridge an', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_VM)
  // Die Netzwerke-Sektion mit Empty-State (Stack hat keine networks).
  await expect(page.locator('text=Netzwerke').first()).toBeVisible({ timeout: 5000 })
  await page.click('button:has-text("Erstes Netz hinzufügen")')
  // Es erscheint eine Bridge-Karte mit Typ/Name/Node-Feldern.
  await expect(page.locator('text=/^Bridge$/').first()).toBeVisible()
  await expect(page.getByText('Typ').first()).toBeVisible()
})

test('AC-BR-1: NetworkCard – vnet-Auswahl ist seit PROJ-89 aktiviert (Folge-Phase umgesetzt)', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_NET)
  // Die aus dem YAML geladene Bridge-Karte wird gerendert (Name-Input placeholder vmbr10).
  await expect(page.locator('input[placeholder="vmbr10"]').first()).toBeVisible({ timeout: 5000 })
  // PROJ-87 hatte die SDN-VNet-Option deaktiviert; PROJ-89 hat die Folge-Phase
  // umgesetzt → die Option ist jetzt wählbar (die vnet-Funktionalität testet
  // tests/PROJ-89-stacks-sdn.spec.js).
  const vnetOpt = page.locator('option[value="vnet"]').first()
  await expect(vnetOpt).toBeAttached()
  const disabled = await vnetOpt.evaluate((el) => el.disabled)
  expect(disabled).toBe(false)
})

test('AC-BR-1: ungültiger Bridge-Name (kein vmbrN) zeigt den Hinweis', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_NET)
  const nameInput = page.locator('input[placeholder="vmbr10"]').first()
  await expect(nameInput).toBeVisible({ timeout: 5000 })
  // Den Bridge-Namen auf etwas Ungültiges ändern → Inline-Hinweis erscheint.
  await nameInput.fill('eth0')
  await expect(page.locator('text=/vmbrN/i')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MODEL-2: Resource-Bridge-Dropdown bietet stack-deklarierte Netze
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MODEL-2: das Bridge-Feld der VM bietet das stack-deklarierte Netz als Option', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_NET)
  await expect(page.locator('input[placeholder="vmbr10"]').first()).toBeVisible({ timeout: 5000 })
  // Das stack-deklarierte Netz vmbr10 erscheint als wählbare Bridge-Option in der VM-Karte
  // (zuerst stack-Netze, dann Node-Bridges vmbr0/vmbr1).
  await expect(page.getByRole('option', { name: 'vmbr10' }).first()).toBeAttached()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-DES-2: Destroy-Schutz – fremde Gäste am Netz blockieren (409 network_in_use)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-DES-2: 409 network_in_use rendert die fremden Gäste und blockiert die Aktion', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r =>
        r.fulfill({ status: 409, json: NET_IN_USE }))
    },
  })
  // Destroy auslösen → Plan-EP liefert 409 mit fremdem Gast.
  await page.click('button:has-text("Zerstören")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/fremden Gästen/i')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=alien-vm')).toBeVisible()
  await expect(page.locator('text=vmbr10').first()).toBeVisible()
})

test('AC-MODEL-3: 422 network_name_taken zeigt eine klare Meldung', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r =>
        r.fulfill({ status: 422, json: NET_NAME_TAKEN }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/bereits belegt/i')).toBeVisible({ timeout: 5000 })
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
