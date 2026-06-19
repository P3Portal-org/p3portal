// p3portal.org
// PROJ-92: E2E-Tests für den Packer Visual Editor (Plus-only).
// Fokus = Integration/Routing, die die 15 Vitest-Unit-Tests nicht erreichen:
//   - "Build Editor"-Tab ist im echten ImageFactoryPage nur bei Plus + Admin
//     sichtbar (AC-HOST-1); Core-Admin + Plus-Operator sehen ihn nicht (AC-RBAC).
//   - Klick auf den Tab lädt den Lazy-Chunk + rendert die Marker-gefilterte Liste
//     (AC-EDIT-1 / AC-ROUND-2).
//   - "Neue Definition" öffnet das echte Formular (Meta + Source iso-Default +
//     Installer); Source-Toggle clone blendet den Installer aus (AC-SRC-1/EC-5).
//   - Speichern feuert POST /api/packer-editor/definitions (AC-EDIT-3 / AC-HOST-3).
//   - Core-Mode: /api/packer-editor/* = 404 (AC-RBAC-2, Backend-Gate).
// Baut 1:1 auf dem PROJ-85-Mock-Muster (LIFO-Routes, browserFetch, caps).
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

const CAPS_CORE = { packer_editor: false }
const CAPS_PLUS = { packer_editor: true }

// Eine editor-verwaltete Definition (Marker-gefiltert von der API geliefert).
const DEFS = [
  { id: 'debian-13', name: 'Debian 13', description: 'Trixie', required_role: 'operator', source_type: 'proxmox-iso' },
]

// ── Common mocks (PROJ-85-Muster) ───────────────────────────────────────────────

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, caps = CAPS_PLUS } = {}) {
  const isPlus = !!caps.packer_editor
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
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/settings/ui-version', r => r.fulfill({ json: { version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/users', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/settings**', r =>
    r.fulfill({ json: { proxmox_node: 'pve1', vm_id_range_start: 100, vm_id_range_end: 199 } }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  // Image-Factory-spezifisch
  await page.route('**/api/packer/templates', r => r.fulfill({ json: [] }))
  await page.route('**/api/git-sync/conflicts**', r => r.fulfill({ json: [] }))
  // Editor-EPs: in Core-Mode 404, in Plus die Liste (spezifischere Route weiter unten je Test).
  await page.route('**/api/packer-editor/definitions', r =>
    isPlus
      ? r.fulfill({ json: DEFS })
      : r.fulfill({ status: 404, json: { detail: 'not_found' } }))
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
  const url = tab ? `/image-factory?tab=${tab}` : '/image-factory'
  await page.goto(url)
}

// ── AC-HOST-1 / AC-RBAC: Tab-Sichtbarkeit ───────────────────────────────────────

test('AC-HOST-1: Plus-Admin sieht den "Build Editor"-Tab', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS })
  await expect(page.getByRole('button', { name: 'Build Editor' })).toBeVisible()
})

test('AC-HOST-1: Core-Admin sieht den Tab NICHT (und Direkt-URL zeigt keinen Editor)', async ({ page }) => {
  await goto(page, { caps: CAPS_CORE, tab: 'build-editor' })
  await expect(page.getByRole('heading', { name: 'Image Factory' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build Editor' })).toHaveCount(0)
  // Kein Editor-Inhalt bei Direkt-Navigation (canBuildEditor false).
  await expect(page.getByText('Editor-verwaltete Build-Definitionen', { exact: false })).toHaveCount(0)
})

test('AC-RBAC-3: Plus-Operator (kein Admin) sieht den Tab NICHT', async ({ page }) => {
  await goto(page, { token: OPERATOR_TOKEN, me: MOCK_ME_OPERATOR, caps: CAPS_PLUS })
  await expect(page.getByRole('heading', { name: 'Image Factory' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Build Editor' })).toHaveCount(0)
})

// ── AC-EDIT-1 / AC-ROUND-2: Editor lädt + Marker-Liste ──────────────────────────

test('AC-EDIT-1 / AC-ROUND-2: Tab öffnet den Editor + zeigt die Marker-gefilterte Liste', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'build-editor' })
  // Lazy-Chunk geladen → DefinitionList-Intro + die editor-verwaltete Definition.
  await expect(page.getByText('Editor-verwaltete Build-Definitionen', { exact: false })).toBeVisible()
  await expect(page.getByText('Debian 13')).toBeVisible()
})

// ── AC-EDIT-2/3 + AC-SRC-1/EC-5: Formular ───────────────────────────────────────

test('AC-EDIT-2: "Neue Definition" öffnet das Formular (Meta + Source iso + Installer)', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'build-editor' })
  await page.getByRole('button', { name: /Neue Definition/ }).click()
  await expect(page.getByText('Metadaten')).toBeVisible()
  await expect(page.getByText('Quelle (Source)')).toBeVisible()
  // iso ist Default → Installer-Builder sichtbar.
  await expect(page.getByRole('heading', { name: 'Installer-Builder' })).toBeVisible()
})

test('Prefill: OS-Vorlage (Rocky/RHEL) füllt das Formular', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'build-editor' })
  await page.getByRole('button', { name: /Neue Definition/ }).click()
  await page.getByRole('button', { name: 'Rocky / Alma (RHEL 9)' }).click()
  await expect(page.getByRole('heading', { name: 'Installer-Builder' })).toBeVisible() // bleibt iso
  await expect(page.locator('input[value="Rocky Linux 9"]')).toBeVisible()
})

test('AC-SRC-1 / EC-5: Umschalten auf clone blendet den Installer aus', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'build-editor' })
  await page.getByRole('button', { name: /Neue Definition/ }).click()
  await expect(page.getByRole('heading', { name: 'Installer-Builder' })).toBeVisible()
  await page.getByText('Aus Template (proxmox-clone)').click()
  await expect(page.getByRole('heading', { name: 'Installer-Builder' })).toHaveCount(0)
})

test('HCL-Tab: "HCL direkt bearbeiten" aktiviert den Override-Modus', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'build-editor' })
  await page.route('**/api/packer-editor/preview', r =>
    r.fulfill({ json: { hcl: 'source "proxmox-iso" "builder" {}', files: {}, meta_yaml: '', warnings: [] } }))
  await page.getByRole('button', { name: /Neue Definition/ }).click()
  await page.getByRole('button', { name: 'HCL', exact: true }).click()
  await page.getByRole('button', { name: 'HCL direkt bearbeiten' }).click()
  await expect(page.getByText(/HCL wird direkt bearbeitet/)).toBeVisible()
})

// ── AC-EDIT-3 / AC-HOST-3: Speichern feuert POST ────────────────────────────────

test('AC-EDIT-3: Speichern feuert POST /api/packer-editor/definitions', async ({ page }) => {
  await goto(page, { caps: CAPS_PLUS, tab: 'build-editor' })
  let posted = null
  await page.route('**/api/packer-editor/definitions', async (r) => {
    if (r.request().method() === 'POST') {
      posted = r.request().postDataJSON()
      await r.fulfill({ status: 201, json: { id: 'd13', name: 'D13', description: '', required_role: 'operator', source_type: 'proxmox-iso' } })
    } else {
      await r.fulfill({ json: DEFS })
    }
  })
  await page.getByRole('button', { name: /Neue Definition/ }).click()
  await page.getByPlaceholder('z. B. Debian 13 Trixie').fill('D13')
  await page.getByRole('button', { name: 'Speichern', exact: true }).click()
  await expect.poll(() => posted?.name).toBe('D13')
  // Source-Typ wird mitgesendet (iso-Default), Credentials nie (AC-SRC-2).
  expect(posted.source.type).toBe('proxmox-iso')
  expect(JSON.stringify(posted)).not.toContain('proxmox_api_token_secret')
})

// ── AC-RBAC-2: Backend-Gate 404 im Core ─────────────────────────────────────────

test('AC-RBAC-2: /api/packer-editor/definitions liefert 404 im Core', async ({ page }) => {
  await goto(page, { caps: CAPS_CORE })
  const res = await browserFetch(page, '/api/packer-editor/definitions')
  expect(res.status).toBe(404)
})
