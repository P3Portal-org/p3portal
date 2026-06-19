// p3portal.org
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ComputeNetworkTab from './ComputeNetworkTab'

vi.mock('../../api/networks', () => ({
  listNetworkInterfaces: vi.fn(),
  reloadNetwork: vi.fn(),
  revertNetwork: vi.fn(),
  listNetworkDevices: vi.fn().mockResolvedValue([]),
  createNetworkInterface: vi.fn(),
  updateNetworkInterface: vi.fn(),
  checkNetworkInterfaceUsage: vi.fn(),
  deleteNetworkInterface: vi.fn(),
}))

import { listNetworkInterfaces } from '../../api/networks'

const IFACES = {
  interfaces: [
    { iface: 'vmbr0', type: 'bridge', cidr: '192.168.1.10/24', gateway: '192.168.1.1', autostart: true, active: true, pending: false, bridge_ports: ['eth0'], bridge_vlan_aware: false, comments: 'mgmt' },
    { iface: 'vmbr1', type: 'bridge', cidr: null, autostart: true, active: true, pending: true, bridge_ports: [], bridge_vlan_aware: true, comments: '' },
    { iface: 'vmbr0.100', type: 'vlan', cidr: '10.0.100.1/24', autostart: false, active: true, pending: false, vlan_id: 100, comments: 'guests' },
  ],
  has_pending: true,
}

describe('ComputeNetworkTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-LIST-1: fetches and lists interfaces when active', async () => {
    listNetworkInterfaces.mockResolvedValue(IFACES)
    render(<ComputeNetworkTab nodeName="pve1" active={true} />)
    await screen.findByText('vmbr0')
    expect(listNetworkInterfaces).toHaveBeenCalledWith('pve1')
    expect(screen.getByText('vmbr1')).toBeInTheDocument()
    expect(screen.getByText('vmbr0.100')).toBeInTheDocument()
  })

  it('AC-APPLY-1: shows pending banner with apply/revert buttons', async () => {
    listNetworkInterfaces.mockResolvedValue(IFACES)
    render(<ComputeNetworkTab nodeName="pve1" active={true} />)
    await screen.findByText('vmbr0')
    expect(screen.getByText(/Übernehmen \(Reload\)/)).toBeInTheDocument()
    expect(screen.getByText(/Verwerfen \(Revert\)/)).toBeInTheDocument()
  })

  it('AC-LIST-2: pending interface shows "ausstehend" badge', async () => {
    listNetworkInterfaces.mockResolvedValue(IFACES)
    render(<ComputeNetworkTab nodeName="pve1" active={true} />)
    await screen.findByText('vmbr0')
    expect(screen.getByText('ausstehend')).toBeInTheDocument()
  })

  it('AC-LIST-4: type filter narrows the list to VLANs', async () => {
    listNetworkInterfaces.mockResolvedValue(IFACES)
    render(<ComputeNetworkTab nodeName="pve1" active={true} />)
    await screen.findByText('vmbr0')
    fireEvent.change(screen.getByDisplayValue('Alle Typen'), { target: { value: 'vlan' } })
    expect(screen.queryByText('vmbr0')).not.toBeInTheDocument()
    expect(screen.getByText('vmbr0.100')).toBeInTheDocument()
  })

  it('AC-LIST-6: shows node-unreachable banner with detail', async () => {
    listNetworkInterfaces.mockRejectedValue({ response: { status: 502 } })
    render(<ComputeNetworkTab nodeName="pve1" active={true} />)
    await screen.findByText(/Node nicht erreichbar/)
  })

  it('AC-LIST-5: shows permission-denied state', async () => {
    listNetworkInterfaces.mockResolvedValue({ interfaces: [], permission_denied: true })
    render(<ComputeNetworkTab nodeName="pve1" active={true} />)
    await screen.findByText(/Kein Zugriff in Proxmox/)
  })

  it('does not fetch when inactive', () => {
    render(<ComputeNetworkTab nodeName="pve1" active={false} />)
    expect(listNetworkInterfaces).not.toHaveBeenCalled()
  })
})
