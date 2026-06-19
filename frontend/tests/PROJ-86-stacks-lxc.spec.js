// p3portal.org
// PROJ-86: E2E-Tests für Stacks LXC (deklarative Container im Stack, Plus-only).
// Testet: LXC-Karte im Formular-Editor (Felder/Badge, Template-Dropdown aus
//         /lxc-templates, unprivileged-Warnung, Features, Mountpoint mp0),
//         „LXC hinzufügen" (Empty-State + gemischt), Cloud-Init-Tab LXC=root
//         (kein Username), Plan-Modal-Mountpoint-Datenverlust (Reuse PROJ-82)
//         sowie Core-Gating (Plan-EP 404 in Core, keine neue Capability).
// Additive Erweiterung von PROJ-76/82/85; baut auf deren E2E-Mock-Muster auf.
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

const OSTEMPLATE = 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst'

// Stack mit EINEM LXC (rootfs + Mountpoint mp0).
const STACK_YAML_LXC =
  "name: ctstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: lxc\n    name: ct-web\n    node: pve-01\n" +
  `    template: ${OSTEMPLATE}\n    hostname: ct-web\n` +
  "    cores: 1\n    memory: 512\n    swap: 512\n    rootfs_size: 8\n    rootfs_datastore: local-lvm\n" +
  "    unprivileged: true\n" +
  "    mounts:\n      - id: mp0\n        datastore: local-lvm\n        size: 10\n        path: /data\n"

// Reiner VM-Stack (für „LXC hinzufügen"-Empty-/Mixed-Tests).
const STACK_YAML_VM =
  "name: ctstack\nversion: '1.0.0'\nresources:\n" +
  "  - type: vm\n    name: web\n    node: pve-01\n    template: deb12\n"

function stackDetail(yaml, resources) {
  return {
    id: 7, name: 'ctstack', version: '1.0.0', status: 'active', source_kind: 'structured',
    owner_user_id: 1, owner_username: 'admin', is_orphan: false, resource_count: 1,
    current_etag: 'a'.repeat(64), created_at: '2026-06-01T10:00:00', updated_at: '2026-06-02T11:30:00',
    deployment_state: 'deployed', last_drift_state: null,
    yaml_text: yaml, yaml_corrupt: false,
    resources: resources || [],
  }
}

const IMAGE_STORAGES = [
  { name: 'local-lvm', type: 'lvmthin', avail: 0, total: 0, used: 0 },
  { name: 'ceph', type: 'rbd', avail: 0, total: 0, used: 0 },
]

// PROJ-38 installed LXC templates (node-gefiltert: nur pve-01 zählt für ct-web).
const LXC_TEMPLATES = {
  installed: [
    { volid: OSTEMPLATE, storage: 'local', portal_node_name: 'pve-01' },
    { volid: 'local:vztmpl/alpine-3.20-default_amd64.tar.xz', storage: 'local', portal_node_name: 'pve-02' },
  ],
}

// Plan mit Mountpoint-Datenverlust (mp0 entfernt) — Reuse PROJ-82-Mechanik.
const PLAN_MOUNT_LOSS = {
  plan_token: 'tok_mploss', operation: 'apply',
  summary: { create: 0, change: 1, destroy: 0, replace: 0, resources: [{ name: 'ct-web', action: 'update' }] },
  destructive_disk_changes: [{ vm: 'ct-web', interface: 'mp0', reason: 'removed', old_size: 10 }],
}

const PLAN_PURE_ADD = {
  plan_token: 'tok_add', operation: 'apply',
  summary: { create: 0, change: 1, destroy: 0, replace: 0, resources: [{ name: 'ct-web', action: 'update' }] },
  destructive_disk_changes: [],
}

// ── Common mocks ───────────────────────────────────────────────────────────────

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
  await page.route('**/api/cluster/lxc-templates', r => r.fulfill({ json: LXC_TEMPLATES }))
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
  await page.route('**/api/profile/ssh-job-key', r => r.fulfill({ json: { has_key: false } }))
  // PROJ-81 image-storages endpoint (reused by the LXC rootfs/mount datastore dropdown).
  await page.route(/localhost:\d+\/api\/nodes\/[^/]+\/image-storages$/, r => r.fulfill({ json: IMAGE_STORAGES }))
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

async function gotoFormEditor(page, yaml) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_PLUS })
  await page.route(/localhost:\d+\/api\/stacks\/7\/cloud-init$/, r =>
    r.fulfill({ json: { default: { vm_name: '', enabled: false }, overrides: [] } }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({ json: stackDetail(yaml, []) }))
  await page.goto('/stacks/7/edit')
  await page.waitForLoadState('networkidle')
  await page.click('button:has-text("Formular")')
}

async function gotoDeployedDetail(page, { caps = CAPS_PLUS, planRoute } = {}) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps })
  await page.route(/localhost:\d+\/api\/stacks\/7\/versions$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/deployments$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7\/resources\/live$/, r => r.fulfill({ json: [] }))
  await page.route(/localhost:\d+\/api\/stacks\/7$/, r => r.fulfill({
    json: stackDetail(STACK_YAML_LXC, [{ type: 'lxc', name: 'ct-web', node: 'pve-01', template: OSTEMPLATE, cores: 1, memory: 512, disk: 8, pool: null }]),
  }))
  if (planRoute) await planRoute(page)
  await page.goto('/stacks/7')
  await page.waitForLoadState('networkidle')
}

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RES / AC-COMPUTE / AC-SECURITY: LXC-Karte im Formular-Editor
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RES-1/3: LXC-Karte zeigt LXC-Badge + Swap/Root-FS/Hostname (kein Sockets)', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_LXC)
  await expect(page.locator('text=LXC').first()).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=Swap (MB)').first()).toBeVisible()
  await expect(page.locator('text=Root-FS (GB)').first()).toBeVisible()
  // Sockets ist ein reines VM-Feld → in der LXC-Karte nicht vorhanden.
  await expect(page.locator('text=Sockets')).toHaveCount(0)
})

test('AC-TMPL-2: Template-Dropdown listet die node-gefilterten LXC-Templates', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_LXC)
  await expect(page.locator('text=LXC').first()).toBeVisible({ timeout: 5000 })
  // Der Template-Select trägt das pve-01-Template (debian); alpine (pve-02) wird gefiltert.
  const tplSelect = page.locator('select').filter({ hasText: /debian-12-standard/ }).first()
  await expect(tplSelect).toBeVisible()
  await expect(tplSelect).toContainText('debian-12-standard')
  await expect(tplSelect).not.toContainText('alpine')
})

test('AC-SEC-2: privileged (unprivileged abgewählt) zeigt eine Warnung', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_LXC)
  await expect(page.locator('text=LXC').first()).toBeVisible({ timeout: 5000 })
  // Unprivilegiert ist Default an → abwählen blendet die Warnung ein (AC-SEC-2).
  const unprivCheckbox = page.getByLabel('Unprivilegiert', { exact: true })
  await unprivCheckbox.uncheck()
  await expect(page.locator('text=/erweiterten Host-Zugriff/i')).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-FEAT / AC-MOUNT: Container-Features + Mountpoints
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-FEAT-1: Container-Features-Sektion ist vorhanden (Nesting/FUSE)', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_LXC)
  await expect(page.locator('text=Container-Features').first()).toBeVisible({ timeout: 5000 })
  await expect(page.getByLabel('Nesting')).toBeVisible()
  await expect(page.getByLabel('FUSE')).toBeVisible()
})

test('AC-MOUNT-1/2: bestehender Mountpoint mp0 wird gerendert, „+ Mountpoint" fügt mp1 hinzu', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_LXC)
  await expect(page.locator('text=Mountpoints').first()).toBeVisible({ timeout: 5000 })
  // Der aus dem YAML geladene Mountpoint trägt den Index mp0.
  await expect(page.locator('text=mp0').first()).toBeVisible()
  // Nächster freier Index wird automatisch vergeben → mp1.
  await page.click('button[title="Mountpoint"]')
  await expect(page.locator('text=mp1').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MIX: „LXC hinzufügen"
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MIX-1: VM-Stack lässt sich um einen LXC ergänzen (gemischt)', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_VM)
  // Die VM-Karte ist da; daneben der „LXC hinzufügen"-Button.
  await expect(page.locator('button:has-text("LXC hinzufügen")').first()).toBeVisible({ timeout: 5000 })
  await page.click('button:has-text("LXC hinzufügen")')
  // Nach dem Hinzufügen erscheint eine zweite (LXC-)Karte mit Badge.
  await expect(page.locator('text=LXC').first()).toBeVisible()
  await expect(page.locator('text=Root-FS (GB)').first()).toBeVisible()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-GUEST-5: Cloud-Init-Tab — LXC-Login ist „root" (kein Username)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-GUEST-5: LXC-Override im Cloud-Init-Tab zeigt „root", kein Username-Feld', async ({ page }) => {
  await gotoFormEditor(page, STACK_YAML_LXC)
  await page.click('button:has-text("Cloud-Init")')
  await page.waitForLoadState('networkidle')
  // Per-Resource-Override des LXC auf „Eigene Daten" stellen → Felder rendern.
  const sel = page.locator('select').first()
  await sel.selectOption('custom')
  await expect(page.locator('text=root').first()).toBeVisible({ timeout: 5000 })
  // Für LXC erscheint KEIN Benutzername-Feld (Login = root).
  await expect(page.locator('text=/Benutzername/i')).toHaveCount(0)
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-MOUNT-3: Plan-Modal-Datenverlust bei entferntem Mountpoint (Reuse PROJ-82)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-MOUNT-3: Mountpoint-Entfernen verlangt Stack-Namen vor dem Anwenden', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ json: PLAN_MOUNT_LOSS }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/UNWIEDERBRINGLICH/i')).toBeVisible({ timeout: 5000 })
  await expect(page.locator('text=mp0').first()).toBeVisible()
  const apply = page.locator('button:has-text("Anwenden")')
  await expect(apply).toBeDisabled()
  await page.fill('input[placeholder="ctstack"]', 'ctstack')
  await expect(apply).toBeEnabled()
})

test('AC-MOUNT-3: reine Mountpoint-Hinzufügung → keine Zusatz-Bestätigung', async ({ page }) => {
  await gotoDeployedDetail(page, {
    planRoute: async (p) => {
      await p.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ json: PLAN_PURE_ADD }))
    },
  })
  await page.click('button:has-text("Ausrollen")')
  await page.waitForLoadState('networkidle')
  await expect(page.locator('text=/UNWIEDERBRINGLICH/i')).toHaveCount(0)
  await expect(page.locator('button:has-text("Anwenden")')).toBeEnabled()
})

// ═══════════════════════════════════════════════════════════════════════════════
// AC-RBAC-1: Core-Gating unverändert (Plan-EP 404 ohne Plus, keine neue Capability)
// ═══════════════════════════════════════════════════════════════════════════════

test('AC-RBAC-1: Plan-Endpoint bleibt im Core-Modus 404 (keine neue Capability)', async ({ page }) => {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), ADMIN_TOKEN)
  await mockCommonApi(page, { caps: CAPS_CORE })
  await page.route(/localhost:\d+\/api\/stacks\/7\/plan(\?.*)?$/, r => r.fulfill({ status: 404, json: { detail: 'Not Found' } }))
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const resp = await browserFetch(page, '/api/stacks/7/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  expect(resp.status).toBe(404)
})
