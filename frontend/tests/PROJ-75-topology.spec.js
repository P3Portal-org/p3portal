// p3portal.org
// PROJ-75: E2E-Tests für die Cluster-Topologie-Ansicht (Plus-only).
// Testet: Capability-Gating (Core vs. Plus) für Dashboard-Widget + Tab + API-404,
//         Widget (eingeklappt-Default + Kompakt-Stats + "Vollbild öffnen"),
//         Tab (URL ?tab=topology + FilterToolbar + View-Toggle Compute/Netz),
//         lazy Netz-Fetch, Empty-State, Filter, Guest-Knoten-Render.
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
  alert_presets: false, auto_snapshots: false, stacks: false, topology: false,
}
const CAPS_PLUS = { ...CAPS_CORE, topology: true }

const CLUSTER_TOPO = {
  installations: [
    {
      id: 'inst1', name: 'produktiv', unreachable: false,
      nodes: [
        { id: 'inst1-node-pve1', node: 'pve1', label: 'pve1', status: 'online', cpu_count: 8, ram_total: 16e9, disk_total: 500e9 },
      ],
      guests: [
        {
          id: 'inst1-vm-101', parent_node_id: 'inst1-node-pve1', node: 'pve1', type: 'vm',
          label: 'web-1', vmid: 101, status: 'running', cpu: 0.42, maxcpu: 4,
          mem: 2.1e9, maxmem: 4e9, disk: 0, maxdisk: 32e9,
          managed_by_stack: 'webstack', ssh_managed: true, is_template: false, ip: '192.168.2.50',
        },
        {
          id: 'inst1-lxc-201', parent_node_id: 'inst1-node-pve1', node: 'pve1', type: 'lxc',
          label: 'db-1', vmid: 201, status: 'stopped', cpu: 0, maxcpu: 2,
          mem: 0, maxmem: 2e9, disk: 1.2e9, maxdisk: 16e9,
          managed_by_stack: null, ssh_managed: false, is_template: false,
        },
        {
          id: 'inst1-vm-900', parent_node_id: 'inst1-node-pve1', node: 'pve1', type: 'vm',
          label: 'tmpl-debian12', vmid: 900, status: 'stopped', cpu: 0, maxcpu: 2,
          mem: 0, maxmem: 2e9, disk: 0, maxdisk: 0,
          managed_by_stack: null, ssh_managed: false, is_template: true,
        },
      ],
    },
  ],
  stats: { installations: 1, nodes: 1, vms: 1, lxcs: 1, running: 1, stack_managed: 1 },
  stacks: ['webstack'],
}

const NETWORK_TOPO = {
  networks: [
    { id: 'inst1-pve1-vmbr0', installation_id: 'inst1', kind: 'node_bridge', label: 'vmbr0', scope: 'node', node: 'pve1', vlan_tag: null, owning_stack: null, address: '192.168.2.1/24' },
    { id: 'inst1-sdn-vnet5', installation_id: 'inst1', kind: 'sdn_vnet', label: 'vnet5', scope: 'cluster', node: null, vlan_tag: 100, owning_stack: null },
  ],
  edges_conn: [
    { guest_id: 'inst1-vm-101', network_id: 'inst1-pve1-vmbr0' },
    { guest_id: 'inst1-lxc-201', network_id: 'inst1-sdn-vnet5' },
  ],
  unreachable_installations: [],
}

const EMPTY_TOPO = {
  installations: [{ id: 'inst1', name: 'produktiv', unreachable: false, nodes: [], guests: [] }],
  stats: { installations: 1, nodes: 0, vms: 0, lxcs: 0, running: 0, stack_managed: 0 },
  stacks: [],
}

// ── Common mocks ─────────────────────────────────────────────────────────────

async function mockCommonApi(page, { caps = CAPS_PLUS } = {}) {
  // Catch-all für cluster zuerst (LIFO: spezifischere Routes überschreiben).
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
    r.fulfill({ json: { edition: caps.topology ? 'plus_v1' : 'core', valid: caps.topology, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: caps.topology ? null : 6, max_presets: null, max_api_keys: null, is_plus: caps.topology, max_scheduled_jobs_per_user: caps.topology ? null : 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me', r => r.fulfill({ json: MOCK_ME_ADMIN }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes', r => r.fulfill({ json: [] }))
  await page.route('**/api/themes/default', r => r.fulfill({ json: { theme_id: 'dark' } }))
  await page.route('**/api/i18n/languages', r => r.fulfill({ json: [{ code: 'de', name: 'Deutsch', is_builtin: true }] }))
  await page.route('**/api/i18n/default', r => r.fulfill({ json: { lang_code: 'de' } }))
  await page.route('**/api/announcements', r => r.fulfill({ json: [] }))
  await page.route('**/api/node-updates/summary', r => r.fulfill({ json: { entries: [] } }))
  await page.route('**/api/node-updates/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

async function gotoDashboard(page, { caps = CAPS_PLUS, cluster = CLUSTER_TOPO, network = NETWORK_TOPO, topo404 = false } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  if (topo404) {
    await page.route(/localhost:\d+\/api\/topology\//, r =>
      r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  } else {
    await page.route(/localhost:\d+\/api\/topology\/cluster/, r => r.fulfill({ json: cluster }))
    await page.route(/localhost:\d+\/api\/topology\/network/, r => r.fulfill({ json: network }))
  }
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-CAP: Capability-Gating (Plus vs. Core)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-CAP-2 Plus: Topologie-Widget wird auf dem Dashboard gerendert', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await expect(page.locator('text=Cluster-Topologie').first()).toBeVisible({ timeout: 5000 })
})

test('AC-CAP-3 Plus: Tab "Topologie" wird gerendert', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await expect(page.getByRole('button', { name: 'Topologie', exact: true })).toBeVisible({ timeout: 5000 })
})

test('AC-CAP-2/3 Core: kein Widget, kein Tab', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_CORE })
  await expect(page.locator('text=Cluster-Topologie')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Topologie', exact: true })).toHaveCount(0)
})

test('AC-CAP-3 Core: ?tab=topology bleibt auf Übersicht (kein Tab-Switch)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.goto('/dashboard?tab=topology')
  await page.waitForLoadState('networkidle')
  // Keine FilterToolbar (View-Toggle) sichtbar, da activeTab auf overview gezwungen.
  await expect(page.getByRole('button', { name: 'Compute', exact: true })).toHaveCount(0)
})

test('AC-CAP-4 / AC-BE-8: /api/topology/* 404 im Core (Mock-Vertrag)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route(/localhost:\d+\/api\/topology\//, r => r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  const cluster = await browserFetch(page, '/api/topology/cluster')
  const network = await browserFetch(page, '/api/topology/network')
  expect(cluster.status).toBe(404)
  expect(network.status).toBe(404)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-WIDGET: Dashboard-Widget
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-WIDGET-2/3: Widget eingeklappt mit Kompakt-Statistik (Default)', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  // Default eingeklappt → Stats sichtbar, Graph (ReactFlow) NICHT gerendert.
  await expect(page.locator('text=Cluster-Topologie').first()).toBeVisible()
  await expect(page.locator('text=Installationen').first()).toBeVisible()
  await expect(page.locator('text=Nodes').first()).toBeVisible()
  await expect(page.locator('.react-flow')).toHaveCount(0)
})

test('AC-WIDGET-4: Widget ausgeklappt rendert Compute-Graph', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  // Aufklappen über den Titel-Button.
  await page.getByRole('button', { name: /Cluster-Topologie/ }).click()
  await expect(page.locator('.react-flow').first()).toBeVisible({ timeout: 5000 })
})

test('AC-WIDGET-6: "Vollbild öffnen" navigiert zu ?tab=topology', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await page.getByRole('button', { name: 'Vollbild öffnen' }).click()
  await expect(page).toHaveURL(/\?tab=topology/)
  await expect(page.getByRole('button', { name: 'Compute', exact: true })).toBeVisible({ timeout: 5000 })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-TAB + AC-VIEW: Vollbild-Tab + View-Toggle
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-TAB-1/2/4 + AC-VIEW-2: Tab öffnet Vollbild mit FilterToolbar, Compute default', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await page.getByRole('button', { name: 'Topologie', exact: true }).click()
  await expect(page).toHaveURL(/\?tab=topology/)
  // FilterToolbar: View-Toggle + Filter-Selects + Suche.
  await expect(page.getByRole('button', { name: 'Compute', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Netzwerk', exact: true })).toBeVisible()
  await expect(page.getByPlaceholder('Name / VMID…')).toBeVisible()
})

test('AC-CMP-2: Guest-Knoten rendert Name + VMID + Status', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await page.getByRole('button', { name: 'Topologie', exact: true }).click()
  await expect(page.locator('.react-flow').first()).toBeVisible({ timeout: 5000 })
  // ReactFlow rendert die Custom-Guest-Knoten als DOM.
  await expect(page.locator('text=web-1').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=db-1').first()).toBeVisible({ timeout: 5000 })
})

test('COMPUTE: Templates getrennt in "Vorlagen"-Bereich (nicht im VM-Raster)', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await page.getByRole('button', { name: 'Topologie', exact: true }).click()
  await expect(page.locator('.react-flow').first()).toBeVisible({ timeout: 5000 })
  // eigener "Vorlagen"-Header + das Template darunter
  await expect(page.locator('text=Vorlagen').first()).toBeVisible()
  await expect(page.locator('text=tmpl-debian12').first()).toBeVisible()
})

test('AC-VIEW-1 + AC-PERF-5: Wechsel auf Netz-Sicht triggert lazy /network-Fetch', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/topology\/cluster/, r => r.fulfill({ json: CLUSTER_TOPO }))
  let networkCalled = false
  await page.route(/localhost:\d+\/api\/topology\/network/, r => { networkCalled = true; r.fulfill({ json: NETWORK_TOPO }) })
  await page.goto('/dashboard?tab=topology')
  await page.waitForLoadState('networkidle')
  // Compute-Sicht aktiv → /network noch nicht gerufen (lazy).
  expect(networkCalled).toBe(false)
  await page.getByRole('button', { name: 'Netzwerk', exact: true }).click()
  await expect.poll(() => networkCalled, { timeout: 5000 }).toBe(true)
})

test('AC-TAB-8: Empty-State bei 0 Knoten', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS, cluster: EMPTY_TOPO })
  await page.getByRole('button', { name: 'Topologie', exact: true }).click()
  // 0 Gäste + kein aktiver Filter → no_access-Empty-State.
  await expect(page.locator('text=Keine Ressourcen sichtbar')).toBeVisible({ timeout: 5000 })
})

test('BUG-NET-DIAG: Netz-Konnektivitäts-Diagnose-Banner bei fehlgeschlagenen Configs', async ({ page }) => {
  // PVE1-Szenario: Bridges erscheinen, aber alle per-VM-Configs scheitern →
  // 0 Kanten + Diagnose-Banner statt stillem leerem Graph.
  const NETWORK_FAILED = {
    networks: [
      { id: 'inst1-pve1-vmbr0', installation_id: 'inst1', kind: 'node_bridge', label: 'vmbr0', scope: 'node', node: 'pve1', vlan_tag: null, owning_stack: null },
    ],
    edges_conn: [],
    unreachable_installations: [],
    diagnostics: [
      { installation_id: 'inst1', name: 'produktiv', guests_total: 24, guests_ok: 0, guests_failed: 24, networks_found: 6, edges_found: 0, sample_errors: ['403'] },
    ],
  }
  await gotoDashboard(page, { caps: CAPS_PLUS, network: NETWORK_FAILED })
  await page.getByRole('button', { name: 'Topologie', exact: true }).click()
  await page.getByRole('button', { name: 'Netzwerk', exact: true }).click()
  await expect(page.locator('text=/Netz-Konnektivität unvollständig/')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=/24 von 24/')).toBeVisible()
  await expect(page.locator('text=/403/')).toBeVisible()
})

test('BOARD: Netz-Board zeigt Bridge-Boxen mit vollständigen Gästenamen (kein ReactFlow)', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await page.getByRole('button', { name: 'Topologie', exact: true }).click()
  await page.getByRole('button', { name: 'Netz-Board', exact: true }).click()
  // Bridge-Box-Header (Bridge-Name) sichtbar
  await expect(page.locator('text=vmbr0').first()).toBeVisible({ timeout: 5000 })
  // volle Gästenamen als Karten (web-1 / db-1) — nicht im ReactFlow-Canvas
  await expect(page.locator('text=web-1').first()).toBeVisible()
  await expect(page.locator('text=db-1').first()).toBeVisible()
  // Board ist linienfrei: keine ReactFlow-Canvas-Instanz
  await expect(page.locator('.react-flow')).toHaveCount(0)
  // Node-Card-Kopfzeile (pve1) statt "Installation: pve1"
  await expect(page.locator('text=pve1').first()).toBeVisible()
  await expect(page.locator('text=/Installation:/')).toHaveCount(0)
  // Bridge-IP + VM-IP sichtbar
  await expect(page.locator('text=192.168.2.1/24')).toBeVisible()
  await expect(page.locator('text=192.168.2.50')).toBeVisible()
})

test('AC-TAB-4 + AC-STACK-3: Stack-Filter-Dropdown enthält aktive Stacks', async ({ page }) => {
  await gotoDashboard(page, { caps: CAPS_PLUS })
  await page.getByRole('button', { name: 'Topologie', exact: true }).click()
  const stackSelect = page.getByLabel('Stack', { exact: true })
  await expect(stackSelect).toBeVisible({ timeout: 5000 })
  await expect(stackSelect.locator('option', { hasText: 'webstack' })).toHaveCount(1)
})
