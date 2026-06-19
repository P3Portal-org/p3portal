// p3portal.org
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SdnManagementTab from './SdnManagementTab'

vi.mock('../../api/sdn', () => ({
  listSdnZones: vi.fn(),
  listSdnVnets: vi.fn(),
  listSdnSubnets: vi.fn(),
  applySdn: vi.fn(),
  revertSdn: vi.fn(),
  createSdnZone: vi.fn(),
  updateSdnZone: vi.fn(),
  deleteSdnZone: vi.fn(),
  checkSdnZoneUsage: vi.fn(),
  createSdnVnet: vi.fn(),
  updateSdnVnet: vi.fn(),
  deleteSdnVnet: vi.fn(),
  checkSdnVnetUsage: vi.fn(),
  createSdnSubnet: vi.fn(),
  updateSdnSubnet: vi.fn(),
  deleteSdnSubnet: vi.fn(),
  listSdnBridges: vi.fn(() => Promise.resolve({ bridges: [] })),
}))

import { listSdnZones, listSdnVnets, listSdnSubnets } from '../../api/sdn'

const ZONES = {
  items: [
    { id: 'zone1', type: 'simple', mtu: 1500, pending: false, state: null },
    { id: 'vlanz', type: 'vlan', bridge: 'vmbr0', pending: true, state: 'new' },
  ],
  has_pending: true,
}
const VNETS = {
  items: [
    { id: 'vnet1', zone: 'vlanz', tag: 100, alias: 'frontend', vlanaware: false, pending: false, state: null },
  ],
}
const SUBNETS = {
  items: [
    { id: 'zone1-10.0.0.0-24', vnet: 'vnet1', cidr: '10.0.0.0/24', gateway: '10.0.0.1', snat: true, pending: false, state: null },
  ],
}

function mockOk() {
  listSdnZones.mockResolvedValue(ZONES)
  listSdnVnets.mockResolvedValue(VNETS)
  listSdnSubnets.mockResolvedValue(SUBNETS)
}

describe('SdnManagementTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-LIST-1: lists zones, vnets and subnets', async () => {
    mockOk()
    render(<SdnManagementTab />)
    await screen.findByText('zone1')
    // vlanz appears in the Zones table (id) and the VNets table (zone col)
    expect(screen.getAllByText('vlanz').length).toBeGreaterThanOrEqual(1)
    // vnet1 appears in both the VNets table (id) and the Subnets table (vnet col)
    expect(screen.getAllByText('vnet1').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('10.0.0.0/24')).toBeInTheDocument()
  })

  it('AC-APPLY-1: shows cluster-wide pending banner with apply/revert', async () => {
    mockOk()
    render(<SdnManagementTab />)
    await screen.findByText('zone1')
    expect(screen.getByText(/Übernehmen \(cluster-weit\)/)).toBeInTheDocument()
    expect(screen.getByText('Verwerfen')).toBeInTheDocument()
  })

  it('AC-LIST-2: pending zone shows a "neu" state badge', async () => {
    mockOk()
    render(<SdnManagementTab />)
    await screen.findByText('zone1')
    expect(screen.getByText('neu')).toBeInTheDocument()
  })

  it('AC-LIST-3: search filters across entities', async () => {
    mockOk()
    render(<SdnManagementTab />)
    await screen.findByText('zone1')
    // "simple" matches only zone1 (its type); vlanz/vnet/subnet drop out.
    fireEvent.change(screen.getByPlaceholderText(/Suche/), { target: { value: 'simple' } })
    expect(screen.getByText('zone1')).toBeInTheDocument()
    expect(screen.queryByText('vlanz')).not.toBeInTheDocument()
    expect(screen.queryByText('vnet1')).not.toBeInTheDocument()
  })

  it('EC-7: shows "SDN nicht verfügbar" when sdn_unavailable', async () => {
    listSdnZones.mockResolvedValue({ items: [], sdn_unavailable: true })
    listSdnVnets.mockResolvedValue({ items: [] })
    listSdnSubnets.mockResolvedValue({ items: [] })
    render(<SdnManagementTab />)
    await screen.findByText(/SDN ist auf diesem Cluster nicht verfügbar/)
  })

  it('AC-LIST-4: shows permission_denied banner', async () => {
    listSdnZones.mockResolvedValue({ items: [], permission_denied: true })
    listSdnVnets.mockResolvedValue({ items: [] })
    listSdnSubnets.mockResolvedValue({ items: [] })
    render(<SdnManagementTab />)
    await screen.findByText(/Kein Zugriff in Proxmox/)
  })

  it('AC-CZ-1: opens the zone create modal', async () => {
    mockOk()
    render(<SdnManagementTab />)
    await screen.findByText('zone1')
    fireEvent.click(screen.getByText('+ Zone anlegen'))
    await waitFor(() => expect(screen.getByText('SDN-Zone anlegen')).toBeInTheDocument())
  })
})
