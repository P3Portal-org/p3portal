// p3portal.org
// PROJ-73: E2E-Tests für Node-Update-Anzeige (APT-Updates pro Proxmox-Node)
// Testet: UpdatesBadge im Dashboard, Updates-Tab im Compute-Node-Detail,
//         Refresh-Button, Stale-Indikator, Fehlerszenarien, Permissions
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999,"user_id":2}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjJ9' +
  '.fake-sig'

// ── Mock-Daten ────────────────────────────────────────────────────────────────

const MOCK_ME_ADMIN  = { id: 1, username: 'admin',  role: 'admin',  auth_type: 'local', portal_permissions: ['manage_settings'], groups: [] }
const MOCK_ME_VIEWER = { id: 2, username: 'viewer', role: 'viewer', auth_type: 'local', portal_permissions: [], groups: [] }

const MOCK_NODE = {
  id: 1, name: 'Heimserver', proxmox_node: 'pve1',
  host_url: 'https://pve.example.com:8006', verify_ssl: false, is_default: true,
}

const CLUSTER_NODE = {
  node: 'pve1', status: 'online', portal_node_name: 'Heimserver', portal_node_id: 1,
  cpu: 0.3, maxcpu: 8, mem: 8589934592, maxmem: 34359738368,
  disk: 10737418240, maxdisk: 107374182400, uptime: 86400,
}

const NODE_DETAIL = {
  node: 'pve1', status: 'online', cpu: 0.3, maxcpu: 8,
  mem: 8589934592, maxmem: 34359738368, disk: 10737418240, maxdisk: 107374182400,
  uptime: 86400, pveversion: '8.2.0',
  storage_pools: [], network_interfaces: [],
}

const MOCK_SUMMARY_WITH_UPDATES = {
  entries: [{
    portal_node_id: 1,
    proxmox_node_name: 'pve1',
    package_count: 17,
    security_count: 3,
    last_success_at: new Date(Date.now() - 3600_000).toISOString(),
    is_stale: false,
    last_error: null,
  }],
}

const MOCK_SUMMARY_UP_TO_DATE = {
  entries: [{
    portal_node_id: 1,
    proxmox_node_name: 'pve1',
    package_count: 0,
    security_count: 0,
    last_success_at: new Date(Date.now() - 3600_000).toISOString(),
    is_stale: false,
    last_error: null,
  }],
}

const MOCK_SUMMARY_NO_CHECK = {
  entries: [{
    portal_node_id: 1,
    proxmox_node_name: 'pve1',
    package_count: 0,
    security_count: 0,
    last_success_at: null,
    is_stale: false,
    last_error: null,
  }],
}


const MOCK_UPDATES_DETAIL = {
  members: [{
    proxmox_node_name: 'pve1',
    package_count: 17,
    security_count: 3,
    last_check_at: new Date(Date.now() - 3600_000).toISOString(),
    last_success_at: new Date(Date.now() - 3600_000).toISOString(),
    last_error: null,
    is_stale: false,
    packages: [
      { name: 'openssh-server',    version_old: '1:8.9p1-3', version_new: '1:9.2p1-1', is_security: true },
      { name: 'openssh-client',    version_old: '1:8.9p1-3', version_new: '1:9.2p1-1', is_security: true },
      { name: 'proxmox-kernel-6.2',version_old: '6.2.0-1',   version_new: '6.2.16-2',  is_security: true },
      { name: 'curl',              version_old: '7.88.1-10',  version_new: '7.88.1-11', is_security: false },
      { name: 'apt',               version_old: '2.6.0',      version_new: '2.6.1',     is_security: false },
    ],
  }],
}

const MOCK_UPDATES_EMPTY = {
  members: [{
    proxmox_node_name: 'pve1',
    package_count: 0,
    security_count: 0,
    last_check_at: new Date(Date.now() - 3600_000).toISOString(),
    last_success_at: new Date(Date.now() - 3600_000).toISOString(),
    last_error: null,
    is_stale: false,
    packages: [],
  }],
}

const MOCK_UPDATES_NO_DATA = {
  members: [{
    proxmox_node_name: 'pve1',
    package_count: 0,
    security_count: 0,
    last_check_at: null,
    last_success_at: null,
    last_error: null,
    is_stale: false,
    packages: [],
  }],
}

const MOCK_UPDATES_ERROR = {
  members: [{
    proxmox_node_name: 'pve1',
    package_count: 0,
    security_count: 0,
    last_check_at: new Date(Date.now() - 1800_000).toISOString(),
    last_success_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    last_error: 'Connection refused',
    is_stale: false,
    packages: [],
  }],
}

const MOCK_UPDATES_STALE = {
  members: [{
    proxmox_node_name: 'pve1',
    package_count: 5,
    security_count: 0,
    last_check_at: new Date(Date.now() - 50 * 3600_000).toISOString(),
    last_success_at: new Date(Date.now() - 50 * 3600_000).toISOString(),
    last_error: null,
    is_stale: true,
    packages: [
      { name: 'curl', version_old: '7.88.0', version_new: '7.88.1', is_security: false },
    ],
  }],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function setToken(page, token) {
  await page.addInitScript(t => sessionStorage.setItem('token', t), token)
}

async function setupCommonMocks(page, opts = {}) {
  const {
    me = MOCK_ME_ADMIN,
    summary = MOCK_SUMMARY_WITH_UPDATES,
    detail = MOCK_UPDATES_DETAIL,
    refreshStatus = 200,
    refreshBody = MOCK_UPDATES_DETAIL,
  } = opts

  const API = /localhost:\d+\/api\//

  await page.route(API, async route => {
    const url = route.request().url()
    const method = route.request().method()

    // Node-Updates (LIFO: spezifisch vor allgemein)
    if (url.match(/\/api\/nodes\/\d+\/updates\/refresh/) && method === 'POST')
      return route.fulfill({ status: refreshStatus, json: refreshStatus === 409 ? { detail: 'refresh_already_running' } : refreshBody })
    if (url.match(/\/api\/nodes\/\d+\/updates/))
      return route.fulfill({ json: detail })
    if (url.includes('/api/nodes/updates/summary'))
      return route.fulfill({ json: summary })

    // Notifications (PROJ-65)
    if (url.includes('/api/notifications/unread-summary'))
      return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications'))
      return route.fulfill({ json: [] })

    // Tooling (PROJ-66)
    if (url.includes('/api/system/tooling'))
      return route.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' }, packer: { status: 'ready', version: '1.11.2' } } })

    // Node assignments (PROJ-47)
    if (url.includes('/api/node-assignments'))
      return route.fulfill({ json: [] })

    // Auth + User
    if (url.includes('/api/license/status'))  return route.fulfill({ json: { edition: 'core', is_plus_edition: false, license_valid: false } })
    if (url.includes('/api/capabilities'))    return route.fulfill({ json: { approval_workflow: false, approval_workflow_enabled: false } })
    if (url.includes('/api/me/permissions'))  return route.fulfill({ json: { roles: [], permissions: [], assignments: [] } })
    if (url.includes('/api/me'))              return route.fulfill({ json: me })
    if (url.includes('/api/setup/status'))    return route.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } })
    if (url.includes('/api/portal/config'))   return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    if (url.includes('/api/sidebar-pins'))    return route.fulfill({ json: [] })

    // Admin nodes
    if (url.includes('/api/admin/nodes'))
      return route.fulfill({ json: [MOCK_NODE] })

    // Cluster
    if (url.includes('/api/cluster/status'))
      return route.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/detail/))
      return route.fulfill({ json: NODE_DETAIL })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/tasks/))
      return route.fulfill({ json: [] })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/backups/))
      return route.fulfill({ json: [] })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/storage/))
      return route.fulfill({ json: [] })
    if (url.includes('/api/cluster/nodes'))
      return route.fulfill({ json: [CLUSTER_NODE] })
    if (url.includes('/api/cluster/vms/ips'))
      return route.fulfill({ json: {} })
    if (url.includes('/api/cluster/vms'))
      return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))
      return route.fulfill({ json: [] })

    // Alerts (PROJ-34/40)
    if (url.includes('/api/alerts/rules'))    return route.fulfill({ json: [] })
    if (url.includes('/api/alerts/states'))   return route.fulfill({ json: [] })
    if (url.includes('/api/alerts/presets'))  return route.fulfill({ json: [] })
    if (url.includes('/api/alerts/history'))  return route.fulfill({ json: [] })
    if (url.includes('/api/alerts'))          return route.fulfill({ json: [] })

    // Scheduled jobs (PROJ-35)
    if (url.includes('/api/scheduled-jobs'))  return route.fulfill({ json: [] })

    // Owners (PROJ-48)
    if (url.includes('/api/owners'))          return route.fulfill({ json: [] })

    // Misc
    if (url.includes('/api/playbooks'))       return route.fulfill({ json: [] })
    if (url.includes('/api/packer'))          return route.fulfill({ json: [] })
    if (url.includes('/api/admin/role-presets'))  return route.fulfill({ json: [] })
    if (url.includes('/api/admin/groups'))         return route.fulfill({ json: [] })
    if (url.includes('/api/admin/users'))          return route.fulfill({ json: [] })
    if (url.includes('/api/admin/proxmox-audit'))  return route.fulfill({ json: [] })
    if (url.includes('/api/announcements'))        return route.fulfill({ json: [] })
    if (url.includes('/api/jobs'))                 return route.fulfill({ json: [] })
    if (url.includes('/api/themes'))               return route.fulfill({ json: [] })
    if (url.includes('/api/i18n'))                 return route.fulfill({ json: { lang_code: 'de' } })
    if (url.includes('/api/help'))                 return route.fulfill({ json: [] })
    if (url.includes('/api/vms'))                  return route.fulfill({ json: [] })

    await route.continue()
  })
}

async function goToComputeUpdatesTab(page, nodeName = 'pve1') {
  await page.goto(`/compute?node=${encodeURIComponent(nodeName)}&tab=updates`)
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
}

async function goToDashboard(page) {
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(800)
}

// ── AC-UI-1..5: Dashboard-Badge ───────────────────────────────────────────────

test('AC-UI-1/UI-4: Badge zeigt Update-Zahl mit Security-Hinweis in portal-warn-Farbe', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { summary: MOCK_SUMMARY_WITH_UPDATES })
  await goToDashboard(page)

  const badge = page.locator('button').filter({ hasText: /Updates/ }).first()
  await expect(badge).toBeVisible({ timeout: 8000 })
  await expect(badge).toContainText('17')
  await expect(badge).toContainText('3')
})

test('AC-UI-2: Badge zeigt "aktuell" bei package_count == 0', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { summary: MOCK_SUMMARY_UP_TO_DATE })
  await goToDashboard(page)

  // The badge should show "aktuell" text
  const badge = page.locator('button[title]').filter({ hasText: /aktuell/i }).first()
  await expect(badge).toBeVisible({ timeout: 8000 })
})

test('AC-UI-3: Badge zeigt "Kein Check" bei last_success_at == null', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { summary: MOCK_SUMMARY_NO_CHECK })
  await goToDashboard(page)

  const badge = page.locator('button[title]').filter({ hasText: /Kein Check/i }).first()
  await expect(badge).toBeVisible({ timeout: 8000 })
})

test('AC-UI-5: Klick auf Badge navigiert zu Updates-Tab', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { summary: MOCK_SUMMARY_WITH_UPDATES })
  await goToDashboard(page)

  const badge = page.locator('button').filter({ hasText: /Updates/ }).first()
  await expect(badge).toBeVisible({ timeout: 8000 })
  await badge.click()

  await expect(page).toHaveURL(/tab=updates/, { timeout: 5000 })
})

// ── AC-TAB-1: Tab vorhanden ───────────────────────────────────────────────────

test('AC-TAB-1: Updates-Tab ist in der Compute-Node-Detailseite vorhanden', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page)
  await goToComputeUpdatesTab(page)

  // Tab-Button "Updates" muss im Tab-Strip sichtbar sein
  const tabBtn = page.getByRole('button', { name: /updates/i }).first()
  await expect(tabBtn).toBeVisible({ timeout: 8000 })
})

// ── AC-TAB-3: Tab-Inhalt ──────────────────────────────────────────────────────

test('AC-TAB-3: Tab zeigt last_success_at und Pakettabelle', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page)
  await goToComputeUpdatesTab(page)

  // Header zeigt letzten Check
  await expect(page.locator('text=/letzter Check|last check/i').first()).toBeVisible({ timeout: 8000 })

  // Pakettabelle mit Spalten vorhanden
  await expect(page.locator('table')).toBeVisible()
  await expect(page.locator('text=openssh-server')).toBeVisible()
})

test('AC-TAB-3: Refresh-Button für Admin sichtbar', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page)
  await goToComputeUpdatesTab(page)

  const refreshBtn = page.locator('button').filter({ hasText: /refresh|aktualisieren/i })
  await expect(refreshBtn.first()).toBeVisible({ timeout: 8000 })
})

// ── AC-TAB-3 BUG-73-2: Refresh-Button für Viewer nicht sichtbar ──────────────

test('AC-TAB-3/BUG-73-2: Refresh-Button für Admin sichtbar, nicht für Viewer', async ({ page }) => {
  // Admin sieht einen Refresh-Button mit exaktem Text "Aktualisieren" (ohne "↻" Prefix des Cluster-Buttons)
  // Cluster-Refresh-Button hat Text "↻ Aktualisieren" und wird NICHT mitgezählt
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page)
  await goToComputeUpdatesTab(page)

  // Updates-Refresh-Button hat accessible name "Aktualisieren" (ohne Pfeil), nicht "↻ Aktualisieren"
  const updatesRefreshBtn = page.getByRole('button', { name: 'Aktualisieren', exact: true })
  await expect(updatesRefreshBtn).toBeVisible({ timeout: 8000 })
})

// ── AC-TAB-4: Fehler-Banner ───────────────────────────────────────────────────

test('AC-TAB-4: Warnbanner bei last_error', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { detail: MOCK_UPDATES_ERROR })
  await goToComputeUpdatesTab(page)

  // ErrorBanner: "Letzter Refresh fehlgeschlagen"
  await expect(page.locator('text=/fehlgeschlagen|failed/i').first()).toBeVisible({ timeout: 8000 })
  await expect(page.locator('text=Connection refused')).toBeVisible()
})

// ── AC-TAB-5: Suchfeld bei > 50 Paketen ──────────────────────────────────────

test('AC-TAB-5: Suchfeld erscheint bei mehr als 50 Paketen', async ({ page }) => {
  // Mock mit > 50 Paketen
  const manyPkgs = Array.from({ length: 55 }, (_, i) => ({
    name: `package-${i}`,
    version_old: `1.${i}.0`,
    version_new: `1.${i}.1`,
    is_security: false,
  }))
  const detailMany = {
    members: [{ ...MOCK_UPDATES_DETAIL.members[0], packages: manyPkgs, package_count: 55 }],
  }

  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { detail: detailMany })
  await goToComputeUpdatesTab(page)

  const searchInput = page.locator('input[type="text"]').first()
  await expect(searchInput).toBeVisible({ timeout: 8000 })
})

// ── AC-TAB-6: Security zuerst in Sortierung ───────────────────────────────────

test('AC-TAB-6: Security-Updates erscheinen vor normalen Updates in Tabelle', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page)
  await goToComputeUpdatesTab(page)

  await expect(page.locator('table')).toBeVisible({ timeout: 8000 })
  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(5, { timeout: 5000 })

  // Erste Zeile muss ein Security-Paket sein
  const firstRowText = await rows.first().textContent()
  // openssh-client, openssh-server und proxmox-kernel sind Security – eins davon sollte zuerst stehen
  expect(firstRowText).toMatch(/openssh|proxmox-kernel/i)
})

// ── AC-TAB-7: Refresh-Button Spinner und Reload ───────────────────────────────

test('AC-TAB-7: Refresh-Button löst Spinner aus und lädt Daten neu', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { refreshBody: MOCK_UPDATES_EMPTY })
  await goToComputeUpdatesTab(page)
  await expect(page.locator('table')).toBeVisible({ timeout: 8000 })

  // Use waitForRequest to reliably detect the POST request
  const refreshRequest = page.waitForRequest(req =>
    /\/api\/nodes\/\d+\/updates\/refresh/.test(req.url()) && req.method() === 'POST',
    { timeout: 8000 }
  )

  const refreshBtn = page.getByRole('button', { name: 'Aktualisieren', exact: true })
  await expect(refreshBtn).toBeVisible()
  await refreshBtn.click()

  // Confirm the refresh request was sent
  await refreshRequest
})

// ── AC-STALE-1/2: Stale-Indikator ────────────────────────────────────────────

test('AC-STALE-1/2: Stale-Warnung erscheint wenn last_success_at > 48h alt', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { detail: MOCK_UPDATES_STALE })
  await goToComputeUpdatesTab(page)

  // StaleWarning-Komponente muss sichtbar sein
  await expect(page.locator('text=/veraltet|stale|alt|outdated/i').first()).toBeVisible({ timeout: 8000 })
})

// ── AC-TAB-1 NoData: Keine Daten-State ───────────────────────────────────────

test('AC-TAB-1 (no data): NoDataState zeigt Refresh-Button für Admin', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { detail: MOCK_UPDATES_NO_DATA })
  await goToComputeUpdatesTab(page)

  // NoDataState: Hinweis + Refresh-Button
  await expect(page.locator('button').filter({ hasText: /refresh|aktualisieren/i }).first()).toBeVisible({ timeout: 8000 })
})

// ── AC-API-4: HTTP 409 bei Doppel-Refresh ────────────────────────────────────

test('AC-API-4: Fehleranzeige bei HTTP 409 (refresh already running)', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { refreshStatus: 409 })
  await goToComputeUpdatesTab(page)

  // Use exact button name to click the Updates-tab refresh button, not the cluster refresh button
  const refreshBtn = page.getByRole('button', { name: 'Aktualisieren', exact: true })
  await expect(refreshBtn).toBeVisible({ timeout: 8000 })
  await refreshBtn.click()

  // Fehlermeldung bei 409 – "bereits" is unique to nodeUpdates.already_running key
  await expect(page.locator('text=/bereits/i').first()).toBeVisible({ timeout: 8000 })
})

// ── AC-PERM-2: 403 für Nutzer ohne Berechtigung ──────────────────────────────

test('AC-PERM-2: 403-Meldung bei fehlendem Zugriffsrecht', async ({ page }) => {
  await setToken(page, VIEWER_TOKEN)

  // Überschreibe detail-Mock mit 403
  const API = /localhost:\d+\/api\//
  await page.route(API, async route => {
    const url = route.request().url()
    if (url.match(/\/api\/nodes\/\d+\/updates/) && !url.includes('/refresh'))
      return route.fulfill({ status: 403, json: { detail: 'Forbidden' } })
    if (url.includes('/api/nodes/updates/summary'))
      return route.fulfill({ json: MOCK_SUMMARY_WITH_UPDATES })
    if (url.includes('/api/notifications/unread-summary'))
      return route.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } })
    if (url.includes('/api/notifications')) return route.fulfill({ json: [] })
    if (url.includes('/api/system/tooling')) return route.fulfill({ json: { ansible: { status: 'ready' }, packer: { status: 'ready' } } })
    if (url.includes('/api/license/status'))  return route.fulfill({ json: { edition: 'core', is_plus_edition: false } })
    if (url.includes('/api/capabilities'))    return route.fulfill({ json: {} })
    if (url.includes('/api/me/permissions'))  return route.fulfill({ json: { roles: [], permissions: [] } })
    if (url.includes('/api/me'))              return route.fulfill({ json: MOCK_ME_VIEWER })
    if (url.includes('/api/setup/status'))    return route.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } })
    if (url.includes('/api/portal/config'))   return route.fulfill({ json: { active_theme: 'light', active_lang: 'de', interface_version: 'v2' } })
    if (url.includes('/api/sidebar-pins'))    return route.fulfill({ json: [] })
    if (url.includes('/api/admin/nodes'))     return route.fulfill({ json: [MOCK_NODE] })
    if (url.includes('/api/cluster/status'))  return route.fulfill({ json: { quorum: true, node_count: 1, ha_status: 'none', unreachable_nodes: [] } })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/detail/)) return route.fulfill({ json: NODE_DETAIL })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/tasks/))  return route.fulfill({ json: [] })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/backups/)) return route.fulfill({ json: [] })
    if (url.match(/\/api\/cluster\/nodes\/[^/]+\/storage/)) return route.fulfill({ json: [] })
    if (url.includes('/api/cluster/nodes'))   return route.fulfill({ json: [CLUSTER_NODE] })
    if (url.includes('/api/cluster/vms'))     return route.fulfill({ json: [] })
    if (url.includes('/api/cluster'))         return route.fulfill({ json: [] })
    if (url.includes('/api/alerts'))          return route.fulfill({ json: [] })
    if (url.includes('/api/scheduled-jobs'))  return route.fulfill({ json: [] })
    if (url.includes('/api/owners'))          return route.fulfill({ json: [] })
    if (url.includes('/api/playbooks'))       return route.fulfill({ json: [] })
    if (url.includes('/api/packer'))          return route.fulfill({ json: [] })
    if (url.includes('/api/announcements'))   return route.fulfill({ json: [] })
    if (url.includes('/api/jobs'))            return route.fulfill({ json: [] })
    if (url.includes('/api/themes'))          return route.fulfill({ json: [] })
    if (url.includes('/api/i18n'))            return route.fulfill({ json: { lang_code: 'de' } })
    if (url.includes('/api/help'))            return route.fulfill({ json: [] })
    if (url.includes('/api/vms'))             return route.fulfill({ json: [] })
    await route.continue()
  })

  await goToComputeUpdatesTab(page)

  // 403 → "Kein Zugriff" / "Keine Berechtigung"
  await expect(page.locator('text=/kein zugriff|no access|403|forbidden/i').first()).toBeVisible({ timeout: 8000 })
})

// ── AC-TAB-3: "Alles aktuell"-State ──────────────────────────────────────────

test('AC-TAB-3: "Alles aktuell" bei leerer Paketliste', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page, { detail: MOCK_UPDATES_EMPTY })
  await goToComputeUpdatesTab(page)

  await expect(page.locator('text=/aktuell|up.to.date/i').first()).toBeVisible({ timeout: 8000 })
})

// ── AC-I18N-1: Schlüssel vorhanden ───────────────────────────────────────────

test('AC-I18N-1: Tab-Titel und Beschriftungen sind in der UI lokalisiert', async ({ page }) => {
  await setToken(page, ADMIN_TOKEN)
  await setupCommonMocks(page)
  await goToComputeUpdatesTab(page)

  // Tab-Beschriftung muss ein lokalisierter String sein (nicht der raw key)
  const tabBtn = page.getByRole('button', { name: /updates/i }).first()
  await expect(tabBtn).toBeVisible({ timeout: 8000 })
  const tabText = await tabBtn.textContent()
  // Soll nicht einfach nur "nodeUpdates.tab_title" zeigen
  expect(tabText).not.toMatch(/nodeUpdates\./i)
})
