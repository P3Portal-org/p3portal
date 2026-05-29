// p3portal.org
// PROJ-73: Vitest-Tests für das Node-Updates-Feature
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// ─── Globale Mocks ───────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k, opts) => {
      if (!opts) return k
      return Object.entries(opts).reduce((s, [key, val]) => s.replace(`{{${key}}}`, val), k)
    },
  }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('./hooks', () => ({
  useNodeUpdatesSummary:    vi.fn(),
  useNodeUpdates:           vi.fn(),
  useRefreshNodeUpdates:    vi.fn(),
  useNodeUpdatesBadgeData:  vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}))

import SecurityBadge   from './components/SecurityBadge'
import StaleWarning    from './components/StaleWarning'
import RefreshButton   from './components/RefreshButton'
import UpdatesBadge    from './components/UpdatesBadge'
import PackageTable    from './components/PackageTable'
import UpdatesTab      from './components/UpdatesTab'
import {
  useNodeUpdates, useRefreshNodeUpdates, useNodeUpdatesBadgeData,
} from './hooks'
import { useAuth } from '../../hooks/useAuth'
import { formatRelative } from './utils'

// ─── utils ───────────────────────────────────────────────────────────────────

describe('formatRelative', () => {
  it('gibt gerade eben zurück bei neuer Zeit', () => {
    expect(formatRelative(new Date().toISOString())).toBe('gerade eben')
  })

  it('gibt Minuten zurück', () => {
    const ts = new Date(Date.now() - 10 * 60_000).toISOString()
    expect(formatRelative(ts)).toBe('vor 10 Min.')
  })

  it('gibt Stunden zurück', () => {
    const ts = new Date(Date.now() - 5 * 3600_000).toISOString()
    expect(formatRelative(ts)).toBe('vor 5 Std.')
  })

  it('gibt Tage zurück', () => {
    const ts = new Date(Date.now() - 3 * 86400_000).toISOString()
    expect(formatRelative(ts)).toBe('vor 3 Tagen')
  })

  it('gibt null zurück bei null', () => {
    expect(formatRelative(null)).toBeNull()
  })
})

// ─── SecurityBadge ──────────────────────────────────────────────────────────

describe('SecurityBadge', () => {
  it('zeigt Security-Label', () => {
    render(<SecurityBadge />)
    expect(screen.getByText('nodeUpdates.security_label')).toBeTruthy()
  })
})

// ─── StaleWarning ────────────────────────────────────────────────────────────

describe('StaleWarning', () => {
  it('rendert mit relativem Zeitstempel', () => {
    const ts = new Date(Date.now() - 50 * 3600_000).toISOString()
    render(<StaleWarning lastSuccessAt={ts} />)
    expect(screen.getByText(/stale_warning_with_time/)).toBeTruthy()
  })

  it('rendert ohne Zeitstempel', () => {
    render(<StaleWarning lastSuccessAt={null} />)
    expect(screen.getByText('nodeUpdates.stale_warning')).toBeTruthy()
  })
})

// ─── RefreshButton ───────────────────────────────────────────────────────────

describe('RefreshButton', () => {
  it('zeigt Refresh-Label im Ruhezustand', () => {
    render(<RefreshButton onClick={vi.fn()} loading={false} />)
    expect(screen.getByText('nodeUpdates.refresh_button')).toBeTruthy()
  })

  it('zeigt Refreshing-Label bei loading=true', () => {
    render(<RefreshButton onClick={vi.fn()} loading={true} />)
    expect(screen.getAllByText('nodeUpdates.refreshing').length).toBeGreaterThan(0)
  })

  it('ist disabled bei loading=true', () => {
    render(<RefreshButton onClick={vi.fn()} loading={true} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('ruft onClick auf', () => {
    const fn = vi.fn()
    render(<RefreshButton onClick={fn} loading={false} />)
    fireEvent.click(screen.getByRole('button'))
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

// ─── UpdatesBadge ────────────────────────────────────────────────────────────

describe('UpdatesBadge', () => {
  it('rendert nichts wenn kein Badge-Daten', () => {
    useNodeUpdatesBadgeData.mockReturnValue({})
    const { container } = render(<UpdatesBadge portalNodeId={1} nodeName="pve" />)
    expect(container.firstChild).toBeNull()
  })

  it('zeigt badge_no_check wenn kein lastSuccessAt und kein Fehler', () => {
    useNodeUpdatesBadgeData.mockReturnValue({
      1: { packageCount: 0, securityCount: 0, lastSuccessAt: null, hasError: false, isStale: false },
    })
    render(<UpdatesBadge portalNodeId={1} nodeName="pve" />)
    expect(screen.getByText('nodeUpdates.badge_no_check')).toBeTruthy()
  })

  it('zeigt badge_up_to_date bei 0 Paketen und Erfolg', () => {
    useNodeUpdatesBadgeData.mockReturnValue({
      1: { packageCount: 0, securityCount: 0, lastSuccessAt: new Date().toISOString(), hasError: false, isStale: false },
    })
    render(<UpdatesBadge portalNodeId={1} nodeName="pve" />)
    expect(screen.getByText('nodeUpdates.badge_up_to_date')).toBeTruthy()
  })

  it('zeigt Updates-Anzahl ohne Security', () => {
    useNodeUpdatesBadgeData.mockReturnValue({
      1: { packageCount: 5, securityCount: 0, lastSuccessAt: new Date().toISOString(), hasError: false, isStale: false },
    })
    render(<UpdatesBadge portalNodeId={1} nodeName="pve" />)
    expect(screen.getByText('nodeUpdates.badge_updates')).toBeTruthy()
  })

  it('zeigt Security-Updates separat', () => {
    useNodeUpdatesBadgeData.mockReturnValue({
      1: { packageCount: 10, securityCount: 3, lastSuccessAt: new Date().toISOString(), hasError: false, isStale: false },
    })
    render(<UpdatesBadge portalNodeId={1} nodeName="pve" />)
    expect(screen.getByText('nodeUpdates.badge_with_security')).toBeTruthy()
  })

  it('zeigt Fehler-Badge', () => {
    useNodeUpdatesBadgeData.mockReturnValue({
      1: { packageCount: 0, securityCount: 0, lastSuccessAt: null, hasError: true, isStale: false },
    })
    render(<UpdatesBadge portalNodeId={1} nodeName="pve" />)
    expect(screen.getByText('nodeUpdates.badge_error')).toBeTruthy()
  })
})

// ─── PackageTable ─────────────────────────────────────────────────────────────

const PACKAGES = [
  { name: 'openssh-server', version_old: '9.0', version_new: '9.1', is_security: true },
  { name: 'curl',           version_old: '7.88', version_new: '7.90', is_security: false },
  { name: 'apt',            version_old: '2.6.0', version_new: '2.6.1', is_security: false },
]

describe('PackageTable', () => {
  it('rendert alle Pakete', () => {
    render(<PackageTable packages={PACKAGES} />)
    expect(screen.getByText('openssh-server')).toBeTruthy()
    expect(screen.getByText('curl')).toBeTruthy()
    expect(screen.getByText('apt')).toBeTruthy()
  })

  it('Security-Pakete erscheinen zuerst', () => {
    render(<PackageTable packages={PACKAGES} />)
    const rows = screen.getAllByRole('row')
    // Erste Daten-Zeile (nach Header) sollte openssh-server sein
    expect(rows[1].textContent).toContain('openssh-server')
  })

  it('zeigt Node-Spalte bei showNodeColumn=true', () => {
    const pkgs = PACKAGES.map(p => ({ ...p, node_name: 'pve01' }))
    render(<PackageTable packages={pkgs} showNodeColumn={true} />)
    expect(screen.getByText('nodeUpdates.col_node')).toBeTruthy()
  })

  it('zeigt leere-Liste-Hinweis', () => {
    render(<PackageTable packages={[]} />)
    expect(screen.getByText('nodeUpdates.no_packages')).toBeTruthy()
  })
})

// ─── UpdatesTab ─────────────────────────────────────────────────────────────

const MEMBER = {
  portal_node_id:    1,
  proxmox_node_name: 'pve01',
  last_check_at:     new Date().toISOString(),
  last_success_at:   new Date().toISOString(),
  last_error:        null,
  packages:          PACKAGES,
  package_count:     3,
  security_count:    1,
  is_stale:          false,
}

describe('UpdatesTab', () => {
  beforeEach(() => {
    useAuth.mockReturnValue({ role: 'admin' })
  })

  it('rendert nichts wenn active=false', () => {
    useNodeUpdates.mockReturnValue({ data: null, isLoading: false, error: null })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    const { container } = render(<UpdatesTab portalNodeId={1} active={false} />)
    expect(container.firstChild).toBeNull()
  })

  it('zeigt Lade-Skeleton bei isLoading', () => {
    useNodeUpdates.mockReturnValue({ data: null, isLoading: true, error: null })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<UpdatesTab portalNodeId={1} active={true} />)
    // Skeleton-Divs sind animate-pulse
    expect(document.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('zeigt 403-Hinweis bei Forbidden', () => {
    useNodeUpdates.mockReturnValue({ data: null, isLoading: false, error: { response: { status: 403 } } })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<UpdatesTab portalNodeId={1} active={true} />)
    expect(screen.getByText('nodeUpdates.no_access')).toBeTruthy()
  })

  it('zeigt NoDataState wenn kein lastSuccessAt und kein Fehler', () => {
    const memberNoData = { ...MEMBER, last_success_at: null, last_error: null, packages: [], package_count: 0, security_count: 0 }
    useNodeUpdates.mockReturnValue({
      data: { portal_node_id: 1, portal_node_name: 'pve', members: [memberNoData] },
      isLoading: false,
      error: null,
    })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<UpdatesTab portalNodeId={1} active={true} />)
    expect(screen.getByText('nodeUpdates.no_data_title')).toBeTruthy()
  })

  it('zeigt all_up_to_date wenn 0 Pakete und Erfolg', () => {
    const memberUpToDate = { ...MEMBER, packages: [], package_count: 0, security_count: 0 }
    useNodeUpdates.mockReturnValue({
      data: { portal_node_id: 1, portal_node_name: 'pve', members: [memberUpToDate] },
      isLoading: false,
      error: null,
    })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<UpdatesTab portalNodeId={1} active={true} />)
    expect(screen.getByText('nodeUpdates.all_up_to_date')).toBeTruthy()
  })

  it('zeigt Pakettabelle', () => {
    useNodeUpdates.mockReturnValue({
      data: { portal_node_id: 1, portal_node_name: 'pve', members: [MEMBER] },
      isLoading: false,
      error: null,
    })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<UpdatesTab portalNodeId={1} active={true} />)
    expect(screen.getByText('openssh-server')).toBeTruthy()
  })

  it('zeigt Refresh-Button für Admin', () => {
    useNodeUpdates.mockReturnValue({
      data: { portal_node_id: 1, portal_node_name: 'pve', members: [MEMBER] },
      isLoading: false,
      error: null,
    })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<UpdatesTab portalNodeId={1} active={true} />)
    expect(screen.getByText('nodeUpdates.refresh_button')).toBeTruthy()
  })

  it('kein Refresh-Button für Viewer', () => {
    useAuth.mockReturnValue({ role: 'viewer' })
    useNodeUpdates.mockReturnValue({
      data: { portal_node_id: 1, portal_node_name: 'pve', members: [MEMBER] },
      isLoading: false,
      error: null,
    })
    useRefreshNodeUpdates.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
    render(<UpdatesTab portalNodeId={1} active={true} />)
    expect(screen.queryByText('nodeUpdates.refresh_button')).toBeNull()
  })
})
