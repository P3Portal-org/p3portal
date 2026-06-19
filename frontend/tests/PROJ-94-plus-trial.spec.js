// p3portal.org
// PROJ-94 — P3 Plus 30-Tage-Trial (+ TTL-Cache-Fix).
// E2E gegen die LicenseSectionAdmin in der echten V2-System-Settings-Seite
// (/system-settings?tab=portal&sub=license): Start-Button-Sichtbarkeit (AC-START-4),
// Start-Flow + 409-Guards (AC-START-1/2), aktiver Trial „noch X Tage" (AC-UI-1),
// abgelaufener Trial + p3portal.org-Link (AC-UI-2), Trial-Flags im /status (AC-UI-3).
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_settings'], groups: [],
}

const iso = (offsetDays) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

// /api/license/status (drives useLicenseLimits → trial flags + isPlus + start-button visibility)
const STATUS = {
  core:         { app_version: 'test', edition: 'core',       valid: false, contact_name: null, expiry: null,      reason: 'missing',       trial_used: false, trial_active: false, limits: {} },
  validLic:     { app_version: 'test', edition: 'plus_v1',    valid: true,  contact_name: 'Acme', expiry: iso(365), reason: null,            trial_used: false, trial_active: false, limits: {} },
  trialActive:  { app_version: 'test', edition: 'plus_trial', valid: true,  contact_name: null, expiry: iso(15),    reason: 'trial',         trial_used: true,  trial_active: true,  limits: {} },
  trialExpired: { app_version: 'test', edition: 'core',       valid: false, contact_name: null, expiry: iso(-2),    reason: 'trial_expired', trial_used: true,  trial_active: false, limits: {} },
}
// /api/license/details (drives the section display)
const DETAILS = {
  core:         { edition: 'core',       valid: false, reason: 'missing',       contact_name: null, contact_email: null, expiry: null },
  validLic:     { edition: 'plus_v1',    valid: true,  reason: null,            contact_name: 'Acme', contact_email: 'admin@acme.de', expiry: iso(365) },
  trialActive:  { edition: 'plus_trial', valid: true,  reason: 'trial',         contact_name: null, contact_email: null, expiry: iso(15) },
  trialExpired: { edition: 'core',       valid: false, reason: 'trial_expired', contact_name: null, contact_email: null, expiry: iso(-2) },
}

// ── Common mocks (LIFO: Catch-Alls zuerst, Spezifisches im goto-Helfer danach) ──
async function mockCommonApi(page) {
  await page.route(/localhost:\d+\/api\/cluster\//, r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: {} }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me/node-assignments', r => r.fulfill({ json: [] }))
  await page.route('**/api/me', r => r.fulfill({ json: MOCK_ME_ADMIN }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/settings**', r =>
    r.fulfill({ json: { proxmox_node: 'pve1', vm_id_range_start: 100, vm_id_range_end: 199 } }))
  await page.route('**/api/admin/users**', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/cluster/status', r =>
    r.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/approvals/**', r => r.fulfill({ json: { pending: 0 } }))
  await page.route('**/api/approvals', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
}

async function gotoLicense(page, { scenario = 'core', startResponse = null } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page)
  // Spezifische Lizenz-Routen (nach den Catch-Alls → gewinnen, LIFO).
  await page.route(/\/api\/license\/status(\?.*)?$/, r => r.fulfill({ json: STATUS[scenario] }))
  await page.route(/\/api\/license\/details(\?.*)?$/, r => r.fulfill({ json: DETAILS[scenario] ?? DETAILS.core }))
  if (startResponse) {
    await page.route(/\/api\/license\/trial\/start$/, r =>
      r.fulfill({ status: startResponse.status, contentType: 'application/json', body: JSON.stringify(startResponse.body) }))
  }
  await page.goto('/system-settings?tab=portal&sub=license')
  await page.waitForLoadState('networkidle')
}

const startBtn = (page) => page.getByRole('button', { name: '30-Tage-Test starten' })

// ═══════════════════════════════════════════════════════════════════════════════
// AC-START-4: Start-Button-Sichtbarkeit
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-START-4: Start-Button im reinen Core sichtbar (Trial nie genutzt)', async ({ page }) => {
  await gotoLicense(page, { scenario: 'core' })
  await expect(startBtn(page)).toBeVisible()
})

test('AC-START-4: Start-Button ausgeblendet bei gültiger Lizenz', async ({ page }) => {
  await gotoLicense(page, { scenario: 'validLic' })
  // Sektion ist gerendert (Deactivate-Button nur bei echter Lizenz)
  await expect(page.getByRole('button', { name: 'Lizenz deaktivieren' })).toBeVisible()
  await expect(startBtn(page)).toHaveCount(0)
})

test('AC-START-4: Start-Button ausgeblendet wenn Trial bereits genutzt (abgelaufen)', async ({ page }) => {
  await gotoLicense(page, { scenario: 'trialExpired' })
  await expect(page.getByText('Testzeitraum abgelaufen').first()).toBeVisible()
  await expect(startBtn(page)).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-1: aktiver Trial → „noch X Tage" + kein Deactivate
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-1: aktiver Trial zeigt „noch X Tage" und keinen Deactivate-Button', async ({ page }) => {
  await gotoLicense(page, { scenario: 'trialActive' })
  await expect(page.getByText(/noch \d+ Tage/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lizenz deaktivieren' })).toHaveCount(0)
  await expect(startBtn(page)).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-UI-2: abgelaufener Trial → Hinweis + Link auf http://p3portal.org
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-UI-2: abgelaufener Trial zeigt Hinweis + p3portal.org-Link', async ({ page }) => {
  await gotoLicense(page, { scenario: 'trialExpired' })
  await expect(page.getByText('Testzeitraum abgelaufen').first()).toBeVisible()
  // scope to the CTA link inside the expired-hint paragraph (page also carries
  // two p3portal.org watermark links → avoid strict-mode ambiguity)
  const link = page.getByText(/Hol dir einen Lizenzschlüssel/).getByRole('link', { name: 'p3portal.org' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', 'http://p3portal.org')
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-START-1: Trial starten → POST + Erfolgsmeldung
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-START-1: Klick auf „Test starten" ruft den EP und zeigt Erfolgsmeldung', async ({ page }) => {
  let posted = false
  await gotoLicense(page, {
    scenario: 'core',
    startResponse: { status: 200, body: { edition: 'plus_trial', valid: true, trial_active: true, trial_used: true } },
  })
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/license/trial/start')) posted = true
  })
  await startBtn(page).click()
  await expect(page.getByText(/Testzeitraum gestartet/)).toBeVisible()
  expect(posted).toBe(true)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-START-2: 409-Guards (valid_license_present / trial_already_used)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-START-2: 409 valid_license_present zeigt klare Meldung', async ({ page }) => {
  await gotoLicense(page, {
    scenario: 'core',
    startResponse: { status: 409, body: { detail: 'valid_license_present' } },
  })
  await startBtn(page).click()
  await expect(page.getByText('Es ist bereits eine gültige Lizenz aktiv.')).toBeVisible()
})

test('AC-START-2: 409 trial_already_used zeigt klare Meldung', async ({ page }) => {
  await gotoLicense(page, {
    scenario: 'core',
    startResponse: { status: 409, body: { detail: 'trial_already_used' } },
  })
  await startBtn(page).click()
  await expect(page.getByText(/bereits genutzt/)).toBeVisible()
})
