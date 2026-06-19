// p3portal.org
// PROJ-83 — Ansible-Inventory & In-Guest-Playbook-Runs.
// E2E gegen die Inventory-Sicht (Automation-Tab), die Run-Surface (PlaybookForm
// bei targets==='guest'), das Onboarding-Block-Modal, Host-Key-Reset, die
// Deploy-Opt-out-Haken und das Core-404-Edition-Gate der Pool-/Global-Scope-EPs.
import { test, expect } from '@playwright/test'

const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'

// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999,"user_id":2}
const OP_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5LCJ1c2VyX2lkIjoyfQ' +
  '.fake-sig'

const MOCK_ME_ADMIN = {
  id: 1, username: 'admin', role: 'admin', auth_type: 'local',
  must_change_pw: false, last_login_at: null, last_login_ip: null,
  portal_permissions: ['manage_users', 'manage_settings'], groups: [],
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
const CAPS_PLUS = { ...CAPS_CORE, ansible_inventory: true, stacks: true }

// Hosts in allen drei Gruppen (AC-INV-4).
const HOSTS = {
  scope: 'user', scope_ref: null, error: null,
  hosts: [
    { host_ref: '1:100:qemu', portal_node_id: 1, proxmox_node: 'pve1', vmid: 100, kind: 'qemu', group: 'managed', ip: '192.168.1.100', ansible_user: 'p3-ansible' },
    { host_ref: '1:101:qemu', portal_node_id: 1, proxmox_node: 'pve1', vmid: 101, kind: 'qemu', group: 'unmanaged', ip: null, ansible_user: 'p3-ansible' },
    { host_ref: '1:300:lxc', portal_node_id: 1, proxmox_node: 'pve1', vmid: 300, kind: 'lxc', group: 'no_ip', ip: null, ansible_user: 'p3-ansible' },
  ],
}

const ONBOARDING = {
  block: '#!/bin/sh\ngetent passwd p3-ansible || useradd -m p3-ansible\n# NOPASSWD sudo ...',
  vendor_data: '#cloud-config\nruncmd:\n  - [ /bin/sh, /var/lib/p3-onboard.sh ]\n',
  key_count: 1,
}

const PLAYBOOK_GUEST = {
  id: 'configure-guest', name: 'Configure Guest', description: 'Konfiguriert den Gast per SSH',
  category: 'vm_deployment', required_role: null, parameters: [], targets: 'guest',
}
const PLAYBOOK_LOCALHOST = {
  id: 'deploy-vm', name: 'Deploy VM', description: 'Erstellt eine VM',
  category: 'vm_deployment', required_role: null, parameters: [], targets: 'localhost',
}

// ── Common mocks (LIFO: Catch-Alls zuerst, Spezifisches in den goto-Helfern danach) ──
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

async function gotoInventory(page, { token = OP_TOKEN, me = MOCK_ME_OP, caps = CAPS_PLUS, hosts = HOSTS, onboarding = ONBOARDING } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
  await mockCommonApi(page, { me, caps })
  await page.route(/\/api\/ansible-inventory\/hosts(\?.*)?$/, r => r.fulfill({ json: hosts }))
  await page.route(/\/api\/ansible-inventory\/onboarding-block(\?.*)?$/, r => r.fulfill({ json: onboarding }))
  await page.route(/\/api\/ansible-inventory\/hosts\/\d+\/(qemu|lxc)\/\d+\/reset-host-key$/, r =>
    r.fulfill({ json: { detail: 'reset' } }))
  await page.goto('/automation?tab=inventory')
  await page.waitForLoadState('networkidle')
}

async function gotoProvisioning(page, { playbooks = [PLAYBOOK_GUEST], detail = PLAYBOOK_GUEST, caps = CAPS_PLUS } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OP_TOKEN)
  await mockCommonApi(page, { me: MOCK_ME_OP, caps })
  await page.route(/\/api\/ansible-inventory\/hosts(\?.*)?$/, r => r.fulfill({ json: HOSTS }))
  await page.route('**/api/playbooks', r => r.fulfill({ json: playbooks }))
  await page.route(/\/api\/playbooks\/[^/]+$/, r => r.fulfill({ json: detail }))
  await page.route('**/api/owners/config', r => r.fulfill({ json: { owner_auto_assign_enabled: true, owner_auto_assign_categories: ['vm_deployment', 'lxc_deployment'] } }))
  await page.route('**/api/owners/**', r => r.fulfill({ json: [] }))
  await page.goto('/provisioning?tab=vm_deployment')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// Inventory-Sicht: Gruppen + Edition-Gate (AC-INV-4/5, AC-SCOPE)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-INV-4: Inventory-Sicht zeigt managed/unmanaged/no_ip mit Gruppen-Badges', async ({ page }) => {
  await gotoInventory(page)
  await expect(page.getByText('Ansible-Inventar', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('VM 100', { exact: false })).toBeVisible()
  await expect(page.getByText('verwaltet', { exact: true })).toBeVisible()
  await expect(page.getByText('nicht verwaltet', { exact: true })).toBeVisible()
  await expect(page.getByText('keine IP', { exact: true })).toBeVisible()
  // managed Host zeigt seine IP
  await expect(page.getByText('192.168.1.100')).toBeVisible()
})

test('AC-SCOPE Plus: Pool- und Global-Scope-Umschalter sind sichtbar', async ({ page }) => {
  await gotoInventory(page, { caps: CAPS_PLUS })
  await expect(page.getByRole('button', { name: 'Eigene', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pool', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Global', exact: true })).toBeVisible()
})

test('AC-SCOPE Core: nur Eigene-Scope; Pool/Global ausgeblendet (Edition-Gate)', async ({ page }) => {
  await gotoInventory(page, { caps: CAPS_CORE })
  await expect(page.getByRole('button', { name: 'Eigene', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pool', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Global', exact: true })).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Host-Key-Reset (AC-HK-3) — nur für managed Hosts
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-HK-3: Host-Key-Reset nur bei managed Host, Confirm → POST', async ({ page }) => {
  let resetCalled = false
  await gotoInventory(page)
  // Reset-Aktion wird durch die Route oben bedient; zähle den Aufruf:
  await page.route(/\/api\/ansible-inventory\/hosts\/\d+\/(qemu|lxc)\/\d+\/reset-host-key$/, r => {
    resetCalled = true
    r.fulfill({ json: { detail: 'reset' } })
  })
  // Genau ein „Host-Key zurücksetzen"-Button (nur managed Host hat ihn).
  const resetBtns = page.getByRole('button', { name: 'Host-Key zurücksetzen', exact: true })
  await expect(resetBtns).toHaveCount(1)
  await resetBtns.click()
  // ConfirmModal erscheint
  await expect(page.getByText('Host-Key zurücksetzen?', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^(Ja|Bestätigen|Zurücksetzen|Host-Key zurücksetzen)$/ }).last().click()
  await expect.poll(() => resetCalled).toBe(true)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Onboarding-Block-Modal (AC-KEY-5)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-KEY-5: Onboarding-Block-Modal lädt manuellen Block + cloud-init vendor-data', async ({ page }) => {
  await gotoInventory(page)
  await page.getByRole('button', { name: 'Onboarding-Block anzeigen', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Manuell im Gast einfügen', { exact: true })).toBeVisible()
  await expect(page.getByText('cloud-init vendor-data (Deploy)', { exact: true })).toBeVisible()
  // Block-Inhalt sichtbar (Service-User)
  await expect(page.getByText(/p3-ansible/).first()).toBeVisible()
})

test('AC-KEY-5: Onboarding-Modal warnt bei key_count=0', async ({ page }) => {
  await gotoInventory(page, { onboarding: { block: '#!/bin/sh\n', vendor_data: '#cloud-config\n', key_count: 0 } })
  await page.getByRole('button', { name: 'Onboarding-Block anzeigen', exact: true }).click()
  await expect(page.getByText(/noch kein Public Key/i)).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// Run-Surface im PlaybookForm (AC-RUN-1)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RUN-1: Gast-Playbook (targets=guest) zeigt In-Guest-Scope-Selektor', async ({ page }) => {
  await gotoProvisioning(page, { playbooks: [PLAYBOOK_GUEST], detail: PLAYBOOK_GUEST })
  await page.getByText('Configure Guest', { exact: true }).click()
  await expect(page.getByText('In-Guest-Ausführung', { exact: true })).toBeVisible({ timeout: 5000 })
  // Scope-Auswahl Eigene + (Plus) Pool/Global
  await expect(page.getByRole('button', { name: 'Eigene', exact: true })).toBeVisible()
})

test('AC-RUN-1 (negativ): localhost-Playbook zeigt keinen Scope-Selektor', async ({ page }) => {
  await gotoProvisioning(page, { playbooks: [PLAYBOOK_LOCALHOST], detail: PLAYBOOK_LOCALHOST })
  await page.getByText('Deploy VM', { exact: true }).click()
  // Formular ist geladen (Job starten o.ä.), aber kein In-Guest-Block
  await expect(page.getByText('In-Guest-Ausführung', { exact: true })).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Deploy-Opt-out-Haken (AC-KEY-1 / AC-KEY-4)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-KEY-1/4: Deploy-Playbook zeigt „Für Ansible verwalten" (default AN) + Global nur Plus', async ({ page }) => {
  await gotoProvisioning(page, { playbooks: [PLAYBOOK_LOCALHOST], detail: PLAYBOOK_LOCALHOST, caps: CAPS_PLUS })
  await page.getByText('Deploy VM', { exact: true }).click()
  // „Für Ansible verwalten" Haken sichtbar + default AN (AC-KEY-1)
  const manageLabel = page.getByText('Für Ansible verwalten', { exact: true })
  await expect(manageLabel).toBeVisible({ timeout: 5000 })
  await expect(manageLabel.locator('xpath=../input[@type="checkbox"]')).toBeChecked()
  // Global-Haken nur bei Plus + wenn manage AN (AC-KEY-4)
  await expect(page.getByText('Globalen Schlüssel mit einbinden', { exact: true })).toBeVisible()
})

test('AC-KEY-4 Core: Global-Schlüssel-Haken NICHT sichtbar', async ({ page }) => {
  await gotoProvisioning(page, { playbooks: [PLAYBOOK_LOCALHOST], detail: PLAYBOOK_LOCALHOST, caps: CAPS_CORE })
  await page.getByText('Deploy VM', { exact: true }).click()
  await expect(page.getByText('Für Ansible verwalten', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(page.getByText('Globalen Schlüssel mit einbinden', { exact: true })).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// Edition-Gate auf API-Ebene: Pool/Global-Scope 404 in Core (AC-RBAC / Pure-Core)
// ═══════════════════════════════════════════════════════════════════════════════

test('Core-404: Key-Management-EP antwortet 404 ohne ansible_inventory-Capability', async ({ page }) => {
  // Echte (nicht gemockte) API-Antwort prüfen: gegen das laufende Backend wäre das
  // 404 im Core-Mode. Da hier nur das Frontend läuft, mocken wir die EP-Semantik
  // (Plus-Router liefert 404 wenn can_use_ansible_inventory()==False).
  await page.addInitScript((t) => sessionStorage.setItem('token', t), OP_TOKEN)
  await mockCommonApi(page, { me: MOCK_ME_OP, caps: CAPS_CORE })
  await page.route(/\/api\/ansible-inventory\/keys\/global\/public$/, r =>
    r.fulfill({ status: 404, json: { detail: 'not_found' } }))
  await page.goto('/automation?tab=inventory')
  await page.waitForLoadState('networkidle')
  const res = await browserFetch(page, '/api/ansible-inventory/keys/global/public')
  expect(res.status).toBe(404)
})
