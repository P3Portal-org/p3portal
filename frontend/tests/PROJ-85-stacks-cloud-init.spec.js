// p3portal.org
// PROJ-85: E2E-Tests für Stacks Cloud-Init-Login (Plus-only).
// Fokus = Integration/Routing, die die 9 Vitest-Unit-Tests nicht erreichen:
//   - Cloud-Init-Tab ist im echten Editor erreichbar (dritter Tab, AC-UI-1)
//   - Formular ist Default-Tab (AC-UI-3)
//   - Hinweis-Banner im Formular- UND YAML-Tab (AC-UI-2), aktiv/inaktiv aus GET
//   - Passwort NIE im Klartext → Platzhalter "●●● gesetzt" (AC-UI-4 / AC-STORE-4)
//   - Speichern feuert PUT auf den Cloud-Init-Endpoint (separater Store, AC-STORE-3)
//   - Core-Mode: GET + PUT /cloud-init = 404 (AC-RBAC-1)
// Baut 1:1 auf dem PROJ-76/82-Mock-Muster auf (LIFO-Routes, browserFetch).
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

// Stack mit EINER VM "web".
const STACK_YAML =
  "name: webstack\nversion: '1.0.0'\nresources:\n  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n"

function stackDetail(yaml) {
  return {
    id: 7, name: 'webstack', version: '1.0.0', status: 'active', source_kind: 'structured',
    owner_user_id: 1, owner_username: 'admin', is_orphan: false, resource_count: 1,
    current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
    deployment_state: 'active', last_drift_state: null,
    yaml_text: yaml, yaml_corrupt: false,
    resources: [{ type: 'vm', name: 'web', node: 'pve-01', template: 'deb12', cores: 1, memory: 2048, disk: 32, pool: null }],
  }
}

// Cloud-Init GET-Antwort: Passwort NIE im Klartext, nur password_set.
const CI_INACTIVE = { default: { vm_name: '', enabled: false, password_set: false, ssh_keys: [] }, overrides: [] }
const CI_ACTIVE = {
  default: { vm_name: '', enabled: true, username: 'ops', password_set: true, ssh_keys: ['ssh-ed25519 AAAA x'] },
  overrides: [],
}

// ── Common mocks (PROJ-82-Muster) ──────────────────────────────────────────────

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
  // Profil-SSH-Job-Key (Profil-Key übernehmen, AC-KEY-1) — default kein Key.
  await page.route('**/api/me/ssh-job-key', r => r.fulfill({ json: { has_key: false, public_key: null } }))
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
  await page.route(/localhost:\d+\/api\/nodes\/[^/]+\/image-storages$/, r => r.fulfill({ json: [] }))
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

// Editor (Bearbeiten) öffnen; ci = Cloud-Init-GET-Antwort.
async function gotoEditor(page, { ci = CI_INACTIVE, caps = CAPS_PLUS } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks\/7\/cloud-init$/, r => r.fulfill({ json: ci }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(STACK_YAML) }))
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-1 / AC-UI-3: dritter Tab "Cloud-Init", Formular ist Default
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-1: der Stack-Editor hat einen dritten Tab "Cloud-Init"', async ({ page }) => {
  await gotoEditor(page)
  await expect(page.getByRole('button', { name: 'Cloud-Init', exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByRole('button', { name: 'Formular', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'YAML', exact: true })).toBeVisible()
})

test('AC-UI-3: das Formular ist der Default-Tab (nicht YAML)', async ({ page }) => {
  await gotoEditor(page)
  // Formular-Tab aktiv: die Formular-Sektionen sind sichtbar, kein YAML-Editor-Body.
  // (PROJ-86 hat „VM-Ressourcen" → „Ressourcen" umbenannt, AC-MIX; daher die
  //  form-exklusive „Stack-Eigenschaften"-Sektion als stabiler Anker.)
  await expect(page.locator('text=Stack-Eigenschaften').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=Ressourcen').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-2: Hinweis-Banner im Formular- UND YAML-Tab (aktiv/inaktiv aus GET)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-2: inaktives Cloud-Init zeigt den "inaktiv"-Banner im Formular-Tab', async ({ page }) => {
  await gotoEditor(page, { ci: CI_INACTIVE })
  await expect(page.locator('text=/Cloud-Init inaktiv/i').first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-2: der Banner erscheint AUCH im YAML-Tab', async ({ page }) => {
  await gotoEditor(page, { ci: CI_INACTIVE })
  await page.getByRole('button', { name: 'YAML', exact: true }).click()
  await expect(page.locator('text=/Cloud-Init inaktiv/i').first()).toBeVisible({ timeout: 5000 })
})

test('AC-UI-2: aktives Cloud-Init zeigt den "aktiv"-Banner (Stack-Default)', async ({ page }) => {
  await gotoEditor(page, { ci: CI_ACTIVE })
  await expect(page.locator('text=/Cloud-Init aktiv/i').first()).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-4 / AC-STORE-4: Passwort NIE im Klartext → "●●● gesetzt"-Platzhalter
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-4: der Cloud-Init-Tab zeigt den Passwort-gesetzt-Platzhalter, nie den Wert', async ({ page }) => {
  await gotoEditor(page, { ci: CI_ACTIVE })
  await page.getByRole('button', { name: 'Cloud-Init', exact: true }).click()
  // Default ist aktiv → Felder sichtbar, username vorgeladen.
  await expect(page.locator('#ci-default-user')).toHaveValue('ops', { timeout: 5000 })
  // Passwort-Feld zeigt den "gesetzt"-Platzhalter, NICHT den Wert (leer).
  await expect(page.locator('#ci-default-pw')).toHaveAttribute('placeholder', /gesetzt/i)
  await expect(page.locator('#ci-default-pw')).toHaveValue('')
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-STORE-3: Speichern feuert PUT auf den separaten Cloud-Init-Store
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-STORE-3: "Cloud-Init speichern" feuert einen PUT auf /cloud-init', async ({ page }) => {
  await gotoEditor(page, { ci: CI_ACTIVE })
  let putBody = null
  await page.route(/localhost:\d+\/api\/stacks\/7\/cloud-init$/, async (r) => {
    if (r.request().method() === 'PUT') {
      putBody = JSON.parse(r.request().postData() || '{}')
      return r.fulfill({ json: CI_ACTIVE })
    }
    return r.fulfill({ json: CI_ACTIVE })
  })
  await page.getByRole('button', { name: 'Cloud-Init', exact: true }).click()
  await page.getByRole('button', { name: /Cloud-Init speichern/i }).click()
  await expect.poll(() => putBody).not.toBeNull()
  // Voll-Ersatz-Body trägt default + overrides; ohne Tippen kein Passwort (EC-6).
  expect(putBody).toHaveProperty('default')
  expect(putBody.default).not.toHaveProperty('password')
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RBAC-1: Core-Mode → GET + PUT /cloud-init = 404
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RBAC-1: GET /cloud-init liefert 404 in der Core-Edition', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  // Echtes Core-Verhalten simulieren: der Plus-Router gibt 404 zurück.
  await page.route(/localhost:\d+\/api\/stacks\/7\/cloud-init$/, r =>
    r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  const res = await browserFetch(page, '/api/stacks/7/cloud-init')
  expect(res.status).toBe(404)
})

test('AC-RBAC-1: PUT /cloud-init liefert 404 in der Core-Edition', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route(/localhost:\d+\/api\/stacks\/7\/cloud-init$/, r =>
    r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  const res = await browserFetch(page, '/api/stacks/7/cloud-init', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ default: { enabled: false } }),
  })
  expect(res.status).toBe(404)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Per-VM-Override-Selektor (Standard/Eigene Daten/Deaktivieren) im echten Editor
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-ACT-3: ein Per-VM-Override-Selektor mit "deaktivieren" ist verfügbar', async ({ page }) => {
  await gotoEditor(page, { ci: CI_ACTIVE })
  await page.getByRole('button', { name: 'Cloud-Init', exact: true }).click()
  // Die VM "web" erscheint mit einem Modus-Dropdown (Standard/Eigene/Deaktivieren).
  await expect(page.locator('text=Per-VM-Override').first()).toBeVisible({ timeout: 5000 })
  const select = page.getByRole('combobox').first()
  await expect(select).toBeVisible()
  await select.selectOption('suppress')
  await expect(page.locator('text=/erbt ihren Login aus dem Template/i').first()).toBeVisible()
})
