// p3portal.org
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import ClusterStatusBar from './ClusterStatusBar'

vi.mock('../../api/cluster', () => ({
  getClusterStatus: vi.fn(),
  getNodes: vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ auth_type: 'local' })),
}))

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: vi.fn(() => ({ proxmoxPerms: null, loading: false })),
}))

vi.mock('../../features/notifications/components/NotificationBell', () => ({
  default: () => null,
}))

vi.mock('../../features/tooling/components/ToolingIndicators', () => ({
  default: () => null,
}))

import { getClusterStatus, getNodes } from '../../api/cluster'

const SINGLE_NODE = {
  node: 'pve1', status: 'online',
  cpu: 0.24, maxcpu: 8,
  mem: 4294967296, maxmem: 17179869184,
  disk: 0, maxdisk: 0, uptime: 86400,
}

const SINGLE_NODE_STATUS = { quorum: true, node_count: 1, ha_status: 'none' }

const MULTI_NODES = [
  { node: 'pve1', status: 'online', cpu: 0.30, maxcpu: 8, mem: 4e9, maxmem: 16e9, disk: 0, maxdisk: 0, uptime: 3600 },
  { node: 'pve2', status: 'online', cpu: 0.10, maxcpu: 8, mem: 2e9, maxmem: 16e9, disk: 0, maxdisk: 0, uptime: 7200 },
]

const CLUSTER_STATUS_OK = { quorum: true, node_count: 2, ha_status: 'active' }

function renderBar() {
  return render(
    <MemoryRouter>
      <ClusterStatusBar />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  getClusterStatus.mockResolvedValue(SINGLE_NODE_STATUS)
  getNodes.mockResolvedValue([SINGLE_NODE])
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

async function flush() {
  for (let i = 0; i < 5; i++) await act(async () => {})
}

// ── Single-Node-Modus (Core-Edition) ─────────────────────────────────────────

describe('ClusterStatusBar – Single-Node-Modus (Core)', () => {
  it('zeigt Node-Name wenn nur 1 Node zurückkommt', async () => {
    renderBar()
    await flush()
    expect(screen.getByText('pve1')).toBeInTheDocument()
  })

  it('zeigt grünen Status-Dot wenn Node online ist', async () => {
    const { container } = renderBar()
    await flush()
    // NodePill zeigt grünen Dot (bg-portal-success) für Online-Nodes
    const dot = container.querySelector('.bg-portal-success')
    expect(dot).toBeInTheDocument()
  })

  it('zeigt CPU-Prozent für den einzelnen Node', async () => {
    // cpu=0.24 → 24% (NodePill: kein "CPU"-Präfix, nur Zahl)
    renderBar()
    await flush()
    expect(screen.getByText('24%')).toBeInTheDocument()
  })

  it('zeigt RAM-Prozent für den einzelnen Node', async () => {
    // mem=4294967296, maxmem=17179869184 → 25% (NodePill: "/ 25%")
    renderBar()
    await flush()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('zeigt KEIN Quorum-/Cluster-Label im Single-Node-Modus', async () => {
    renderBar()
    await flush()
    expect(screen.queryByText('Cluster OK')).not.toBeInTheDocument()
    expect(screen.queryByText('HA inaktiv')).not.toBeInTheDocument()
    expect(screen.queryByText('Kein Quorum')).not.toBeInTheDocument()
  })

  it('zeigt KEIN "X/Y Nodes"-Counter im Single-Node-Modus', async () => {
    renderBar()
    await flush()
    expect(screen.queryByText(/\d+\/\d+ Nodes/)).not.toBeInTheDocument()
  })

  it('zeigt roten Dot wenn Node offline ist', async () => {
    renderBar()
    getNodes.mockResolvedValue([{ ...SINGLE_NODE, status: 'offline' }])
    const offlineBar = render(
      <MemoryRouter>
        <ClusterStatusBar />
      </MemoryRouter>
    )
    await flush()
    const dot = offlineBar.container.querySelector('.bg-portal-danger')
    expect(dot).toBeInTheDocument()
  })

  it('zeigt kein CPU/RAM wenn Node offline ist', async () => {
    getNodes.mockResolvedValue([{ ...SINGLE_NODE, status: 'offline', cpu: 0 }])
    renderBar()
    await flush()
    expect(screen.queryByText(/CPU \d+%/)).not.toBeInTheDocument()
    expect(screen.queryByText(/RAM \d+%/)).not.toBeInTheDocument()
  })
})

// ── Multi-Node-Modus (Plus-Edition) ──────────────────────────────────────────

describe('ClusterStatusBar – Multi-Node-Modus (Plus)', () => {
  beforeEach(() => {
    getClusterStatus.mockResolvedValue(CLUSTER_STATUS_OK)
    getNodes.mockResolvedValue(MULTI_NODES)
  })

  it('zeigt "Cluster OK" wenn Quorum + HA aktiv', async () => {
    renderBar()
    await flush()
    expect(screen.getByText('Cluster OK')).toBeInTheDocument()
  })

  it('zeigt "X/Y"-Counter für Online/Total-Nodes', async () => {
    renderBar()
    await flush()
    // PROJ-36: "2/2" ohne "Nodes"-Suffix
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('zeigt CPU per Node (kein Durchschnitt)', async () => {
    // PROJ-36 Bug-Fix: pro Node statt Durchschnitt; pve1=30%, pve2=10%
    renderBar()
    await flush()
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()
  })

  it('zeigt beide Node-Namen im Multi-Node-Modus', async () => {
    renderBar()
    await flush()
    expect(screen.getByText('pve1')).toBeInTheDocument()
    expect(screen.getByText('pve2')).toBeInTheDocument()
  })
})

// ── Ladezustand ───────────────────────────────────────────────────────────────

describe('ClusterStatusBar – Ladezustand', () => {
  it('zeigt API-Fehler nicht als Crash (graceful ignore)', async () => {
    getNodes.mockRejectedValue(new Error('Proxmox nicht erreichbar'))
    getClusterStatus.mockRejectedValue(new Error('Proxmox nicht erreichbar'))
    // Kein Crash erwartet – silent ignore im Component
    expect(() => renderBar()).not.toThrow()
    await flush()
    // Kein Cluster-Status sichtbar – nur Permissions-Section
    expect(screen.queryByText('Cluster OK')).not.toBeInTheDocument()
    expect(screen.queryByText('Online')).not.toBeInTheDocument()
  })
})
