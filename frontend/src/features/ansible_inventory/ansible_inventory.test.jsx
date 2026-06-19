// p3portal.org
// PROJ-83: Vitest-Tests für das Ansible-Inventory-Feature.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../hooks/useCapability', () => ({
  useCapability: vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ role: 'operator', portalPermissions: [] })),
}))

vi.mock('../../plus', () => ({
  PlusComponents: { PoolSelectorField: () => null },
}))

vi.mock('../../api/cluster', () => ({ getNodes: vi.fn().mockResolvedValue([]) }))

vi.mock('./hooks', () => ({
  useInventoryHosts: vi.fn(),
  useResetHostKey: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useMarkManaged: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useTestConnection: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDiscovery: vi.fn(() => ({ data: { hosts: [] }, isLoading: false, error: null })),
  useOnboardHost: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useOnboardBulk: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}))

vi.mock('./api', () => ({
  fetchOnboardingBlock: vi.fn(),
}))

vi.mock('../help/components/HelpButton', () => ({ default: () => null }))
vi.mock('../../components/common/ConfirmModal', () => ({ default: () => null }))

import GuestHostList from './components/GuestHostList'
import GuestScopeSelector from './components/GuestScopeSelector'
import DeployAnsibleOptions from './components/DeployAnsibleOptions'
import InventoryView from './components/InventoryView'
import OnboardingBlockModal from './components/OnboardingBlockModal'
import { useCapability } from '../../hooks/useCapability'
import { useInventoryHosts } from './hooks'
import { fetchOnboardingBlock } from './api'

const HOSTS = [
  { host_ref: '1:100:qemu', portal_node_id: 1, proxmox_node: 'pve', vmid: 100, kind: 'qemu', group: 'managed', ip: '10.0.0.5', ansible_user: 'p3-ansible' },
  { host_ref: '1:101:qemu', portal_node_id: 1, proxmox_node: 'pve', vmid: 101, kind: 'qemu', group: 'unmanaged', ip: null, ansible_user: 'p3-ansible' },
  { host_ref: '1:102:lxc', portal_node_id: 1, proxmox_node: 'pve', vmid: 102, kind: 'lxc', group: 'no_ip', ip: null, ansible_user: 'p3-ansible' },
]

beforeEach(() => {
  vi.clearAllMocks()
  useCapability.mockReturnValue(false)
  useInventoryHosts.mockReturnValue({ data: { hosts: HOSTS }, isLoading: false, error: null })
})

describe('GuestHostList', () => {
  it('rendert alle drei Gruppen und nur managed ist auswählbar', () => {
    const onToggle = vi.fn()
    render(<GuestHostList hosts={HOSTS} selected={new Set()} onToggle={onToggle} selectable />)
    const checkboxes = screen.getAllByRole('checkbox')
    expect(checkboxes).toHaveLength(3)
    // managed = enabled, unmanaged + no_ip = disabled
    expect(checkboxes[0]).not.toBeDisabled()
    expect(checkboxes[1]).toBeDisabled()
    expect(checkboxes[2]).toBeDisabled()
  })

  it('ruft onToggle für managed Hosts', () => {
    const onToggle = vi.fn()
    render(<GuestHostList hosts={HOSTS} selected={new Set()} onToggle={onToggle} selectable />)
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(onToggle).toHaveBeenCalledWith('1:100:qemu')
  })

  it('zeigt Warnung wenn keine managed Hosts', () => {
    render(<GuestHostList hosts={HOSTS.filter(h => h.group !== 'managed')} selected={new Set()} onToggle={() => {}} selectable />)
    expect(screen.getByText('ansible_inventory.no_managed_targets')).toBeInTheDocument()
  })
})

describe('GuestScopeSelector', () => {
  it('blendet Pool/Global in Core aus und meldet User-Scope', () => {
    const onChange = vi.fn()
    render(<GuestScopeSelector onChange={onChange} />)
    // Nur der User-Scope-Button vorhanden
    expect(screen.getByText('ansible_inventory.scope.user')).toBeInTheDocument()
    expect(screen.queryByText('ansible_inventory.scope.pool')).not.toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ guestScope: { kind: 'user', ref: null }, targetHosts: null }),
    )
  })

  it('zeigt Pool/Global-Scopes bei Plus', () => {
    useCapability.mockReturnValue(true)
    render(<GuestScopeSelector onChange={vi.fn()} />)
    expect(screen.getByText('ansible_inventory.scope.pool')).toBeInTheDocument()
    expect(screen.getByText('ansible_inventory.scope.global')).toBeInTheDocument()
  })
})

describe('DeployAnsibleOptions', () => {
  it('Verwalten-Haken ist standardmäßig an und meldet das', () => {
    const onChange = vi.fn()
    render(<DeployAnsibleOptions onChange={onChange} />)
    const cb = screen.getAllByRole('checkbox')[0]
    expect(cb).toBeChecked()
    expect(onChange).toHaveBeenCalledWith({ manageForAnsible: true, globalOptIn: false })
  })

  it('blendet den Global-Haken in Core aus', () => {
    render(<DeployAnsibleOptions onChange={vi.fn()} />)
    // Nur ein Haken (manage), kein Global-Haken in Core
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
  })

  it('zeigt den Global-Haken bei Plus', () => {
    useCapability.mockReturnValue(true)
    render(<DeployAnsibleOptions onChange={vi.fn()} />)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
  })
})

describe('InventoryView', () => {
  it('rendert Hosts und Host-Key-Reset nur für managed', () => {
    render(<InventoryView />)
    expect(screen.getByText(/VM 100/)).toBeInTheDocument()
    // Reset-Button trägt das i18n-Key-Label und erscheint nur 1x (managed)
    expect(screen.getAllByText('ansible_inventory.reset_host_key')).toHaveLength(1)
  })

  it('zeigt Leer-Hinweis ohne Hosts', () => {
    useInventoryHosts.mockReturnValue({ data: { hosts: [] }, isLoading: false, error: null })
    render(<InventoryView />)
    expect(screen.getByText('ansible_inventory.empty')).toBeInTheDocument()
  })
})

describe('OnboardingBlockModal', () => {
  it('lädt und zeigt den Block', async () => {
    fetchOnboardingBlock.mockResolvedValue({ block: '#!/bin/sh\nuseradd p3-ansible', vendor_data: '#cloud-config', key_count: 1 })
    render(<OnboardingBlockModal scope="user" onClose={() => {}} />)
    expect(await screen.findByText(/useradd p3-ansible/)).toBeInTheDocument()
    expect(screen.getByText('ansible_inventory.onb_manual_title')).toBeInTheDocument()
  })

  it('warnt wenn kein Public Key vorhanden', async () => {
    fetchOnboardingBlock.mockResolvedValue({ block: '', vendor_data: '', key_count: 0 })
    render(<OnboardingBlockModal scope="user" onClose={() => {}} />)
    expect(await screen.findByText('ansible_inventory.onb_no_keys')).toBeInTheDocument()
  })
})
