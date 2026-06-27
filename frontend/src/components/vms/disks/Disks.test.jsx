// p3portal.org
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import i18n from '../../../i18n'
import AddDiskModal from './AddDiskModal'
import ResizeDiskModal from './ResizeDiskModal'
import RemoveDiskModal from './RemoveDiskModal'
import VmConfigSection from '../VmConfigSection'
import { sizeToGib, formatBytes } from './diskHelpers'

// Wrap renders in the real i18n provider so t() resolves the German (default)
// values – the assertions below check the rendered German UI strings.
const render = (ui) => rtlRender(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)

vi.mock('../../../api/vms', () => ({
  listImageStorages: vi.fn(),
  attachDisk: vi.fn(),
  resizeDisk: vi.fn(),
  removeDisk: vi.fn(),
}))

import { listImageStorages, attachDisk, resizeDisk, removeDisk } from '../../../api/vms'

beforeEach(() => {
  vi.clearAllMocks()
})

// ── helpers ───────────────────────────────────────────────────────────────────

describe('diskHelpers.sizeToGib', () => {
  it('parses G/M/T/K and plain bytes', () => {
    expect(sizeToGib('32G')).toBe(32)
    expect(sizeToGib('1T')).toBe(1024)
    expect(sizeToGib('512M')).toBe(1)       // 0.5 GiB rounds to 1 → actually 0.5 → round = 1? check below
    expect(sizeToGib('1024')).toBe(0)       // plain bytes ~0 GiB
    expect(sizeToGib(null)).toBe(0)
    expect(sizeToGib('')).toBe(0)
  })
})

describe('diskHelpers.formatBytes', () => {
  it('formats and handles zero', () => {
    expect(formatBytes(0)).toBe('–')
    expect(formatBytes(1024 ** 3)).toBe('1.0 GiB')
    expect(formatBytes(1024 ** 3 * 100)).toBe('100 GiB')
  })
})

// ── AddDiskModal ────────────────────────────────────────────────────────────

describe('AddDiskModal', () => {
  it('verlangt zwei Bestätigungen: Hinzufügen → Bestätigen', async () => {
    listImageStorages.mockResolvedValue([
      { name: 'local-lvm', type: 'lvmthin', avail: 1024 ** 3 * 100, total: 1024 ** 3 * 200, used: 0 },
    ])
    attachDisk.mockResolvedValue({ disks: [], disk: 'scsi1' })
    const onSaved = vi.fn()
    const onClose = vi.fn()
    render(<AddDiskModal vmid={101} node="pve1" vmName="web-1" onClose={onClose} onSaved={onSaved} />)

    await waitFor(() => expect(listImageStorages).toHaveBeenCalledWith('pve1'))
    await screen.findByRole('option', { name: /local-lvm/ })

    // 1. Klick: nur scharfschalten, KEIN API-Call.
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))
    expect(attachDisk).not.toHaveBeenCalled()
    await screen.findByRole('button', { name: 'Bestätigen' })

    // 2. Klick: ausführen.
    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }))
    await waitFor(() => expect(attachDisk).toHaveBeenCalledWith(
      101, { size_gb: 32, storage: 'local-lvm', bus: 'scsi' }, 'pve1',
    ))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onClose).toHaveBeenCalled()
  })

  it('Feldänderung hebt die erste Bestätigung wieder auf', async () => {
    listImageStorages.mockResolvedValue([
      { name: 'local-lvm', type: 'lvmthin', avail: 1024 ** 3 * 100, total: 1024 ** 3 * 200, used: 0 },
    ])
    render(<AddDiskModal vmid={101} node="pve1" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByRole('option', { name: /local-lvm/ })

    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }))
    await screen.findByRole('button', { name: 'Bestätigen' })
    fireEvent.change(screen.getByLabelText('Größe (GB)'), { target: { value: '64' } })
    // wieder zurück auf "Hinzufügen", kein API-Call
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).not.toBeInTheDocument()
    expect(attachDisk).not.toHaveBeenCalled()
  })

  it('zeigt Hinweis wenn keine Datastores vorhanden + Button disabled', async () => {
    listImageStorages.mockResolvedValue([])
    render(<AddDiskModal vmid={101} node="pve1" onClose={() => {}} onSaved={() => {}} />)
    await screen.findByText(/Keine Datastores/)
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled()
  })
})

// ── ResizeDiskModal ─────────────────────────────────────────────────────────

describe('ResizeDiskModal', () => {
  it('lehnt Verkleinern ab (kein API-Call, keine Bestätigung)', async () => {
    render(<ResizeDiskModal vmid={101} node="pve1" disk="scsi1" currentSizeGb={32} onClose={() => {}} onSaved={() => {}} />)
    fireEvent.change(screen.getByLabelText('Neue Größe (GB)'), { target: { value: '16' } })
    fireEvent.click(screen.getByRole('button', { name: 'Vergrößern' }))
    await screen.findByText(/Verkleinern ist nicht möglich/)
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).not.toBeInTheDocument()
    expect(resizeDisk).not.toHaveBeenCalled()
  })

  it('verlangt zwei Bestätigungen: Vergrößern → Bestätigen', async () => {
    resizeDisk.mockResolvedValue({ disks: [], disk: 'scsi1' })
    const onSaved = vi.fn()
    render(<ResizeDiskModal vmid={101} node="pve1" disk="scsi1" currentSizeGb={32} onClose={() => {}} onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText('Neue Größe (GB)'), { target: { value: '64' } })

    fireEvent.click(screen.getByRole('button', { name: 'Vergrößern' }))
    expect(resizeDisk).not.toHaveBeenCalled()
    await screen.findByRole('button', { name: 'Bestätigen' })

    fireEvent.click(screen.getByRole('button', { name: 'Bestätigen' }))
    await waitFor(() => expect(resizeDisk).toHaveBeenCalledWith(101, 'scsi1', 64, 'pve1'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})

// ── RemoveDiskModal ─────────────────────────────────────────────────────────

describe('RemoveDiskModal', () => {
  it('Entfernen-Button erst aktiv wenn Name korrekt eingetippt', async () => {
    removeDisk.mockResolvedValue({ disks: [], disk: 'scsi1' })
    const onSaved = vi.fn()
    render(<RemoveDiskModal vmid={101} node="pve1" disk="scsi1" confirmToken="web-1" vmName="web-1" onClose={() => {}} onSaved={onSaved} />)

    const btn = screen.getByRole('button', { name: 'Endgültig entfernen' })
    expect(btn).toBeDisabled()
    expect(removeDisk).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(/VM-Namen eingeben/), { target: { value: 'web-1' } })
    expect(btn).not.toBeDisabled()

    fireEvent.click(btn)
    await waitFor(() => expect(removeDisk).toHaveBeenCalledWith(101, 'scsi1', 'web-1', 'pve1'))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
})

// ── VmConfigSection disk actions gating ──────────────────────────────────────

const makeDetail = (overrides = {}) => ({
  type: 'qemu',
  vmid: 101,
  node: 'pve1',
  name: 'web-1',
  is_template: false,
  cpu_cores: 2,
  ostype: 'l26',
  bios: 'seabios',
  networks: [],
  disks: [{ id: 'scsi0', storage: 'local-lvm', size: '32G' }, { id: 'scsi1', storage: 'local-lvm', size: '10G' }],
  ...overrides,
})

// Es gibt nur EINEN "Bearbeiten"-Button (Konfigurations-Kopfzeile). Er schaltet
// die ganze Karte in den Bearbeitungsmodus → dann erscheinen CPU/RAM-Trigger + Disk-Aktionen.
const editButton = () => screen.getByRole('button', { name: 'Bearbeiten' })

describe('VmConfigSection disk actions', () => {
  it('genau ein "Bearbeiten"; Aktionen erst nach Klick sichtbar (QEMU + canEdit)', () => {
    render(<VmConfigSection detail={makeDetail()} canEdit />)
    // Vor dem Edit-Modus: genau ein "Bearbeiten", keine Aktions-Buttons
    expect(screen.getAllByRole('button', { name: 'Bearbeiten' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Hinzufügen/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Vergrößern' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument()

    fireEvent.click(editButton())

    // Edit-Modus: CPU/RAM-Trigger + Fertig + Disk-Aktionen; "Bearbeiten" weg
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /CPU, RAM/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fertig' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hinzufügen/ })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Vergrößern' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Entfernen' })).toHaveLength(2)
  })

  it('"Fertig" beendet den Bearbeitungsmodus wieder', () => {
    render(<VmConfigSection detail={makeDetail()} canEdit />)
    fireEvent.click(editButton())
    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hinzufügen/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument()
  })

  it('versteckt Bearbeiten ohne canEdit (Viewer)', () => {
    render(<VmConfigSection detail={makeDetail()} canEdit={false} />)
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hinzufügen/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument()
  })

  it('LXC: Bearbeiten vorhanden, aber im Edit-Modus keine Disk-Aktionen (Non-Goal)', () => {
    render(<VmConfigSection detail={makeDetail({ type: 'lxc' })} canEdit />)
    expect(screen.getAllByRole('button', { name: 'Bearbeiten' })).toHaveLength(1)
    fireEvent.click(editButton())
    expect(screen.getByRole('button', { name: /CPU, RAM/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hinzufügen/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Entfernen' })).not.toBeInTheDocument()
  })

  it('versteckt Bearbeiten bei Stack-verwalteter VM', () => {
    render(<VmConfigSection detail={makeDetail()} canEdit managedByStack={{ stack_id: 1, stack_name: 's' }} />)
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hinzufügen/ })).not.toBeInTheDocument()
  })

  it('öffnet AddDiskModal nach Bearbeiten → Hinzufügen', async () => {
    listImageStorages.mockResolvedValue([])
    render(<VmConfigSection detail={makeDetail()} canEdit />)
    fireEvent.click(editButton())
    fireEvent.click(screen.getByRole('button', { name: /Hinzufügen/ }))
    expect(await screen.findByText('Festplatte hinzufügen')).toBeInTheDocument()
  })
})
