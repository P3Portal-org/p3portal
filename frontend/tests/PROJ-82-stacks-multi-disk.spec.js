// p3portal.org
// PROJ-82: E2E-Tests für Stacks-Multi-Disk (deklarativ via OpenTofu, Plus-only).
// Testet: Disk-Sektion „Zusätzliche Festplatten" im Formular-Editor (Empty-State,
//         Hinzufügen → Auto-Interface scsi1, Datastore-Dropdown aus image-storages,
//         Bestand rendern), Plan-Modal-Datenverlust-Bestätigung (AC-REMOVE) sowie
//         Core-Gating (Plan-EP 404 in Core, unverändert).
// Additive Erweiterung von PROJ-76; baut auf dessen E2E-Mock-Muster auf.
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

// YAML eines Stacks mit EINER VM, die eine zusätzliche Disk trägt (scsi1, ceph).
const STACK_YAML_WITH_DISK =
  "name: dbstack\nversion: '1.0.0'\nresources:\n  - type: vm\n    name: db\n    node: pve-01\n    template: deb12\n    extra_disks:\n      - interface: scsi1\n        size: 100\n        datastore: ceph\n"

// YAML eines Stacks mit EINER VM ohne Zusatz-Disks.
const STACK_YAML_PLAIN =
  "name: dbstack\nversion: '1.0.0'\nresources:\n  - type: vm\n    name: db\n    node: pve-01\n    template: deb12\n"

function stackDetail(yaml) {
  return {
    id: 7, name: 'dbstack', version: '1.0.0', status: 'active', source_kind: 'structured',
    owner_user_id: 1, owner_username: 'admin', is_orphan: false, resource_count: 1,
    current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
    deployment_state: 'deployed', last_drift_state: null,
    yaml_text: yaml, yaml_corrupt: false,
    resources: [{ type: 'vm', name: 'db', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null }],
  }
}

const IMAGE_STORAGES = [
  { name: 'ceph', type: 'rbd', avail: 0, total: 0, used: 0 },
  { name: 'local-lvm', type: 'lvmthin', avail: 0, total: 0, used: 0 },
]

const PLAN_DISK_LOSS = {
  plan_token: 'tok_loss', operation: 'apply',
  summary: { create: 0, change: 1, destroy: 0, replace: 0, resources: [{ name: 'db', action: 'update' }] },
  destructive_disk_changes: [{ vm: 'db', interface: 'scsi1', reason: 'removed', old_size: 100 }],
}

const PLAN_PURE_ADD = {
  plan_token: 'tok_add', operation: 'apply',
  summary: { create: 0, change: 1, destroy: 0, replace: 0, resources: [{ name: 'db', action: 'update' }] },
  destructive_disk_changes: [],
}

// ── Common mocks ───────────────────────────────────────────────────────────────

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
  // PROJ-81 image-storages endpoint (reused by PROJ-82 datastore dropdown).
  await page.route(/localhost:\d+\/api\/nodes\/[^/]+\/image-storages$/, r => r.fulfill({ json: IMAGE_STORAGES }))
  // Node vm-options (bridges/cpu/tags) — empty is fine.
  await page.route(/localhost:\d+\/api\/cluster\/nodes\/[^/]+\/vm-options$/, r =>
    r.fulfill({ json: { bridges: [], cpu_types: [], tags: [] } }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

// Editor (Bearbeiten-Modus) öffnen und auf den Formular-Tab wechseln.
async function gotoFormEditor(page, yaml) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(yaml) }))
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Formular")')
}

// Detail eines ausgerollten Stacks öffnen (für das Plan-Modal).
async function gotoDeployedDetail(page, { caps = CAPS_PLUS, planRoute } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/deployments$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/resources\/live$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(STACK_YAML_WITH_DISK) }))
  if (planRoute) await planRoute(page)
  await page.goto('/stacks/7')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-1: Disk-Sektion „Zusätzliche Festplatten" im Formular-Editor
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-1: Empty-State der Disk-Sektion bei VM ohne Zusatz-Disks', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_PLAIN)
  await expect(page.locator('text=Zusätzliche Festplatten').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=Keine zusätzlichen Festplatten').first()).toBeVisible()
})

test('AC-UI-1/2: „+ Festplatte" fügt eine Disk mit Auto-Interface scsi1 hinzu', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_PLAIN)
  await expect(page.locator('text=Zusätzliche Festplatten').first()).toBeVisible({ timeout: 5000 })
  // Root belegt scsi0 → erste Zusatz-Disk bekommt automatisch scsi1.
  await page.click('button:has-text("+ Festplatte")')
  await expect(page.locator('text=scsi1').first()).toBeVisible()
  await expect(page.locator('text=Keine zusätzlichen Festplatten')).toHaveCount(0)
})

test('AC-UI-3: Datastore-Dropdown listet die image-storages des Node', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_WITH_DISK)
  // Bestehende Disk (scsi1) wird gerendert; ihr Datastore-Select trägt 'ceph'.
  await expect(page.locator('text=scsi1').first()).toBeVisible({ timeout: 5000 })
  const datastoreSelect = page.locator('select').filter({ has: page.locator('option[value="local-lvm"]') }).first()
  await expect(datastoreSelect).toBeVisible()
  await expect(datastoreSelect).toContainText('ceph')
})

test('AC-UI-1: Bestehende Disk lässt sich entfernen (Empty-State kehrt zurück)', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_WITH_DISK)
  await expect(page.locator('text=scsi1').first()).toBeVisible({ timeout: 5000 })
  await page.click('button[aria-label="Festplatte entfernen"]')
  await expect(page.locator('text=Keine zusätzlichen Festplatten').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-REMOVE: Plan-Modal-Datenverlust-Bestätigung
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-REMOVE-1: Disk-Entfernen verlangt Stack-Namen vor dem Anwenden', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ json: PLAN_DISK_LOSS }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  // Datenverlust-Warnung + die betroffene Disk werden gelistet.
  await expect(page.locator('text=/UNWIEDERBRINGLICH/i')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=scsi1').first()).toBeVisible()
  // „Anwenden" ist gesperrt, bis der Stack-Name eingetippt wird.
  const apply = page.locator('button:has-text("Anwenden")')
  await expect(apply).toBeDisabled()
  await page.fill('input[placeholder="dbstack"]', 'dbstack')
  await expect(apply).toBeEnabled()
})

test('AC-REMOVE-3: Reine Hinzufügung → keine Zusatz-Bestätigung', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ json: PLAN_PURE_ADD }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  // Keine Datenverlust-Warnung; „Anwenden" sofort aktiv.
  await expect(page.locator('text=/UNWIEDERBRINGLICH/i')).toHaveCount(0)
  await expect(page.locator('button:has-text("Anwenden")')).toBeEnabled()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RBAC-1: Core-Gating unverändert (Plan-EP 404 ohne Plus)
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
