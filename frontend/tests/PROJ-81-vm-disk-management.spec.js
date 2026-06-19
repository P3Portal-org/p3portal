// p3portal.org
// PROJ-81 — VM-Disk-Verwaltung (MVP, reine Proxmox-Disk-Verwaltung)
// E2E gegen die actionable Disk-Sektion der VM-Detailseite (PROJ-29).
import { test, expect } from '@playwright/test'

// ── JWT-Token-Fixtures (Base64-Payload ohne echte Signatur, useAuth liest role) ──
const H = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'
// {"sub":"operator","auth_type":"local","role":"operator","portal_permissions":[],"exp":9999999999}
const OPERATOR_TOKEN =
  H + '.' +
  'eyJzdWIiOiJvcGVyYXRvciIsImF1dGhfdHlwZSI6ImxvY2FsIiwicm9sZSI6Im9wZXJhdG9yIiwicG9ydGFsX3Blcm1pc3Npb25zIjpbXSwiZXhwIjo5OTk5OTk5OTk5fQ==' +
  '.fake-signature'
// {"sub":"viewer","auth_type":"local","role":"viewer","portal_permissions":[],"exp":9999999999}
const VIEWER_TOKEN =
  H + '.' +
  'eyJzdWIiOiJ2aWV3ZXIiLCJhdXRoX3R5cGUiOiJsb2NhbCIsInJvbGUiOiJ2aWV3ZXIiLCJwb3J0YWxfcGVybWlzc2lvbnMiOltdLCJleHAiOjk5OTk5OTk5OTl9' +
  '.fake-signature'

// ── Mock-Daten ────────────────────────────────────────────────────────────────
const VM_QEMU = {
  vmid: 100, name: 'web-server', type: 'qemu', status: 'running', node: 'pve1',
  ip: '192.168.1.100', uptime: 3661, tags: [], is_template: false,
  cpu_usage: 0.12, cpu_cores: 4, mem_used: 2147483648, mem_total: 8589934592,
  bios: 'seabios', ostype: 'l26', portal_node_id: 1, managed_by_stack: null,
  networks: [{ id: 'net0', model: 'virtio', bridge: 'vmbr0', mac: 'BC:24:11:AA:BB:CC' }],
  disks: [
    { id: 'scsi0', storage: 'local-lvm', size: '32G', serial: null },
    { id: 'scsi1', storage: 'local-lvm', size: '10G', serial: 'p3-abc12345' },
  ],
}
const VM_QEMU_STACK = {
  ...VM_QEMU, name: 'stack-vm',
  managed_by_stack: { stack_id: 7, stack_name: 'web-stack' },
}
const VM_LXC = {
  vmid: 300, name: 'app-ct', type: 'lxc', status: 'running', node: 'pve1',
  ip: '192.168.1.200', uptime: 7200, tags: [], is_template: false,
  cpu_usage: 0.05, cpu_cores: 2, mem_used: 536870912, mem_total: 1073741824,
  bios: '', ostype: 'debian', portal_node_id: 1, managed_by_stack: null,
  networks: [{ id: 'net0', model: 'veth', bridge: 'vmbr0', mac: 'AA:BB:CC:DD:EE:FF' }],
  disks: [{ id: 'rootfs', storage: 'local-lvm', size: '20G', serial: null }],
}

const IMAGE_STORAGES = [
  { name: 'local-lvm', type: 'lvmthin', avail: 50 * 1024 ** 3, total: 100 * 1024 ** 3, used: 50 * 1024 ** 3 },
  { name: 'ceph-pool', type: 'rbd', avail: 500 * 1024 ** 3, total: 1024 * 1024 ** 3, used: 0 },
]

// ── Helfer ────────────────────────────────────────────────────────────────────
async function setToken(page, token) {
  await page.addInitScript((t) => sessionStorage.setItem('token', t), token)
}

async function mockBaseApi(page, role) {
  await page.route('**/api/me', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      username: role, auth_type: 'local', role,
      must_change_pw: false, last_login_at: null, last_login_ip: null,
    }) }))
  await page.route('**/api/license/status', r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ edition: 'plus', valid: true }) }))
  await page.route('**/api/themes', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/announcements', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  // Owner-Sektion + Guest-Info + Snapshots + Backups (unkritisch hier)
  await page.route('**/api/owners/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route(/\/api\/(cluster\/vms\/[^/]+\/[^/]+\/\d+|vms\/\d+)\/guest-info/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) }))
  await page.route(/\/api\/vms\/\d+\/snapshots$/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route(/\/api\/cluster\/vms\/[^/]+\/[^/]+\/\d+\/backups/, r =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ backups: [], schedules: [], storages: [] }) }))
}

function mockVmDetail(page, detail) {
  return page.route(
    new RegExp(`/api/cluster/vms/${detail.node}/${detail.type}/${detail.vmid}$`),
    r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }),
  )
}

async function goDetail(page, detail) {
  await page.goto(`/vm/${detail.node}/${detail.type}/${detail.vmid}`)
}

// Bearbeitungsmodus betreten: der einzige "Bearbeiten"-Button (Konfigurations-
// Kopfzeile) schaltet die ganze Karte editierbar → CPU/RAM-Trigger + Disk-Aktionen.
async function enterDiskEdit(page) {
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Fertig' })).toBeVisible()
}

// ══════════════════════════════════════════════════════════════════════════════
// AC-UI-1 / AC-RBAC-2 — Edit-Gate + Sichtbarkeit der Disk-Aktionen je Rolle/Typ
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-81 – Edit-Gate & Sichtbarkeit', () => {

  test('AC-UI-1: Aktionen erst nach Klick auf "Bearbeiten" sichtbar', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)
    await goDetail(page, VM_QEMU)

    await expect(page.getByText('Festplatten (2)')).toBeVisible()
    // Vor dem Bearbeiten-Klick: keine Disk-Aktionen
    await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Vergrößern' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Entfernen' })).toHaveCount(0)

    await enterDiskEdit(page)

    await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Vergrößern' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Entfernen' }).first()).toBeVisible()
  })

  test('"Fertig" beendet den Bearbeitungsmodus wieder', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)
    await goDetail(page, VM_QEMU)

    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Fertig' }).click()
    await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Entfernen' })).toHaveCount(0)
  })

  test('AC-RBAC-2: Viewer hat weder Bearbeiten noch Aktionen', async ({ page }) => {
    await setToken(page, VIEWER_TOKEN)
    await mockBaseApi(page, 'viewer')
    await mockVmDetail(page, VM_QEMU)
    await goDetail(page, VM_QEMU)

    await expect(page.getByText('Festplatten (2)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Entfernen' })).toHaveCount(0)
  })

  test('EC-9: LXC zeigt keine Disk-Bearbeitung (QEMU-only)', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_LXC)
    await goDetail(page, VM_LXC)

    await expect(page.getByText('Festplatten (1)')).toBeVisible()
    // Nur die Konfig-Kopfzeile hat "Bearbeiten" (1×), die Festplatten-Sektion nicht
    await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Entfernen' })).toHaveCount(0)
  })

  test('AC-STACK-BLOCK-1 (UI): Stack-VM zeigt "Stack-verwaltet" statt Aktionen', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU_STACK)
    await goDetail(page, VM_QEMU_STACK)

    await expect(page.getByText('Festplatten (2)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true })).toHaveCount(0)
    await expect(page.getByText('Stack-verwaltet').first()).toBeVisible()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-ATTACH — Festplatte hinzufügen (zweistufige Bestätigung)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-81 – Festplatte hinzufügen', () => {

  test('AC-ATTACH-1/5: Datastore-Dropdown + zweistufiger Attach (Hinzufügen → Bestätigen)', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)
    await page.route(/\/api\/nodes\/pve1\/image-storages/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IMAGE_STORAGES) }))

    let attachBody = null
    await page.route(/\/api\/vms\/100\/disks(\?|$)/, (r) => {
      attachBody = r.request().postDataJSON()
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ disks: VM_QEMU.disks, disk: 'scsi2' }) })
    })

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click()

    await expect(page.getByRole('heading', { name: 'Festplatte hinzufügen' })).toBeVisible()
    const storageSelect = page.locator('#disk-storage')
    await expect(storageSelect.locator('option')).toHaveCount(2)
    await expect(storageSelect).toContainText(/local-lvm \(.*frei/)

    await page.locator('#disk-size').fill('64')
    await page.locator('#disk-storage').selectOption('ceph-pool')
    await page.locator('#disk-bus').selectOption('virtio')

    // 1. Bestätigung: scharfschalten, noch KEIN POST
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).nth(1).click()
    await expect(page.getByRole('button', { name: 'Bestätigen' })).toBeVisible()
    expect(attachBody).toBeNull()

    // 2. Bestätigung: ausführen
    await page.getByRole('button', { name: 'Bestätigen' }).click()
    await expect.poll(() => attachBody).not.toBeNull()
    expect(attachBody).toEqual({ size_gb: 64, storage: 'ceph-pool', bus: 'virtio' })
    await expect(page.getByRole('heading', { name: 'Festplatte hinzufügen' })).toHaveCount(0)
  })

  test('Feldänderung nach Scharfschalten hebt die Bestätigung auf', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)
    await page.route(/\/api\/nodes\/pve1\/image-storages/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IMAGE_STORAGES) }))
    let attachBody = null
    await page.route(/\/api\/vms\/100\/disks(\?|$)/, (r) => {
      attachBody = r.request().postDataJSON()
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disks: [], disk: 'scsi2' }) })
    })

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Festplatte hinzufügen' })).toBeVisible()

    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).nth(1).click()
    await expect(page.getByRole('button', { name: 'Bestätigen' })).toBeVisible()
    await page.locator('#disk-size').fill('128')          // Eingabe ändern → Bestätigung weg
    await expect(page.getByRole('button', { name: 'Bestätigen' })).toHaveCount(0)
    expect(attachBody).toBeNull()
  })

  test('AC-ATTACH-5: keine Image-Datastores → Warnung + Hinzufügen deaktiviert', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)
    await page.route(/\/api\/nodes\/pve1\/image-storages/, r =>
      r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Hinzufügen', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Festplatte hinzufügen' })).toBeVisible()

    await expect(page.getByText('Keine Datastores mit Image-Inhalt gefunden.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Hinzufügen', exact: true }).nth(1)).toBeDisabled()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-RESIZE — Vergrößern (EC-2 Verkleinern-Ablehnung + zweistufige Bestätigung)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-81 – Vergrößern', () => {

  test('EC-2: Verkleinern wird clientseitig abgelehnt (kein API-Call, keine Bestätigung)', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)

    let resizeCalled = false
    await page.route(/\/api\/vms\/100\/disks\/scsi1\/resize/, (r) => {
      resizeCalled = true
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ disks: VM_QEMU.disks, disk: 'scsi1' }) })
    })

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    // zweite Disk (scsi1, 10G) vergrößern
    await page.getByRole('button', { name: 'Vergrößern' }).nth(1).click()
    await expect(page.getByRole('heading', { name: /scsi1.*vergrößern/i })).toBeVisible()

    await page.locator('#resize-size').fill('5') // kleiner als 10G
    await page.getByRole('button', { name: 'Vergrößern' }).last().click()

    await expect(page.getByText(/Verkleinern ist nicht möglich/i)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Bestätigen' })).toHaveCount(0)
    expect(resizeCalled).toBe(false)
  })

  test('AC-RESIZE-1/2: zweistufige Vergrößerung sendet PUT', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)

    let resizeBody = null
    await page.route(/\/api\/vms\/100\/disks\/scsi1\/resize/, (r) => {
      resizeBody = r.request().postDataJSON()
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ disks: VM_QEMU.disks, disk: 'scsi1' }) })
    })

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Vergrößern' }).nth(1).click()
    await page.locator('#resize-size').fill('40')

    // 1. Bestätigung
    await page.getByRole('button', { name: 'Vergrößern' }).last().click()
    await expect(page.getByRole('button', { name: 'Bestätigen' })).toBeVisible()
    expect(resizeBody).toBeNull()

    // 2. Bestätigung
    await page.getByRole('button', { name: 'Bestätigen' }).click()
    await expect.poll(() => resizeBody).not.toBeNull()
    expect(resizeBody).toEqual({ size_gb: 40 })
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// AC-REMOVE — Entfernen (Namens-Bestätigungstoken = zweite Bestätigung)
// ══════════════════════════════════════════════════════════════════════════════
test.describe('PROJ-81 – Entfernen', () => {

  test('AC-REMOVE-1: "Endgültig entfernen" erst aktiv nach VM-Namen, DELETE mit confirm', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)

    let deleteUrl = null
    await page.route(/\/api\/vms\/100\/disks\/scsi1\?/, (r) => {
      deleteUrl = r.request().url()
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ disks: [VM_QEMU.disks[0]], disk: 'scsi1' }) })
    })

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Entfernen' }).nth(1).click()
    await expect(page.getByRole('heading', { name: /scsi1.*entfernen/i })).toBeVisible()

    const confirmBtn = page.getByRole('button', { name: 'Endgültig entfernen' })
    await expect(confirmBtn).toBeDisabled()

    await page.locator('#remove-confirm').fill('web-server')
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()

    await expect.poll(() => deleteUrl).not.toBeNull()
    expect(deleteUrl).toContain('confirm=web-server')
  })

  test('AC-REMOVE-1: falscher Name hält den Button deaktiviert', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Entfernen' }).nth(1).click()
    await page.locator('#remove-confirm').fill('falscher-name')
    await expect(page.getByRole('button', { name: 'Endgültig entfernen' })).toBeDisabled()
  })

  test('AC-REMOVE-1: Modal zeigt deutliche Datenverlust-Warnung', async ({ page }) => {
    await setToken(page, OPERATOR_TOKEN)
    await mockBaseApi(page, 'operator')
    await mockVmDetail(page, VM_QEMU)

    await goDetail(page, VM_QEMU)
    await enterDiskEdit(page)
    await page.getByRole('button', { name: 'Entfernen' }).nth(1).click()
    await expect(page.getByText(/unwiderruflicher Datenverlust/i)).toBeVisible()
    await expect(page.getByText(/endgültig vom Storage gelöscht/i)).toBeVisible()
  })
})
