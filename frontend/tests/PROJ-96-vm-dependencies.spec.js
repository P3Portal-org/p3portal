// p3portal.org
// PROJ-96: E2E-Tests für VM-Abhängigkeiten & Aktions-Impact-Warnung (Plus-only).
// Fokus = Integration/Routing, die die 13 Vitest-Unit-Tests nicht erreichen:
//   - VmDependencySection rendert in der echten VM-Detailseite, gated über die
//     Capability vm_dependencies + portal_node_id, beide Richtungen (AC-DECLARE-4).
//   - canManage-Gate: Operator ohne manage_dependencies → read-only (AC-DECLARE-5/RBAC-1).
//   - Headline: echte Verdrahtung des Guards in VmActionButtons → Stop löst (nach
//     dem generischen Confirm) den DependencyImpactModal aus; "Trotzdem fortfahren"
//     wiederholt die Aktion mit confirm=true (AC-IMPACT-1/2).
//   - Keine Abhängigen → kein Impact-Dialog (AC-IMPACT-3).
//   - Topologie: 4. Sicht "Abhängigkeiten" nur bei Capability sichtbar + Umschalten
//     triggert den lazy /api/topology/dependencies-Fetch (AC-VIEW-1).
//   - Core-Mode: /api/dependencies = 404 (AC-RBAC-2, Backend-Gate).
//   - Verwaiste Abhängigkeiten in den System-Einstellungen + Löschen (AC-ORPHAN-3).
// Baut auf dem PROJ-92-Mock-Muster (LIFO-Routes, browserFetch, caps) +
// den PROJ-81-VmDetail-Objekten.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"admin","auth_type":"local","role":"admin","portal_permissions":["manage_settings"],"exp":9999999999,"user_id":1}
const ADMIN_TOKEN =
  H + '.' +
  'eyJzdWIiOiJhZG1pbiIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6ImFkbWluIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbIm1hbmFnZV9zZXR0aW5ncyJdLCJleHAiOjk5OTk5OTk5OTksInVzZXJfaWQiOjF9' +
  '.fake-sig'

// {"sub":"operator1","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999,"user_id":2}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvcjEiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsInBvcnRhbF9wZXJtaXNzaW9ucyI6W10sImV4cCI6OTk5OTk5OTk5OSwidXNlcl9pZCI6Mn0=' +
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

const CAPS_CORE = { vm_dependencies: false, topology: false }
const CAPS_PLUS = { vm_dependencies: true, topology: true }

// VM, deren Detailseite getestet wird (DB-VM, von der andere abhängen).
const VM_DB = {
  vmid: 200, name: 'db-server', type: 'qemu', status: 'running', node: 'pve1',
  ip: '192.168.1.200', uptime: 3661, tags: [], is_template: false,
  cpu_usage: 0.1, cpu_cores: 4, mem_used: 2147483648, mem_total: 8589934592,
  bios: 'seabios', ostype: 'l26', portal_node_id: 1, managed_by_stack: null,
  networks: [{ id: 'net0', model: 'virtio', bridge: 'vmbr0', mac: 'BC:24:11:AA:BB:CC' }],
  disks: [{ id: 'scsi0', storage: 'local-lvm', size: '32G', serial: null }],
}

// Antwort von GET /api/dependencies für VM_DB: ein Dienst (web-1) hängt von ihr ab.
const DEPS_FOR_DB = {
  depends_on: [],
  dependents: [
    {
      id: 1, source_node_id: 1, source_vmid: 101, source_node: 'pve1', source_name: 'web-1',
      target_node_id: 1, target_vmid: 200, target_node: 'pve1', target_name: 'db-server',
      dep_label: 'braucht Postgres', created_at: '2026-06-18T10:00:00Z', created_by: 1,
      stale: false, stale_at: null, source_installation: 'Haupt', target_installation: 'Haupt',
    },
  ],
}

// Der Impact-409-Body, den die Power-Endpoints liefern, wenn Abhängige existieren.
const IMPACT_409 = {
  detail: {
    error: 'dependency_impact',
    action: 'stop',
    count: 1,
    dependents: [
      { vmid: 101, name: 'web-1', node: 'pve1', installation: 'Haupt', dep_label: 'braucht Postgres' },
    ],
  },
}

// Verwaiste Kanten für die Aufräum-Sicht.
const ORPHANS = [
  {
    id: 9, source_node_id: 1, source_vmid: 999, source_node: 'pve1', source_name: 'ghost-vm',
    target_node_id: 1, target_vmid: 200, target_node: 'pve1', target_name: 'db-server',
    dep_label: null, created_at: '2026-06-01T00:00:00Z', created_by: 1,
    stale: true, stale_at: '2026-06-17T12:00:00Z', source_installation: 'Haupt', target_installation: 'Haupt',
  },
]

// ── Common mocks (PROJ-92-Muster) ───────────────────────────────────────────────

async function mockCommonApi(page, { me = MOCK_ME_ADMIN, caps = CAPS_PLUS } = {}) {
  const isPlus = !!caps.vm_dependencies
  await page.route('**/api/notifications/unread-summary', r =>
    r.fulfill({ json: { alerts: 0, announcements: 0, events: 0, total: 0, max_severity: null } }))
  await page.route('**/api/notifications/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/notifications', r => r.fulfill({ json: [] }))
  await page.route('**/api/system/tooling/**', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' } } }))
  await page.route('**/api/system/tooling', r =>
    r.fulfill({ json: { ansible: { status: 'ready', version: '2.18.1' } } }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ json: { edition: isPlus ? 'plus_v1' : 'core', valid: isPlus, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: isPlus ? null : 6, is_plus: isPlus, max_scheduled_jobs_per_user: isPlus ? null : 3 } }))
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
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/owners/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

// Mocks für die VM-Detailseite (zusätzlich zu mockCommonApi, LIFO → nach dem Catch-all).
async function mockVmDetail(page, detail, { deps = { depends_on: [], dependents: [] } } = {}) {
  await page.route(/\/api\/cluster\/vms\/[^/]+\/[^/]+\/\d+\/backups/, r =>
    r.fulfill({ json: { backups: [], schedules: [], storages: [] } }))
  await page.route(/\/api\/(cluster\/vms\/[^/]+\/[^/]+\/\d+|vms\/\d+)\/guest-info/, r =>
    r.fulfill({ json: {} }))
  await page.route(/\/api\/vms\/\d+\/snapshots$/, r => r.fulfill({ json: [] }))
  await page.route(/\/api\/dependencies(\?|$)/, r => r.fulfill({ json: deps }))
  await page.route(
    new RegExp(`/api/cluster/vms/${detail.node}/${detail.type}/${detail.vmid}$`),
    r => r.fulfill({ json: detail }),
  )
}

async function gotoVmDetail(page, { token = ADMIN_TOKEN, me = MOCK_ME_ADMIN, caps = CAPS_PLUS, detail = VM_DB, deps } = {}) {
  await mockCommonApi(page, { me, caps })
  await mockVmDetail(page, detail, deps ? { deps } : {})
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await page.goto(`/vm/${detail.node}/${detail.type}/${detail.vmid}`)
}

// ── AC-DECLARE-4 / AC-VIEW-5: Section + beide Richtungen ────────────────────────

test('AC-DECLARE-4: VmDetailseite zeigt die Abhängigkeits-Sektion mit beiden Richtungen', async ({ page }) => {
  await gotoVmDetail(page, { deps: DEPS_FOR_DB })
  await expect(page.getByRole('heading', { name: 'Abhängigkeiten', exact: true })).toBeVisible()
  await expect(page.getByText('Hängt ab von')).toBeVisible()
  await expect(page.getByText('Davon hängen ab')).toBeVisible()
  // Der Abhängige (web-1) wird gelistet.
  await expect(page.getByText('web-1')).toBeVisible()
})

test('AC-DECLARE-1: Admin sieht den "Abhängigkeit hinzufügen"-Button (canManage)', async ({ page }) => {
  await gotoVmDetail(page, { deps: DEPS_FOR_DB })
  await expect(page.getByRole('button', { name: 'Abhängigkeit hinzufügen' })).toBeVisible()
})

// ── AC-DECLARE-5 / AC-RBAC-1: read-only ohne manage_dependencies ────────────────

test('AC-DECLARE-5: Operator ohne manage_dependencies sieht die Sektion read-only (kein Hinzufügen)', async ({ page }) => {
  await gotoVmDetail(page, { token: OPERATOR_TOKEN, me: MOCK_ME_OPERATOR, deps: DEPS_FOR_DB })
  // Capability ist an → Sektion sichtbar …
  await expect(page.getByRole('heading', { name: 'Abhängigkeiten', exact: true })).toBeVisible()
  // … aber kein Verwalten-Button (canManage=false).
  await expect(page.getByRole('button', { name: 'Abhängigkeit hinzufügen' })).toHaveCount(0)
})

// ── AC-IMPACT-1/2 (HEADLINE): Stop → Impact-Dialog → Trotzdem fortfahren ────────

test('AC-IMPACT-1/2: Stop einer VM mit Abhängigen warnt und führt nach Bestätigung mit confirm=true aus', async ({ page }) => {
  await gotoVmDetail(page, { deps: DEPS_FOR_DB })
  const stopCalls = []
  await page.route(/\/api\/vms\/200\/stop(\?|$)/, async (r) => {
    const url = r.request().url()
    stopCalls.push(url)
    if (/confirm=true/.test(url)) {
      await r.fulfill({ json: { task_id: 'UPID:done' } })
    } else {
      await r.fulfill({ status: 409, json: IMPACT_409 })
    }
  })

  // 1) Power-Button "Stoppen" (Header) klicken → generischer Confirm-Dialog.
  await page.getByRole('button', { name: 'Stoppen' }).click()
  const confirm1 = page.getByRole('dialog')
  await expect(confirm1.getByText(/wirklich ausführen/)).toBeVisible()
  // 2) Im generischen Dialog bestätigen → guardedRun feuert (confirm=false) → 409.
  await confirm1.getByRole('button', { name: 'Stoppen' }).click()

  // 3) Impact-Dialog erscheint mit dem Abhängigen.
  const impact = page.getByRole('dialog')
  await expect(impact.getByText('Abhängige VMs betroffen')).toBeVisible()
  await expect(impact.getByText('web-1')).toBeVisible()

  // 4) "Trotzdem fortfahren" → Retry mit confirm=true.
  await impact.getByRole('button', { name: 'Trotzdem fortfahren' }).click()
  await expect.poll(() => stopCalls.some((u) => /confirm=true/.test(u))).toBe(true)
  // Der erste Aufruf war confirm=false (löste die Warnung aus).
  expect(stopCalls.some((u) => !/confirm=true/.test(u))).toBe(true)
})

// ── AC-IMPACT-3: keine Abhängigen → kein Impact-Dialog ──────────────────────────

test('AC-IMPACT-3: Stop einer VM ohne Abhängige läuft ohne Impact-Dialog', async ({ page }) => {
  await gotoVmDetail(page) // keine deps
  let stopOk = false
  await page.route(/\/api\/vms\/200\/stop(\?|$)/, async (r) => {
    stopOk = true
    await r.fulfill({ json: { task_id: 'UPID:done' } })
  })
  await page.getByRole('button', { name: 'Stoppen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stoppen' }).click()
  await expect.poll(() => stopOk).toBe(true)
  // Kein Impact-Dialog erschienen.
  await expect(page.getByText('Abhängige VMs betroffen')).toHaveCount(0)
})

// ── AC-VIEW-1: 4. Topologie-Sicht "Abhängigkeiten" gated + lazy Fetch ───────────

test('AC-VIEW-1: Topologie zeigt die 4. Sicht "Abhängigkeiten" und triggert sie lazy', async ({ page }) => {
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route('**/api/cluster/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/cluster/vms', r => r.fulfill({ json: [] }))
  await page.route('**/api/topology/cluster', r => r.fulfill({ json: { installations: [], unreachable: [] } }))
  let depFetchCalled = false
  await page.route('**/api/topology/dependencies', r => {
    depFetchCalled = true
    return r.fulfill({ json: { guests: [], edges: [] } })
  })
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await page.goto('/dashboard?tab=topology')

  const depBtn = page.getByRole('button', { name: 'Abhängigkeiten', exact: true })
  await expect(depBtn).toBeVisible()
  // Vor dem Umschalten wurde der Dependency-EP NICHT geladen (lazy, AC-VIEW lazy).
  expect(depFetchCalled).toBe(false)
  await depBtn.click()
  await expect.poll(() => depFetchCalled).toBe(true)
})

test('AC-VIEW-5: ohne vm_dependencies-Capability fehlt der 4. View-Button', async ({ page }) => {
  await mockCommonApi(page, { caps: { vm_dependencies: false, topology: true } })
  await page.route('**/api/cluster/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/cluster/vms', r => r.fulfill({ json: [] }))
  await page.route('**/api/topology/cluster', r => r.fulfill({ json: { installations: [], unreachable: [] } }))
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await page.goto('/dashboard?tab=topology')
  // Compute-Toolbar da, aber kein Abhängigkeiten-Button.
  await expect(page.getByRole('button', { name: 'Compute', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Abhängigkeiten', exact: true })).toHaveCount(0)
})

// ── AC-RBAC-2: Backend-Gate 404 im Core ─────────────────────────────────────────

test('AC-RBAC-2: /api/dependencies liefert 404 im Core', async ({ page }) => {
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route(/\/api\/dependencies(\?|$)/, r =>
    r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await page.goto('/dashboard')
  const res = await browserFetch(page, '/api/dependencies?vmid=200&node_id=1')
  expect(res.status).toBe(404)
})
