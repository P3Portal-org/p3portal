// p3portal.org
// PROJ-84: Vitest-Tests für Discovery/Onboarding bestehender Hosts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k) => k }),
}))

vi.mock('../../hooks/useCapability', () => ({ useCapability: vi.fn() }))
vi.mock('../../hooks/useAuth', () => ({ useAuth: vi.fn() }))
vi.mock('../../plus', () => ({ PlusComponents: { PoolSelectorField: () => null } }))
vi.mock('../help/components/HelpButton', () => ({ default: () => null }))
vi.mock('../../api/cluster', () => ({ getNodes: vi.fn() }))

// ConfirmModal: rendert einen Confirm-Button, der onConfirm aufruft.
vi.mock('../../components/common/ConfirmModal', () => ({
  default: ({ onConfirm }) => (
    <button data-testid="confirm" onClick={onConfirm}>confirm</button>
  ),
}))

// Schwere Modals durch Marker ersetzen.
vi.mock('./components/OnboardingBlockModal', () => ({ default: () => <div data-testid="onb-block" /> }))
vi.mock('./components/OnboardResultModal', () => ({
  default: ({ single, bulk }) => <div data-testid="result">{single ? 'single' : bulk ? 'bulk' : ''}</div>,
}))

vi.mock('./hooks', () => ({
  useInventoryHosts: vi.fn(),
  useResetHostKey: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useMarkManaged: vi.fn(),
  useTestConnection: vi.fn(),
  useDiscovery: vi.fn(),
  useOnboardHost: vi.fn(),
  useOnboardBulk: vi.fn(),
}))

import InventoryView from './components/InventoryView'
import MarkManagedButton from './components/MarkManagedButton'
import ConnectivityTestButton from './components/ConnectivityTestButton'
import InstallationDiscoveryView from './components/InstallationDiscoveryView'
import { useCapability } from '../../hooks/useCapability'
import { useAuth } from '../../hooks/useAuth'
import { getNodes } from '../../api/cluster'
import {
  useInventoryHosts,
  useMarkManaged,
  useTestConnection,
  useDiscovery,
  useOnboardHost,
  useOnboardBulk,
} from './hooks'

const USER_HOSTS = [
  { host_ref: '1:100:qemu', portal_node_id: 1, proxmox_node: 'pve', vmid: 100, kind: 'qemu', group: 'managed', ip: '10.0.0.5', ansible_user: 'p3-ansible' },
  { host_ref: '1:101:qemu', portal_node_id: 1, proxmox_node: 'pve', vmid: 101, kind: 'qemu', group: 'unmanaged', ip: null, ansible_user: 'p3-ansible' },
]

const DISCOVERY_HOSTS = [
  { host_ref: '1:100:qemu', portal_node_id: 1, proxmox_node: 'pve', vmid: 100, kind: 'qemu', name: 'web-1', status: 'running', managed: true, in_run_scope: true, ip: '10.0.0.5' },
  { host_ref: '1:101:qemu', portal_node_id: 1, proxmox_node: 'pve', vmid: 101, kind: 'qemu', name: 'legacy', status: 'stopped', managed: false, in_run_scope: false, ip: null },
  { host_ref: '1:102:lxc', portal_node_id: 1, proxmox_node: 'pve', vmid: 102, kind: 'lxc', name: 'orphan', status: 'running', managed: true, in_run_scope: false, ip: '10.0.0.9' },
]

beforeEach(() => {
  vi.clearAllMocks()
  useCapability.mockReturnValue(false)
  useAuth.mockReturnValue({ role: 'operator', portalPermissions: [] })
  useInventoryHosts.mockReturnValue({ data: { hosts: USER_HOSTS }, isLoading: false, error: null })
  useMarkManaged.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({}) })
  useTestConnection.mockReturnValue({ mutateAsync: vi.fn(), isPending: false })
  useDiscovery.mockReturnValue({ data: { hosts: DISCOVERY_HOSTS }, isLoading: false, error: null })
  useOnboardHost.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ block: 'x', key_count: 1 }), isPending: false })
  useOnboardBulk.mockReturnValue({ mutateAsync: vi.fn().mockResolvedValue({ onboarded: 1, skipped: 0, failed: [] }), isPending: false })
  getNodes.mockResolvedValue([{ node: 'pve', portal_node_id: 1, portal_node_name: 'Main' }])
})

describe('InventoryView – Installation-Scope-Gate (AC-DISC-3)', () => {
  it('blendet Installation-Scope ohne manage_ansible_inventory aus', () => {
    useCapability.mockReturnValue(true) // plus
    useAuth.mockReturnValue({ role: 'operator', portalPermissions: [] })
    render(<InventoryView />)
    expect(screen.queryByText('ansible_inventory.scope.installation')).not.toBeInTheDocument()
  })

  it('blendet Installation-Scope ohne Plus aus (auch mit manage)', () => {
    useCapability.mockReturnValue(false)
    useAuth.mockReturnValue({ role: 'admin', portalPermissions: [] })
    render(<InventoryView />)
    expect(screen.queryByText('ansible_inventory.scope.installation')).not.toBeInTheDocument()
  })

  it('zeigt Installation-Scope bei Plus + manage_ansible_inventory', () => {
    useCapability.mockReturnValue(true)
    useAuth.mockReturnValue({ role: 'operator', portalPermissions: ['manage_ansible_inventory'] })
    render(<InventoryView />)
    expect(screen.getByText('ansible_inventory.scope.installation')).toBeInTheDocument()
  })
})

describe('InventoryView – Eigene-Sicht-Aktionen', () => {
  it('zeigt „Als verwaltet markieren" bei unmanaged und Test bei managed', () => {
    render(<InventoryView />)
    expect(screen.getByText('ansible_inventory.mark_managed')).toBeInTheDocument()
    expect(screen.getByText('ansible_inventory.test_connection')).toBeInTheDocument()
    expect(screen.getByText('ansible_inventory.reset_host_key')).toBeInTheDocument()
  })
})

describe('MarkManagedButton', () => {
  it('öffnet Bestätigung und ruft mutateAsync', () => {
    const mutateAsync = vi.fn().mockResolvedValue({})
    useMarkManaged.mockReturnValue({ mutateAsync })
    render(<MarkManagedButton host={USER_HOSTS[1]} />)
    fireEvent.click(screen.getByText('ansible_inventory.mark_managed'))
    fireEvent.click(screen.getByTestId('confirm'))
    expect(mutateAsync).toHaveBeenCalledWith({ portalNodeId: 1, kind: 'qemu', vmid: 101 })
  })
})

describe('ConnectivityTestButton (AC-VERIFY-3)', () => {
  it('zeigt „nicht verfügbar" ohne IP, keinen Button', () => {
    render(<ConnectivityTestButton host={{ portal_node_id: 1, kind: 'qemu', vmid: 101, ip: null }} />)
    expect(screen.getByText('ansible_inventory.test_unavailable')).toBeInTheDocument()
    expect(screen.queryByText('ansible_inventory.test_connection')).not.toBeInTheDocument()
  })

  it('testet und zeigt das Ergebnis bei vorhandener IP', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ ok: true, reason: 'ok' })
    useTestConnection.mockReturnValue({ mutateAsync, isPending: false })
    render(<ConnectivityTestButton host={{ portal_node_id: 1, kind: 'qemu', vmid: 100, ip: '10.0.0.5' }} />)
    fireEvent.click(screen.getByText('ansible_inventory.test_connection'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ portalNodeId: 1, kind: 'qemu', vmid: 100 }))
    expect(await screen.findByText(/test_reason.ok/)).toBeInTheDocument()
  })
})

describe('InstallationDiscoveryView', () => {
  it('listet Gäste mit Namen und Managed-/no-run-scope-Badge (AC-DISC-1/AC-RUN-2)', async () => {
    render(<InstallationDiscoveryView />)
    expect(await screen.findByText('web-1')).toBeInTheDocument()
    expect(screen.getByText('legacy')).toBeInTheDocument()
    // managed host #102 ist managed aber nicht in_run_scope → Warn-Badge
    expect(screen.getByText('ansible_inventory.no_run_scope')).toBeInTheDocument()
  })

  it('Bulk: Alle auswählen + onboarden ruft useOnboardBulk', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ onboarded: 3, skipped: 0, failed: [] })
    useOnboardBulk.mockReturnValue({ mutateAsync, isPending: false })
    render(<InstallationDiscoveryView />)
    await screen.findByText('web-1')
    fireEvent.click(screen.getByText('ansible_inventory.select_all'))
    fireEvent.click(screen.getByText('ansible_inventory.onboard_n'))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    const arg = mutateAsync.mock.calls[0][0]
    expect(arg.hosts).toHaveLength(3)
    expect(await screen.findByTestId('result')).toHaveTextContent('bulk')
  })

  it('Einzel-Onboarding ruft useOnboardHost und zeigt das Ergebnis', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ block: 'x', key_count: 1 })
    useOnboardHost.mockReturnValue({ mutateAsync, isPending: false })
    render(<InstallationDiscoveryView />)
    await screen.findByText('web-1')
    fireEvent.click(screen.getAllByText('ansible_inventory.onboard')[0])
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(await screen.findByTestId('result')).toHaveTextContent('single')
  })

  it('Filter „Nicht verwaltet" zeigt nur unmanaged', async () => {
    render(<InstallationDiscoveryView />)
    await screen.findByText('web-1')
    fireEvent.click(screen.getByText('ansible_inventory.filter.unmanaged'))
    expect(screen.queryByText('web-1')).not.toBeInTheDocument()
    expect(screen.getByText('legacy')).toBeInTheDocument()
  })
})
