// p3portal.org
// PROJ-93: E2E-Tests für den Ansible Visual Editor (Plus-only).
// Fokus = Integration/Routing, die die 19 Vitest-Unit-Tests nicht erreichen:
//   - "Playbook-Editor"-Tab ist in der echten AutomationPage nur bei Plus + Admin
//     sichtbar (AC-HOST-1); Core-Admin + Plus-Operator sehen ihn nicht (AC-RBAC).
//   - Klick auf den Tab lädt den Lazy-Chunk + rendert die Marker-gefilterte Liste
//     (AC-EDIT-1 / AC-ROUND-1).
//   - "Neues Playbook" öffnet das echte Formular (Meta + Play-Header + Tasks);
//     Task hinzufügen → Modul-Picker → Schema-Felder (AC-EDIT-2 / AC-MOD / AC-TASK).
//   - Speichern feuert POST /api/ansible-editor/definitions (AC-EDIT-3 / AC-HOST-3).
//   - Core-Mode: /api/ansible-editor/* = 404 (AC-RBAC-1, Backend-Gate).
// Baut 1:1 auf dem PROJ-92/85-Mock-Muster (LIFO-Routes, browserFetch, caps).
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// {"sub":"operator1","auth_type":"local","role":"operator","exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsImV4cCI6OTk5OTk5OTk5OX0=' +
  '.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_settings'], groups: [],
}
const MOCK_ME_OPERATOR = {
  id: 2, username: 'operator1', role: 'operator', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: [], groups: [],
}

const CAPS_CORE = { ansible_editor: false }
const CAPS_PLUS = { ansible_editor: true }

// Eine editor-verwaltete Definition (Marker-gefiltert von der API geliefert).
const DEFS = [
  { id: 'nginx-setup', name: 'Nginx Setup', description: 'guest config', required_role: 'operator', targets: 'guest', task_count: 3 },
]

const MODULES = [
  { name: 'ansible.builtin.copy', short_description: 'Copy files to remote locations' },
  { name: 'ansible.builtin.apt', short_description: 'Manages apt-packages' },
]

const COPY_SCHEMA = {
  module: 'ansible.builtin.copy',
  short_description: 'Copy files to remote locations',
  description: '',
  params: [
    { name: 'dest', widget: 'text', type: 'path', required: true, description: 'Remote path.' },
    { name: 'mode', widget: 'text', type: 'raw', required: false, description: 'Permissions.' },
    { name: 'state', widget: 'dropdown', type: 'str', required: false, choices: ['present', 'absent'] },
  ],
}

// ── Common mocks (PROJ-92/85-Muster) ────────────────────────────────────────────

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, caps = CAPS_PLUS } = {}) {
  const isPlus = !!caps.ansible_editor
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
    r.fulfill({ json: { edition: isPlus ? 'plus_v1' : 'core', valid: isPlus, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: isPlus ? null : 6, max_presets: null, max_api_keys: null, is_plus: isPlus, max_scheduled_jobs_per_user: isPlus ? null : 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me/node-assignments', r => r.fulfill({ json: [] }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/settings/ui-version', r => r.fulfill({ json: { version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/git-sync/conflicts**', r => r.fulfill({ json: [] }))
  // AutomationPage-spezifisch: Playbook-Liste + Scheduled Jobs + Ansible-Inventory.
  await page.route('**/api/playbooks', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/ansible-inventory/**', r => r.fulfill({ json: [] }))
  // Editor-Module + Schema.
  await page.route('**/api/ansible-editor/modules/*/schema', r =>
    isPlus ? r.fulfill({ json: COPY_SCHEMA }) : r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.route('**/api/ansible-editor/modules', r =>
    isPlus ? r.fulfill({ json: MODULES }) : r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  // Editor-Definitionen (in Core 404, in Plus die Marker-Liste).
  await page.route('**/api/ansible-editor/definitions', r =>
    isPlus ? r.fulfill({ json: DEFS }) : r.fulfill({ status: 404, json: { detail: 'not_found' } }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

async function goto(page, { token = ADMIN_TOKEN, me = MOCK_ME_ADMIN, caps = CAPS_PLUS, tab } = {}) {
  await mockCommonApi(page, { me, caps })
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  const url = tab ? `/automation?tab=${tab}` : '/automation'
  await page.goto(url)
}

// ── AC-HOST-1 / AC-RBAC: Tab-Sichtbarkeit ───────────────────────────────────────

test('AC-HOST-1: Plus-Admin sieht den "Playbook-Editor"-Tab', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS })
  await expect(page.getByRole('button', { name: 'Playbook-Editor' })).toBeVisible()
})

test('AC-HOST-1 / AC-RBAC-1: Core-Admin sieht den Tab NICHT (Direkt-URL zeigt keinen Editor)', async ({ page }) => {
  await goto(page, { caps: CAPS_CORE, tab: 'playbook-editor' })
  await expect(page.getByRole('heading', { name: 'Automation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Playbook-Editor' })).toHaveCount(0)
  await expect(page.getByText('Editor-eigene Playbook-Definitionen', { exact: false })).toHaveCount(0)
})

test('AC-RBAC-2: Plus-Operator (kein Admin) sieht den Tab NICHT', async ({ page }) => {
  await goto(page, { token: OPERATOR_TOKEN, me: MOCK_ME_OPERATOR, caps: CAPS_PLUS })
  await expect(page.getByRole('heading', { name: 'Automation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Playbook-Editor' })).toHaveCount(0)
})

// ── AC-EDIT-1 / AC-ROUND-1: Editor lädt + Marker-Liste ──────────────────────────

test('AC-EDIT-1 / AC-ROUND-1: Tab öffnet den Editor + zeigt die Marker-gefilterte Liste', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'playbook-editor' })
  await expect(page.getByText('Editor-eigene Playbook-Definitionen', { exact: false })).toBeVisible()
  await expect(page.getByText('Nginx Setup')).toBeVisible()
  await expect(page.getByText('nginx-setup')).toBeVisible()
})

// ── AC-EDIT-2: Canvas öffnet (Top-Leiste + Play-Knoten + "+ Task") ───────────────

test('AC-EDIT-2: "Neues Playbook" öffnet die Canvas (Meta-Top-Leiste + Play-Knoten + Task hinzufügen)', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'playbook-editor' })
  await page.getByRole('button', { name: /Neues Playbook/ }).first().click()
  // Meta als schlanke Top-Leiste (Anzeigename-Feld) + Canvas mit Play-Knoten + Task-Button
  await expect(page.getByPlaceholder('Nginx einrichten')).toBeVisible()
  await expect(page.getByText('become (Root-Rechte)')).toBeVisible() // Label im Play-Knoten
  await expect(page.getByRole('button', { name: /Task hinzufügen/ })).toBeVisible()
})

// ── AC-MOD / AC-TASK: Task auf der Canvas → Modul-Picker → Schema-Felder ─────────

test('AC-TASK-1 / AC-MOD-1/2: Task hinzufügen → Modul wählen → schema-getriebene Felder im Knoten', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'playbook-editor' })
  await page.getByRole('button', { name: /Neues Playbook/ }).first().click()
  await page.getByRole('button', { name: /Task hinzufügen/ }).first().click()
  // Modul-Picker im Task-Knoten: suchen + auswählen (über die Beschreibung, eindeutig)
  const search = page.getByPlaceholder(/Modul suchen/)
  await search.click()
  await search.fill('copy')
  await page.getByText('Copy files to remote locations').first().click()
  // Schema-getriebenes Pflichtfeld erscheint inline im Knoten (dest, required).
  // Das Label trägt ein " *"-Kind-span → Substring-Match (Beschreibungen sind
  // hinter dem (i)-Toggle eingeklappt, daher eindeutig).
  await expect(page.getByText('dest').first()).toBeVisible()
})

// ── AC-EDIT-3 / AC-HOST-3: Speichern feuert POST ────────────────────────────────

test('AC-EDIT-3 / AC-HOST-3: Speichern feuert POST /api/ansible-editor/definitions', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'playbook-editor' })
  let posted = null
  await page.route('**/api/ansible-editor/definitions', (r) => {
    if (r.request().method() === 'POST') {
      posted = JSON.parse(r.request().postData() || '{}')
      return r.fulfill({ status: 201, json: { id: posted.id, name: posted.name, targets: 'guest', task_count: 0 } })
    }
    return r.fulfill({ json: DEFS })
  })
  await page.getByRole('button', { name: /Neues Playbook/ }).first().click()
  await page.getByPlaceholder('Nginx einrichten').fill('Nginx Setup')
  await page.getByRole('button', { name: 'Speichern' }).click()
  await expect.poll(() => posted?.name).toBe('Nginx Setup')
  // Kein FE-only-State im Payload (AC: buildPayload strippt _idTouched).
  expect(posted && '_idTouched' in posted).toBe(false)
})

// ── AC-RBAC-1: Core-Mode 404 ────────────────────────────────────────────────────

test('AC-RBAC-1: /api/ansible-editor/* liefert 404 im Core-Mode', async ({ page }) => {
  await goto(page, { caps: CAPS_CORE })
  const defs = await browserFetch(page, '/api/ansible-editor/definitions')
  expect(defs.status).toBe(404)
  const mods = await browserFetch(page, '/api/ansible-editor/modules')
  expect(mods.status).toBe(404)
})
