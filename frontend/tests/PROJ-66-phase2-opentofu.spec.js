// p3portal.org
// PROJ-66 Phase 2: E2E-Tests für den OpenTofu-Tooling-Health-Indikator (Plus-only)
// Testet: dritter Indikator rendert generisch, Reihenfolge Ansible→Packer→OpenTofu,
//         Anzeigename "OpenTofu", Slide-Over-Hilfetext + degraded-Detail,
//         Core-Image (kein opentofu in Status) zeigt keinen dritten Punkt.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["view_logs"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbInZpZXdfbG9ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

// Plus-Image: Backend liefert opentofu zusätzlich zu ansible/packer.
const STATUS_WITH_TOFU_READY = {
  ansible:  { tool: 'ansible',  version: '2.18.1', status: 'ready', last_check: new Date().toISOString(), stdout: 'ok', stderr: '' },
  packer:   { tool: 'packer',   version: '1.11.2', status: 'ready', last_check: new Date().toISOString(), stdout: 'ok', stderr: '' },
  opentofu: { tool: 'opentofu', version: '1.9.1',  status: 'ready', last_check: new Date().toISOString(), stdout: '=== tofu version ===\nOpenTofu v1.9.1\n', stderr: '' },
}

// Plus-Image: tofu läuft, aber Provider-Mirror fehlt → degraded (orange).
const STATUS_WITH_TOFU_DEGRADED = {
  ansible:  { tool: 'ansible',  version: '2.18.1', status: 'ready',    last_check: new Date().toISOString(), stdout: 'ok', stderr: '' },
  packer:   { tool: 'packer',   version: '1.11.2', status: 'ready',    last_check: new Date().toISOString(), stdout: 'ok', stderr: '' },
  opentofu: { tool: 'opentofu', version: '1.9.1',  status: 'degraded', last_check: new Date().toISOString(),
              stdout: '=== tofu version ===\nOpenTofu v1.9.1\n',
              stderr: '=== tofu version ===\n\n=== provider mirror ===\nProvider-Mirror nicht gefunden — Stack-Deploys würden offline scheitern' },
}

// Core-Image: Backend liefert nur ansible/packer (kein tofu-Binary → Hook gibt []).
const STATUS_CORE = {
  ansible: { tool: 'ansible', version: '2.18.1', status: 'ready', last_check: new Date().toISOString(), stdout: 'ok', stderr: '' },
  packer:  { tool: 'packer',  version: '1.11.2', status: 'ready', last_check: new Date().toISOString(), stdout: 'ok', stderr: '' },
}

const MOCK_AUDIT_ITEMS = { tool: 'opentofu', items: [], total: 0 }
const MOCK_LICENSE = { edition: 'plus', is_plus_edition: true, license_valid: true }
const MOCK_CAPS    = { approval_workflow: false, approval_workflow_enabled: false }
const MOCK_ME      = { id: 1, username: 'admin', role: 'admin', auth_type: 'local', portal_permissions: ['view_logs'], groups: [] }

// ── Helfer ────────────────────────────────────────────────────────────────────

async function setToken(page) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), ADMIN_TOKEN)
}

async function setupBaseMocks(page, { toolingStatus = STATUS_WITH_TOFU_READY } = {}) {
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()

    // Tooling-Health (PROJ-66) – spezifisch vor allgemein
    if (url.includes('/api/system/tooling/audit-history')) return route.fulfill({ json: MOCK_AUDIT_ITEMS })
    if (url.includes('/api/system/tooling/recheck') && route.request().method() === 'POST')
      return route.fulfill({ json: toolingStatus })
    if (url.includes('/api/system/tooling/status'))  return route.fulfill({ json: toolingStatus })

    // Notifications (PROJ-65)
    if (url.includes('/api/notifications/unread-summary')) return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications'))    return route.fulfill({ json: [] })

    // Auth + User
    if (url.includes('/api/license/status'))   return route.fulfill({ json: MOCK_LICENSE })
    if (url.includes('/api/capabilities'))     return route.fulfill({ json: MOCK_CAPS })
    if (url.includes('/api/me/permissions'))   return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))               return route.fulfill({ json: MOCK_ME })
    if (url.includes('/api/setup/status'))     return route.fulfill({ json: { setup_required: false } })
    if (url.includes('/api/portal/config'))    return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })

    // Navigation
    if (url.includes('/api/sidebar-pins'))     return route.fulfill({ json: [] })

    // Cluster (LIFO: spezifisch zuerst)
    if (url.includes('/api/cluster/status'))   return route.fulfill({ json: { quorum: true, node_count: 0, ha_status: 'none' } })
    if (url.includes('/api/cluster/nodes'))    return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))          return route.fulfill({ json: [] })

    // Sonstiges
    if (url.includes('/api/nodes'))            return route.fulfill({ json: [] })
    if (url.includes('/api/announcements'))    return route.fulfill({ json: [] })
    if (url.includes('/api/alerts/summary'))   return route.fulfill({ json: [] })
    if (url.includes('/api/alerts'))           return route.fulfill({ json: [] })
    if (url.includes('/api/themes'))           return route.fulfill({ json: [] })
    if (url.includes('/api/jobs'))             return route.fulfill({ json: [] })
    if (url.includes('/api/i18n'))             return route.fulfill({ json: { lang_code: 'de' } })
    if (url.includes('/api/help'))             return route.fulfill({ json: [] })

    await route.continue()
  })
}

const tofuBtn    = page => page.locator('button[title*="OpenTofu" i]').first()
const ansibleBtn = page => page.locator('button[title*="Ansible" i]').first()
const packerBtn  = page => page.locator('button[title*="Packer" i]').first()

// ── AC-P2-UI-1/2: Dritter Indikator rendert mit Anzeigename "OpenTofu" ─────────
test('AC-P2-UI-1/2: OpenTofu-Indikator erscheint mit Anzeigename "OpenTofu"', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(tofuBtn(page)).toBeVisible({ timeout: 8000 })
  await expect(tofuBtn(page)).toContainText(/OpenTofu/i)
})

// ── AC-P2-UI-3: Reihenfolge Ansible → Packer → OpenTofu ───────────────────────
test('AC-P2-UI-3: OpenTofu erscheint rechts von Packer (nach den Core-Tools)', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await expect(packerBtn(page)).toBeVisible()
  await expect(tofuBtn(page)).toBeVisible()

  const ansibleBox = await ansibleBtn(page).boundingBox()
  const packerBox  = await packerBtn(page).boundingBox()
  const tofuBox    = await tofuBtn(page).boundingBox()

  expect(ansibleBox.x).toBeLessThan(packerBox.x) // Ansible links von Packer
  expect(packerBox.x).toBeLessThan(tofuBox.x)    // Packer links von OpenTofu
})

// ── AC-P2-UI-4/5: Slide-Over zeigt OpenTofu-Namen + Hilfetext ─────────────────
test('AC-P2-UI-4/5: Klick auf OpenTofu öffnet Slide-Over mit Name + Hilfetext', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page)
  await page.goto('/dashboard')

  await expect(tofuBtn(page)).toBeVisible({ timeout: 8000 })
  await tofuBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 3000 })
  await expect(dialog.locator('h2')).toContainText('OpenTofu')
  // OpenTofu-spezifischer Hilfetext (DE): erklärt degraded = Provider-Mirror fehlt
  await expect(dialog).toContainText(/Provider-Mirror/i)
})

// ── AC-P2-CHECK-4 (UI): degraded zeigt Klartext-Grund im Output ───────────────
test('AC-P2-CHECK-4: degraded-Status zeigt Provider-Mirror-Begründung im Slide-Over', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page, { toolingStatus: STATUS_WITH_TOFU_DEGRADED })
  await page.goto('/dashboard')

  await expect(tofuBtn(page)).toBeVisible({ timeout: 8000 })
  await tofuBtn(page).click()

  const dialog = page.locator('[role="dialog"]').first()
  await expect(dialog).toBeVisible({ timeout: 3000 })
  // stderr-Sektion enthält die Klartext-Begründung
  await expect(dialog).toContainText(/Stack-Deploys würden offline scheitern/i)
})

// ── EC-P2-1: Core-Image (kein opentofu in Status) → kein dritter Punkt ─────────
test('EC-P2-1: Core-Image zeigt nur Ansible+Packer, keinen OpenTofu-Punkt', async ({ page }) => {
  await setToken(page)
  await setupBaseMocks(page, { toolingStatus: STATUS_CORE })
  await page.goto('/dashboard')

  await expect(ansibleBtn(page)).toBeVisible({ timeout: 8000 })
  await expect(packerBtn(page)).toBeVisible()
  await expect(tofuBtn(page)).toHaveCount(0)
})
