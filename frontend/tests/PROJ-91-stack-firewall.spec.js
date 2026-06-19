// p3portal.org
// PROJ-91: E2E-Tests für die deklarative Stack-Firewall (Plus-only, reitet auf der
// stacks-Capability, Core-404 geerbt). Testet: Gast-Firewall-Sektion im VM-Card
// (einklappbar, enabled-Schalter, AC-MODEL-1/2), Vorab-Expansion bei FW-Block,
// AC-ENABLE-2-Warnung (Regeln ohne enabled → greifen nicht), Regel-Editor öffnen,
// Stack-Security-Group-Sektion (Empty-State + Add, AC-MODEL-3), SG-Namens-
// validierung >10 Zeichen (AC-MODEL-4), Plan-Firewall-Hinweis (§H) und Core-Gating
// (Plan-EP 404, keine neue Capability, AC-RBAC-3). Baut auf dem PROJ-89-Mock-
// Muster auf (additive Erweiterung, kein neuer Endpoint).
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

// Reiner VM-Stack ohne Firewall (zum Hinzufügen von FW / SG).
const STACK_YAML_PLAIN =
  "name: fwstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n" +
  "    network:\n      bridge: vmbr0\n"

// VM mit aktivem Firewall-Block: Egress-Whitelist (policy_out DROP + nur 443 raus).
const STACK_YAML_FW =
  "name: fwstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n" +
  "    network:\n      bridge: vmbr0\n" +
  "    firewall:\n      enabled: true\n      policy_out: DROP\n" +
  "      rules:\n        - type: out\n          action: ACCEPT\n          proto: tcp\n          dport: '443'\n"

// VM mit Regeln, aber Firewall NICHT aktiviert → AC-ENABLE-2-Warnung.
const STACK_YAML_FW_INERT =
  "name: fwstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n" +
  "    network:\n      bridge: vmbr0\n" +
  "    firewall:\n      enabled: false\n      policy_out: DROP\n" +
  "      rules:\n        - type: out\n          action: ACCEPT\n          proto: tcp\n          dport: '443'\n"

// Stack mit einer stack-eigenen Security-Group (zum Namens-Validierungstest).
const STACK_YAML_SG =
  "name: fwstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n" +
  "    network:\n      bridge: vmbr0\n" +
  "security_groups:\n  - name: web\n    rules: []\n"

function stackDetail(yaml) {
  return {
    id: 7, name: 'fwstack', version: '1.0.0', status: 'active', source_kind: 'structured',
    owner_user_id: 1, owner_username: 'admin', is_orphan: false, resource_count: 1,
    current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
    deployment_state: 'deployed', last_drift_state: null,
    yaml_text: yaml, yaml_corrupt: false,
    resources: [{ type: 'vm', name: 'web', node: 'pve-01', template: 'deb12', cores: 2, memory: 2048, disk: 32, pool: null }],
  }
}

// Sauberer Plan (apply) – ohne Datenverlust.
const CLEAN_PLAN = {
  plan_token: 'tok', operation: 'apply',
  summary: { create: 1, change: 0, destroy: 0, replace: 0, resources: [] },
  destructive_disk_changes: [],
  foreign_pending_sdn: [],
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
  // PROJ-91: cluster-weite Firewall-Refs (best-effort) für die Regel-Dropdowns.
  await page.route('**/api/firewall/datacenter/refs**', r => r.fulfill({ json: [] }))
  await page.route('**/api/firewall/datacenter/macros**', r => r.fulfill({ json: [] }))
  await page.route('**/api/firewall/datacenter/groups**', r => r.fulfill({ json: { items: [] } }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

async function gotoFormEditor(page, yaml, { caps = CAPS_PLUS } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks\/7\/cloud-init$/, r =>
    r.fulfill({ json: { default: { vm_name: '', enabled: false }, overrides: [] } }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(yaml) }))
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Formular")')
}

async function gotoDeployedDetail(page, { yaml = STACK_YAML_FW, caps = CAPS_PLUS, planRoute } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/deployments$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/resources\/live$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(yaml) }))
  if (planRoute) await planRoute(page)
  await page.goto('/stacks/7')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MODEL-1/2: Gast-Firewall-Sektion im VM-Card
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MODEL-1: die Gast-Firewall-Sektion erscheint im VM-Card und klappt auf', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_PLAIN)
  const fwToggle = page.locator('button:has-text("Firewall")').first()
  await expect(fwToggle).toBeVisible({ timeout: 5000 })
  // Eingeklappt: der enabled-Schalter ist noch nicht sichtbar.
  await expect(page.locator('text=Firewall am Gast aktivieren')).toHaveCount(0)
  await fwToggle.click()
  await expect(page.locator('text=Firewall am Gast aktivieren').first()).toBeVisible()
})

test('AC-MODEL-2: ein aktiver Firewall-Block aus dem YAML wird vorab aufgeklappt (Egress-Whitelist)', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_FW)
  // Vorab aufgeklappt: der enabled-Schalter ist direkt sichtbar + angehakt.
  const enableCheckbox = page.locator('label:has-text("Firewall am Gast aktivieren")').locator('input[type=checkbox]').first()
  await expect(enableCheckbox).toBeVisible({ timeout: 5000 })
  await expect(enableCheckbox).toBeChecked()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-ENABLE-2: Regeln definiert, aber Firewall nicht aktiviert → Warnung (kein Block)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-ENABLE-2: Regeln ohne aktivierte Firewall zeigen die „greifen nicht"-Warnung', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_FW_INERT)
  await expect(page.locator('text=/greifen nicht/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RULE: der deklarative Regel-Editor öffnet sich
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RULE-1: „Regel hinzufügen" öffnet den deklarativen Regel-Editor', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_FW)
  // FW-Block ist vorab offen → der „Regel hinzufügen"-Button ist sichtbar.
  const addRuleBtn = page.locator('button:has-text("Regel hinzufügen")').first()
  await expect(addRuleBtn).toBeVisible({ timeout: 5000 })
  await addRuleBtn.click()
  await expect(page.locator('text=Firewall-Regel hinzufügen').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MODEL-3: Stack-eigene Security-Groups-Sektion
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MODEL-3: die Security-Groups-Sektion zeigt den Empty-State und legt eine erste SG an', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_PLAIN)
  await expect(page.locator('text=Security-Groups').first()).toBeVisible({ timeout: 5000 })
  const addFirst = page.locator('button:has-text("Erste Security-Group hinzufügen")').first()
  await expect(addFirst).toBeVisible()
  await addFirst.click()
  // Die SG-Karte erscheint (Name-Input mit placeholder web-egress).
  await expect(page.locator('input[placeholder="web-egress"]').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MODEL-4: SG-Namensvalidierung (Proxmox-FW-Namens-Regex). Die ≤10-Zeichen-
// Grenze erzwingt das Input bereits per maxLength; der Hinweis greift für einen
// regex-ungültigen Namen (z. B. mit führender Ziffer).
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MODEL-4: ein regex-ungültiger SG-Name (führende Ziffer) zeigt den Namens-Hinweis', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_SG)
  const nameInput = page.locator('input[placeholder="web-egress"]').first()
  await expect(nameInput).toBeVisible({ timeout: 5000 })
  await nameInput.fill('9bad')
  await expect(page.locator('text=/≤10 Zeichen/i').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// §H: Plan-Firewall-Hinweis (informativ, Pfad-B-Artefakte nach dem Deploy)
// ═══════════════════════════════════════════════════════════════════════════════

test('§H: das Plan-Modal zeigt den informativen Firewall-Hinweis bei aktivem FW-Block', async ({ page }) => {
  await gotoDeployedDetail(page, {
    yaml: STACK_YAML_FW,
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r =>
        r.fulfill({ status: 200, json: CLEAN_PLAN }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/nach dem Deploy angewendet/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RBAC-3: Core-Gating unverändert (Plan-EP 404, keine neue Capability)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RBAC-3: der Stack-Plan-Endpoint bleibt im Core-Modus 404 (Firewall erbt das Gate)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ status: 404, json: { detail: 'Not Found' } }))
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const resp = await browserFetch(page, '/api/stacks/7/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  expect(resp.status).toBe(404)
})
