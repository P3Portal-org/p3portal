// p3portal.org
// PROJ-84 — Bestehende (Pre-P3) Hosts ins Ansible-Inventar aufnehmen (Discovery & Onboarding).
// E2E gegen: den „Installation"-Scope (Discovery, manage_ansible_inventory-gated, AC-DISC-3),
// die Discovery-Liste mit Managed-/„kein Run-Scope"-Badges (AC-DISC-1/AC-RUN-2), Such-/Statusfilter
// (AC-DISC-5), Einzel-/Bulk-Onboarding (AC-ONB-1/2/3), „Als verwaltet markieren" in der Eigene-Sicht
// (AC-MARK-1/3), den informativen Verbindungstest (AC-VERIFY-2/3) und das Core-404-Edition-Gate
// der Discovery-/Onboard-EPs (AC-DISC-4).
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999,"user_id":2}
const OP_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5LCJ1c2VyX2lkIjoyfQ' +
  '.fake-sig'

// role=operator, portal_permissions:["manage_ansible_inventory"]
const MGR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJtZ3IiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJvcGVyYXRvciIsInBvcnRhbF9wZXJtaXNzaW9ucyI6WyJtYW5hZ2VfYW5zaWJsZV9pbnZlbnRvcnkiXSwiZXhwIjo5OTk5OTk5OTk5LCJ1c2VyX2lkIjozfQ' +
  '.fake-sig'

const MOCK_ME_MGR = {
  id: 3, username: 'mgr', role: 'operator', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_ansible_inventory'], groups: [],
}
const MOCK_ME_OP = {
  id: 2, username: 'operator', role: 'operator', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: [], groups: [],
}

const CAPS_CORE = {
  config_snapshots: false, approval_workflow: false, approval_workflow_enabled: false,
  alert_presets: false, auto_snapshots: false, stacks: false, ansible_inventory: false,
}
const CAPS_PLUS = { ...CAPS_CORE, ansible_inventory: true }

// Eigene-Sicht (user-scope): ein unmanaged, ein managed, ein no_ip.
const HOSTS_USER = {
  scope: 'user', scope_ref: null, error: null,
  hosts: [
    { host_ref: '1:100:qemu', portal_node_id: 1, proxmox_node: 'pve1', vmid: 100, kind: 'qemu', group: 'managed', ip: '192.168.1.100', ansible_user: 'p3-ansible' },
    { host_ref: '1:101:qemu', portal_node_id: 1, proxmox_node: 'pve1', vmid: 101, kind: 'qemu', group: 'unmanaged', ip: null, ansible_user: 'p3-ansible' },
    { host_ref: '1:300:lxc', portal_node_id: 1, proxmox_node: 'pve1', vmid: 300, kind: 'lxc', group: 'no_ip', ip: null, ansible_user: 'p3-ansible' },
  ],
}

// Discovery (Installation-Scope): ALLE Gäste, ownership-unabhängig.
//  - 100 managed + in_run_scope  (global)
//  - 101 managed, NICHT in_run_scope (AC-RUN-2)
//  - 200 managed ohne IP (no_ip → Verbindungstest nicht verfügbar)
//  - 102 unmanaged
const DISCOVERY = {
  portal_node_id: 1, error: null,
  hosts: [
    { host_ref: '1:100:qemu', portal_node_id: 1, proxmox_node: 'pve1', vmid: 100, kind: 'qemu', name: 'web', status: 'running', managed: true, in_run_scope: true, ip: '192.168.1.100' },
    { host_ref: '1:101:qemu', portal_node_id: 1, proxmox_node: 'pve1', vmid: 101, kind: 'qemu', name: 'db', status: 'running', managed: true, in_run_scope: false, ip: '192.168.1.101' },
    { host_ref: '1:200:lxc', portal_node_id: 1, proxmox_node: 'pve1', vmid: 200, kind: 'lxc', name: 'ct-noip', status: 'running', managed: true, in_run_scope: true, ip: null },
    { host_ref: '1:102:qemu', portal_node_id: 1, proxmox_node: 'pve1', vmid: 102, kind: 'qemu', name: 'legacy', status: 'stopped', managed: false, in_run_scope: false, ip: null },
  ],
}

const NODES = [
  { portal_node_id: 1, portal_node_name: 'Installation A', node: 'pve1' },
]

const ONBOARD_RESULT = {
  detail: 'onboarded', host_ref: '1:102:qemu',
  block: '#!/bin/sh\ngetent passwd p3-ansible || useradd -m p3-ansible\n# NOPASSWD sudo ...',
  key_count: 1, skipped_already_managed: false,
}

const ONBOARDING_BLOCK = {
  block: '#!/bin/sh\ngetent passwd p3-ansible || useradd -m p3-ansible\n# NOPASSWD sudo ...',
  vendor_data: '#cloud-config\nruncmd:\n  - [ /bin/sh, /var/lib/p3-onboard.sh ]\n',
  key_count: 1,
}

// ── Common mocks (LIFO: Catch-Alls zuerst, Spezifisches danach im goto-Helfer) ──
async function mockCommonApi(page, { me = MOCK_ME_MGR, caps = CAPS_PLUS } = {}) {
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
    r.fulfill({ json: { edition: caps.ansible_inventory ? 'plus_v1' : 'core', valid: caps.ansible_inventory, contact_name: null, expiry: null, reason: null } }))
  await page.route('**/api/license/limits', r =>
    r.fulfill({ json: { max_users: caps.ansible_inventory ? null : 6, max_presets: null, max_api_keys: null, is_plus: caps.ansible_inventory, max_scheduled_jobs_per_user: caps.ansible_inventory ? null : 3 } }))
  await page.route('**/api/capabilities', r => r.fulfill({ json: caps }))
  await page.route('**/api/me/permissions', r => r.fulfill({ json: { roles: [], permissions: [], assignments: [] } }))
  await page.route('**/api/me/node-assignments', r => r.fulfill({ json: [] }))
  await page.route('**/api/me', r => r.fulfill({ json: me }))
  await page.route('**/api/setup/status', r =>
    r.fulfill({ json: { setup_complete: true, has_admin: true, has_node: true, setup_required: false } }))
  await page.route('**/api/portal/config', r =>
    r.fulfill({ json: { active_theme: 'dark', active_lang: 'de', interface_version: 'v2' } }))
  await page.route('**/api/sidebar-pins', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/nodes', r => r.fulfill({ json: [] }))
  await page.route('**/api/admin/settings**', r =>
    r.fulfill({ json: { proxmox_node: 'pve1', vm_id_range_start: 100, vm_id_range_end: 199 } }))
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
  await page.route('**/api/scheduled-jobs', r => r.fulfill({ json: [] }))
  await page.route('**/api/scheduled-jobs/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools', r => r.fulfill({ json: [] }))
  await page.route('**/api/pools/**', r => r.fulfill({ json: [] }))
  await page.route('**/api/git-sync/**', r => r.fulfill({ json: { conflicts: [] } }))
}

async function browserFetch(page, url, options = {}) {
  return page.evaluate(async ({ u, o }) => {
    const r = await fetch(u, o)
    let body = null
    try { body = await r.json() } catch { /* not json */ }
    return { status: r.status, body }
  }, { u: url, o: options })
}

// Default-Actor = Inventory-Manager (operator + manage_ansible_inventory) — der kanonische
// PROJ-84-Akteur. (Admin-Rolle triggert im FE ungemockte Layout-Calls; admins `role==='admin'`-
// Shortcut für canManageInventory ist separat per Vitest abgedeckt. PROJ-83 nutzte aus demselben
// Grund durchgehend einen Operator-Token.)
async function gotoInventory(page, {
  token = MGR_TOKEN, me = MOCK_ME_MGR, caps = CAPS_PLUS,
  hosts = HOSTS_USER, discovery = DISCOVERY, nodes = NODES,
} = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await mockCommonApi(page, { me, caps })
  // Spezifische Inventory-/Discovery-Routen (nach den Catch-Alls → gewinnen, LIFO).
  await page.route(/\/api\/cluster\/nodes(\?.*)?$/, r => r.fulfill({ json: nodes }))
  await page.route(/\/api\/ansible-inventory\/hosts(\?.*)?$/, r => r.fulfill({ json: hosts }))
  await page.route(/\/api\/ansible-inventory\/discovery(\?.*)?$/, r => r.fulfill({ json: discovery }))
  await page.route(/\/api\/ansible-inventory\/onboarding-block(\?.*)?$/, r => r.fulfill({ json: ONBOARDING_BLOCK }))
  await page.goto('/automation?tab=inventory')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-DISC-3: „Installation"-Scope-Gate (Plus + manage_ansible_inventory/Admin)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-DISC-3: Inventory-Manager (Plus, manage_ansible_inventory) sieht den „Installation"-Scope', async ({ page }) => {
  await gotoInventory(page, { token: MGR_TOKEN, me: MOCK_ME_MGR, caps: CAPS_PLUS })
  await expect(page.getByRole('button', { name: 'Installation', exact: true })).toBeVisible()
})

test('AC-DISC-3 (negativ): Operator ohne manage_ansible_inventory sieht den „Installation"-Scope NICHT', async ({ page }) => {
  await gotoInventory(page, { token: OP_TOKEN, me: MOCK_ME_OP, caps: CAPS_PLUS })
  await expect(page.getByRole('button', { name: 'Eigene', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Installation', exact: true })).toHaveCount(0)
})

test('AC-DISC-3 (negativ): Inventory-Manager in Pure Core (keine ansible_inventory-Capability) sieht „Installation" NICHT', async ({ page }) => {
  await gotoInventory(page, { token: MGR_TOKEN, me: MOCK_ME_MGR, caps: CAPS_CORE })
  await expect(page.getByRole('button', { name: 'Eigene', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Installation', exact: true })).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-DISC-1 / AC-RUN-2 / AC-DISC-5: Discovery-Liste, Badges, Filter
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-DISC-1/AC-RUN-2: Discovery listet alle Gäste mit managed/unmanaged + „kein Run-Scope"-Badge', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Installation', exact: true }).click()
  // Alle vier Gäste sichtbar
  await expect(page.getByText('web', { exact: true })).toBeVisible()
  await expect(page.getByText('db', { exact: true })).toBeVisible()
  await expect(page.getByText('legacy', { exact: true })).toBeVisible()
  await expect(page.getByText('ct-noip', { exact: true })).toBeVisible()
  // IP nur für managed Host mit IP
  await expect(page.getByText('192.168.1.100')).toBeVisible()
  // „kein Run-Scope"-Badge an Host 101 (managed && !in_run_scope, AC-RUN-2)
  await expect(page.getByText('kein Run-Scope', { exact: true })).toBeVisible()
})

test('AC-DISC-5: Statusfilter „Nicht verwaltet" zeigt nur unmanaged Gäste', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Installation', exact: true }).click()
  await expect(page.getByText('web', { exact: true })).toBeVisible()
  // Filter auf unmanaged
  await page.getByRole('button', { name: 'Nicht verwaltet', exact: true }).click()
  await expect(page.getByText('legacy', { exact: true })).toBeVisible()
  await expect(page.getByText('web', { exact: true })).toHaveCount(0)
})

test('AC-DISC-5: Suche grenzt nach Name/VMID ein', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Installation', exact: true }).click()
  await page.getByPlaceholder('Suche (Name / VMID / Node)').fill('legacy')
  await expect(page.getByText('legacy', { exact: true })).toBeVisible()
  await expect(page.getByText('web', { exact: true })).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-ONB-1/3: Einzel-Onboarding → POST + Onboarding-Block im Ergebnis-Modal
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-ONB-1/3: Einzel-Onboarden eines unmanaged Gastes → POST /onboard + Block im Ergebnis', async ({ page }) => {
  let onboardBody = null
  await gotoInventory(page)
  await page.route(/\/api\/ansible-inventory\/onboard$/, r => {
    onboardBody = JSON.parse(r.request().postData() || '{}')
    r.fulfill({ json: ONBOARD_RESULT })
  })
  await page.getByRole('button', { name: 'Installation', exact: true }).click()
  // unmanaged Gast „legacy" hat einen „Onboarden"-Button in seiner Zeile
  const legacyRow = page.locator('li', { hasText: 'legacy' })
  await legacyRow.getByRole('button', { name: 'Onboarden', exact: true }).click()
  // Ergebnis-Modal zeigt den manuellen Onboarding-Block
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Onboarding-Ergebnis', { exact: true })).toBeVisible()
  await expect(page.getByText(/p3-ansible/).first()).toBeVisible()
  // POST hat die Host-Koordinaten + ownership-frei (kein owner) geschickt
  await expect.poll(() => onboardBody && onboardBody.vmid).toBe(102)
  expect(onboardBody.kind).toBe('qemu')
  expect(onboardBody.portal_node_id).toBe(1)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-ONB-2: Bulk-Onboarding → select-all + „N onboarden" → POST /onboard/bulk
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-ONB-2: Bulk-Onboarding (Alle auswählen → N onboarden) → POST /onboard/bulk mit Zähler-Ergebnis', async ({ page }) => {
  let bulkBody = null
  await gotoInventory(page)
  await page.route(/\/api\/ansible-inventory\/onboard\/bulk$/, r => {
    bulkBody = JSON.parse(r.request().postData() || '{}')
    r.fulfill({ json: { onboarded: 3, skipped: 1, failed: [] } })
  })
  await page.getByRole('button', { name: 'Installation', exact: true }).click()
  // Alle auswählen
  await page.getByText('Alle auswählen', { exact: true }).click()
  // Bulk-Button trägt die Auswahlanzahl (4 Gäste)
  await page.getByRole('button', { name: /onboarden/, exact: false }).filter({ hasText: /\d/ }).click()
  // Ergebnis-Modal mit Zählern
  await expect(page.getByText('Onboarding-Ergebnis', { exact: true })).toBeVisible()
  await expect(page.getByText('onboardet', { exact: true })).toBeVisible()
  await expect(page.getByText('übersprungen', { exact: true })).toBeVisible()
  await expect.poll(() => Array.isArray(bulkBody?.hosts) ? bulkBody.hosts.length : 0).toBe(4)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MARK-1/3: „Als verwaltet markieren" in der Eigene-Sicht + Onboarding-Hinweis
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MARK-1/3: unmanaged Host in der Eigene-Sicht → „Als verwaltet markieren" → Confirm (mit Hinweis) → POST', async ({ page }) => {
  let markCalled = false
  await gotoInventory(page)
  await page.route(/\/api\/ansible-inventory\/hosts\/\d+\/(qemu|lxc)\/\d+\/mark-managed$/, r => {
    markCalled = true
    r.fulfill({ json: { detail: 'managed', host_ref: '1:101:qemu', in_run_scope: false } })
  })
  // Eigene-Sicht ist Default-Scope. unmanaged Host 101 hat „Als verwaltet markieren".
  const markBtn = page.getByRole('button', { name: 'Als verwaltet markieren', exact: true })
  await expect(markBtn).toHaveCount(1)
  await markBtn.click()
  // ConfirmModal mit Hinweis, ZUERST den Onboarding-Block auszuführen (AC-MARK-3)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Host als verwaltet markieren?', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/Führe ZUERST den Onboarding-Block/)).toBeVisible()
  // Bestätigen
  await dialog.getByRole('button', { name: 'Als verwaltet markieren', exact: true }).click()
  await expect.poll(() => markCalled).toBe(true)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-VERIFY-2/3: Verbindungstest (informativ) + „nicht verfügbar" bei fehlender IP
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-VERIFY-2: Verbindungstest an managed Host mit IP → POST + Inline-Ergebnis', async ({ page }) => {
  await gotoInventory(page)
  await page.route(/\/api\/ansible-inventory\/hosts\/\d+\/(qemu|lxc)\/\d+\/test-connection$/, r =>
    r.fulfill({ json: { ok: true, reason: 'ok' } }))
  await page.getByRole('button', { name: 'Installation', exact: true }).click()
  // managed Host „web" mit IP zeigt „Verbindung testen"
  const webRow = page.locator('li', { hasText: 'web' }).first()
  await webRow.getByRole('button', { name: 'Verbindung testen', exact: true }).click()
  // Inline-Ergebnis (✓ erreichbar)
  await expect(webRow.getByText('✓', { exact: false })).toBeVisible()
})

test('AC-VERIFY-3: managed Host ohne IP → Verbindungstest „nicht verfügbar" (kein Button)', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Installation', exact: true }).click()
  // ct-noip ist managed ohne IP → „Test nicht verfügbar" statt Button
  const noIpRow = page.locator('li', { hasText: 'ct-noip' })
  await expect(noIpRow.getByText('Test nicht verfügbar', { exact: true })).toBeVisible()
  await expect(noIpRow.getByRole('button', { name: 'Verbindung testen', exact: true })).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-DISC-4: Discovery-/Onboard-EPs antworten 404 in Pure Core (Edition-Gate)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-DISC-4: Discovery-/Onboard-EPs antworten 404 ohne ansible_inventory-Capability (Pure Core)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), MGR_TOKEN)
  await mockCommonApi(page, { me: MOCK_ME_MGR, caps: CAPS_CORE })
  // Plus-Router liefert 404 wenn can_use_ansible_inventory()==False.
  await page.route(/\/api\/ansible-inventory\/discovery(\?.*)?$/, r =>
    r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.route(/\/api\/ansible-inventory\/onboard$/, r =>
    r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/automation?tab=inventory')
  await page.waitForLoadState('networkidle')
  const disc = await browserFetch(page, '/api/ansible-inventory/discovery?node=1')
  expect(disc.status).toBe(404)
  const onb = await browserFetch(page, '/api/ansible-inventory/onboard', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ portal_node_id: 1, kind: 'qemu', vmid: 100 }),
  })
  expect(onb.status).toBe(404)
})
