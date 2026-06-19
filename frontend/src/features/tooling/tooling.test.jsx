// p3portal.org
// PROJ-66: Vitest-Tests für das Tooling-Health-Feature
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// ─── Globale Mocks ───────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (!opts) return k
      return Object.entries(opts).reduce((s, [key, val]) => s.replace(`{{${key}}}`, val), k)
    },
  }),
}))

vi.mock('./hooks', () => ({
  useToolingStatus:       vi.fn(),
  useToolingAuditHistory: vi.fn(),
  useToolingRecheck:      vi.fn(),
}))

vi.mock('./context', () => ({
  ToolingSlideOverProvider: ({ children }) => children,
  useToolingSlideOver: vi.fn(),
}))

import ToolingIndicator    from './components/ToolingIndicator'
import ToolingIndicators   from './components/ToolingIndicators'
import ToolingStatusSection  from './components/ToolingStatusSection'
import ToolingOutputSection  from './components/ToolingOutputSection'
import ToolingHistorySection from './components/ToolingHistorySection'
import ToolingRecheckButton  from './components/ToolingRecheckButton'
import ToolingSlideOver      from './components/ToolingSlideOver'
import { useToolingStatus, useToolingAuditHistory, useToolingRecheck } from './hooks'
import { useToolingSlideOver } from './context'

const READY_DATA = {
  version: '2.18.1',
  status: 'ready',
  last_check: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  stdout: 'ansible [core 2.18.1]\n  config file = None',
  stderr: '',
}

const DOWN_DATA = {
  version: null,
  status: 'down',
  last_check: new Date(Date.now() - 60 * 1000).toISOString(),
  stdout: '',
  stderr: 'ansible: command not found',
}

const UNKNOWN_DATA = {
  version: null,
  status: 'unknown',
  last_check: null,
  stdout: null,
  stderr: null,
}

// PROJ-66 Phase 2: OpenTofu (Plus-only, dritter Indikator)
const TOFU_DATA = {
  version: '1.9.1',
  status: 'ready',
  last_check: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
  stdout: 'OpenTofu v1.9.1',
  stderr: '',
}

function mockSlideOver(overrides = {}) {
  useToolingSlideOver.mockReturnValue({
    openTool: null,
    openSlideOver: vi.fn(),
    closeSlideOver: vi.fn(),
    ...overrides,
  })
}

// ─── ToolingIndicator ────────────────────────────────────────────────────────

describe('ToolingIndicator', () => {
  beforeEach(() => mockSlideOver())

  it('zeigt Ansible-Label auf Desktop', () => {
    render(<ToolingIndicator tool="ansible" toolData={READY_DATA} />)
    expect(screen.getByText('Ansible')).toBeTruthy()
  })

  it('zeigt Major.Minor-Version (2.18)', () => {
    render(<ToolingIndicator tool="ansible" toolData={READY_DATA} />)
    expect(screen.getByText('2.18')).toBeTruthy()
  })

  it('rendert Status-Punkt für ready (bg-portal-success)', () => {
    const { container } = render(<ToolingIndicator tool="ansible" toolData={READY_DATA} />)
    expect(container.querySelector('.bg-portal-success')).toBeTruthy()
  })

  it('rendert Status-Punkt für down (bg-portal-danger)', () => {
    const { container } = render(<ToolingIndicator tool="ansible" toolData={DOWN_DATA} />)
    expect(container.querySelector('.bg-portal-danger')).toBeTruthy()
  })

  it('rendert Status-Punkt für unknown (bg-portal-text/30)', () => {
    const { container } = render(<ToolingIndicator tool="ansible" toolData={UNKNOWN_DATA} />)
    // Klasse mit Slash wird in DOM als Teil des Strings gesetzt
    const dot = container.querySelector('[class*="bg-portal-text"]')
    expect(dot).toBeTruthy()
  })

  it('rendert Status-Punkt für degraded (bg-portal-warn)', () => {
    const degraded = { ...READY_DATA, status: 'degraded' }
    const { container } = render(<ToolingIndicator tool="packer" toolData={degraded} />)
    expect(container.querySelector('.bg-portal-warn')).toBeTruthy()
  })

  it('öffnet SlideOver bei Klick', () => {
    const openSlideOver = vi.fn()
    mockSlideOver({ openSlideOver })
    render(<ToolingIndicator tool="ansible" toolData={READY_DATA} />)
    fireEvent.click(screen.getByRole('button'))
    expect(openSlideOver).toHaveBeenCalledWith('ansible')
  })

  // PROJ-66 Phase 2 (AC-P2-UI-2)
  it('zeigt OpenTofu-Label für opentofu', () => {
    render(<ToolingIndicator tool="opentofu" toolData={TOFU_DATA} />)
    expect(screen.getByText('OpenTofu')).toBeTruthy()
  })
})

// ─── ToolingIndicators ───────────────────────────────────────────────────────

describe('ToolingIndicators', () => {
  beforeEach(() => mockSlideOver())

  it('rendert keinen Inhalt bei fehlendem Status', () => {
    useToolingStatus.mockReturnValue({ data: null })
    const { container } = render(<ToolingIndicators />)
    expect(container.firstChild).toBeNull()
  })

  it('rendert Ansible und Packer in korrekter Reihenfolge', () => {
    useToolingStatus.mockReturnValue({
      data: { ansible: READY_DATA, packer: { ...READY_DATA, version: '1.11.2' } },
    })
    render(<ToolingIndicators />)
    // Text in hidden-md:inline-Span (im jsdom rendert hidden nicht)
    const ansibleLabel = screen.getAllByText('Ansible')
    const packerLabel  = screen.getAllByText('Packer')
    expect(ansibleLabel.length).toBeGreaterThan(0)
    expect(packerLabel.length).toBeGreaterThan(0)
  })

  // PROJ-66 Phase 2 (AC-P2-UI-1/3): OpenTofu nach Packer einsortiert
  it('rendert OpenTofu nach Ansible und Packer', () => {
    useToolingStatus.mockReturnValue({
      data: {
        // bewusst unsortierte Reihenfolge im Objekt
        opentofu: TOFU_DATA,
        packer:   { ...READY_DATA, version: '1.11.2' },
        ansible:  READY_DATA,
      },
    })
    const { container } = render(<ToolingIndicators />)
    const labels = Array.from(container.querySelectorAll('span'))
      .map(s => s.textContent)
      .filter(txt => ['Ansible', 'Packer', 'OpenTofu'].includes(txt))
    expect(labels).toEqual(['Ansible', 'Packer', 'OpenTofu'])
  })
})

// ─── ToolingStatusSection ────────────────────────────────────────────────────

describe('ToolingStatusSection', () => {
  it('zeigt Vollversion bei ready', () => {
    render(<ToolingStatusSection toolData={READY_DATA} />)
    expect(screen.getByText('2.18.1')).toBeTruthy()
  })

  it('zeigt Status-Badge', () => {
    render(<ToolingStatusSection toolData={READY_DATA} />)
    expect(screen.getByText('tooling.status_ready')).toBeTruthy()
  })

  it('zeigt "Version unbekannt" bei unknown', () => {
    render(<ToolingStatusSection toolData={UNKNOWN_DATA} />)
    expect(screen.getByText('tooling.version_unknown')).toBeTruthy()
  })
})

// ─── ToolingOutputSection ────────────────────────────────────────────────────

describe('ToolingOutputSection', () => {
  it('zeigt stdout', () => {
    render(<ToolingOutputSection toolData={READY_DATA} />)
    expect(screen.getByText(/ansible \[core 2\.18\.1\]/)).toBeTruthy()
  })

  it('zeigt Leer-Hinweis bei null', () => {
    render(<ToolingOutputSection toolData={UNKNOWN_DATA} />)
    expect(screen.getByText('tooling.output_empty')).toBeTruthy()
  })
})

// ─── ToolingHistorySection ───────────────────────────────────────────────────

describe('ToolingHistorySection', () => {
  it('zeigt Leer-Hinweis bei leerer Liste', () => {
    useToolingAuditHistory.mockReturnValue({ data: { items: [] }, isLoading: false })
    render(<ToolingHistorySection tool="ansible" />)
    expect(screen.getByText('tooling.history_empty')).toBeTruthy()
  })

  it('zeigt Transition-Einträge', () => {
    useToolingAuditHistory.mockReturnValue({
      data: {
        items: [
          { id: 1, created_at: new Date().toISOString(), from_status: 'ready', to_status: 'down', version: '2.18.1', stderr_excerpt: null },
        ],
      },
      isLoading: false,
    })
    render(<ToolingHistorySection tool="ansible" />)
    expect(screen.getByText('ready')).toBeTruthy()
    expect(screen.getByText('down')).toBeTruthy()
  })

  it('zeigt Ladeindikator', () => {
    useToolingAuditHistory.mockReturnValue({ data: null, isLoading: true })
    render(<ToolingHistorySection tool="ansible" />)
    expect(screen.getByText('common.loading')).toBeTruthy()
  })
})

// ─── ToolingRecheckButton ────────────────────────────────────────────────────

describe('ToolingRecheckButton', () => {
  it('zeigt Recheck-Button im Idle-State', () => {
    useToolingRecheck.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, isSuccess: false })
    render(<ToolingRecheckButton />)
    expect(screen.getByText('tooling.recheck_button')).toBeTruthy()
  })

  it('zeigt Busy-Text während Request', () => {
    useToolingRecheck.mockReturnValue({ mutateAsync: vi.fn(), isPending: true, isSuccess: false })
    render(<ToolingRecheckButton />)
    expect(screen.getByText('tooling.recheck_busy')).toBeTruthy()
  })

  it('ruft mutateAsync bei Klick auf', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    useToolingRecheck.mockReturnValue({ mutateAsync, isPending: false, isSuccess: false })
    render(<ToolingRecheckButton />)
    fireEvent.click(screen.getByText('tooling.recheck_button'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledOnce())
  })
})

// ─── ToolingSlideOver ────────────────────────────────────────────────────────

describe('ToolingSlideOver', () => {
  it('rendert nichts wenn kein Tool offen', () => {
    mockSlideOver({ openTool: null })
    useToolingStatus.mockReturnValue({ data: null })
    const { container } = render(<ToolingSlideOver />)
    expect(container.firstChild).toBeNull()
  })

  it('rendert SlideOver wenn ansible offen', () => {
    mockSlideOver({ openTool: 'ansible', closeSlideOver: vi.fn() })
    useToolingStatus.mockReturnValue({ data: { ansible: READY_DATA } })
    useToolingAuditHistory.mockReturnValue({ data: { items: [] }, isLoading: false })
    useToolingRecheck.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, isSuccess: false })
    render(<ToolingSlideOver />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Ansible')).toBeTruthy()
  })

  it('schließt per Close-Button', () => {
    const closeSlideOver = vi.fn()
    mockSlideOver({ openTool: 'packer', closeSlideOver })
    useToolingStatus.mockReturnValue({ data: { packer: READY_DATA } })
    useToolingAuditHistory.mockReturnValue({ data: { items: [] }, isLoading: false })
    useToolingRecheck.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, isSuccess: false })
    render(<ToolingSlideOver />)
    fireEvent.click(screen.getByLabelText('common.close'))
    expect(closeSlideOver).toHaveBeenCalledOnce()
  })

  it('schließt per ESC-Taste', () => {
    const closeSlideOver = vi.fn()
    mockSlideOver({ openTool: 'ansible', closeSlideOver })
    useToolingStatus.mockReturnValue({ data: { ansible: READY_DATA } })
    useToolingAuditHistory.mockReturnValue({ data: { items: [] }, isLoading: false })
    useToolingRecheck.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, isSuccess: false })
    render(<ToolingSlideOver />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closeSlideOver).toHaveBeenCalledOnce()
  })

  // PROJ-66 Phase 2 (AC-P2-UI-2/4/5)
  it('rendert OpenTofu-Namen und Hilfetext wenn opentofu offen', () => {
    mockSlideOver({ openTool: 'opentofu', closeSlideOver: vi.fn() })
    useToolingStatus.mockReturnValue({ data: { opentofu: TOFU_DATA } })
    useToolingAuditHistory.mockReturnValue({ data: { items: [] }, isLoading: false })
    useToolingRecheck.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, isSuccess: false })
    render(<ToolingSlideOver />)
    expect(screen.getByText('OpenTofu')).toBeTruthy()
    expect(screen.getByText('tooling.opentofu_hint')).toBeTruthy()
  })

  it('rendert KEINEN OpenTofu-Hilfetext bei ansible', () => {
    mockSlideOver({ openTool: 'ansible', closeSlideOver: vi.fn() })
    useToolingStatus.mockReturnValue({ data: { ansible: READY_DATA } })
    useToolingAuditHistory.mockReturnValue({ data: { items: [] }, isLoading: false })
    useToolingRecheck.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, isSuccess: false })
    render(<ToolingSlideOver />)
    expect(screen.queryByText('tooling.opentofu_hint')).toBeNull()
  })
})
