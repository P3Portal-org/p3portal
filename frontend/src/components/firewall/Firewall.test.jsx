// p3portal.org
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

// firewallErrMsg is the only thing these components import from the api module.
vi.mock('../../api/firewall', () => ({
  firewallErrMsg: (err) => err?.response?.data?.detail || 'Fehler',
}))

import FirewallRulesTable from './FirewallRulesTable'
import FirewallRuleFormModal from './FirewallRuleFormModal'
import FirewallOptionsForm from './FirewallOptionsForm'

const RULES = {
  rules: [
    { pos: 0, type: 'in', action: 'ACCEPT', enable: true, source: '10.0.0.0/24', dest: null, proto: 'tcp', dport: '443', comment: 'web' },
    { pos: 1, type: 'in', action: 'DROP', enable: false, source: null, dest: null, comment: 'block all' },
    { pos: 2, type: 'group', action: 'webservers', enable: true, comment: 'sg ref' },
  ],
}

function rulesApi() {
  return {
    create: vi.fn().mockResolvedValue(),
    update: vi.fn().mockResolvedValue(),
    move: vi.fn().mockResolvedValue(),
    del: vi.fn().mockResolvedValue(),
  }
}

describe('FirewallRulesTable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-LIST-1: lists rules in evaluation order with action + source', () => {
    render(<FirewallRulesTable rulesData={RULES} rulesApi={rulesApi()} />)
    expect(screen.getByText('ACCEPT')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.0/24')).toBeInTheDocument()
    // group rule renders "→ webservers"
    expect(screen.getByText('→ webservers')).toBeInTheDocument()
  })

  it('AC-LIST-4: shows permission_denied banner instead of a silent empty list', () => {
    render(<FirewallRulesTable rulesData={{ permission_denied: true }} rulesApi={rulesApi()} />)
    expect(screen.getByText(/Kein Zugriff in Proxmox/)).toBeInTheDocument()
  })

  it('AC-LIST-5: shows node-unreachable banner with cause', () => {
    render(<FirewallRulesTable rulesData={{ node_unreachable: true, detail: 'HTTP 500' }} rulesApi={rulesApi()} />)
    expect(screen.getByText(/Nicht erreichbar/)).toBeInTheDocument()
    expect(screen.getByText(/HTTP 500/)).toBeInTheDocument()
  })

  it('AC-LIST-6: search filters rules by comment', () => {
    render(<FirewallRulesTable rulesData={RULES} rulesApi={rulesApi()} />)
    fireEvent.change(screen.getByPlaceholderText(/Suche/), { target: { value: 'web' } })
    expect(screen.getByText('ACCEPT')).toBeInTheDocument()
    expect(screen.queryByText('→ webservers')).toBeInTheDocument() // 'sg ref'? no — 'web' matches 'webservers' action
    expect(screen.queryByText(/block all/)).not.toBeInTheDocument()
  })

  it('AC-RULE-5: enable toggle calls update with flipped enable', async () => {
    const api = rulesApi()
    render(<FirewallRulesTable rulesData={RULES} rulesApi={api} />)
    // The first rule (pos 0) is enabled → toggle title "Deaktivieren"
    fireEvent.click(screen.getAllByTitle('Deaktivieren')[0])
    await waitFor(() => expect(api.update).toHaveBeenCalled())
    expect(api.update.mock.calls[0][0]).toBe(0)
    expect(api.update.mock.calls[0][1].enable).toBe(false)
  })

  it('AC-ORDER-1: move up disabled on first, move down disabled on last rule', () => {
    render(<FirewallRulesTable rulesData={RULES} rulesApi={rulesApi()} />)
    const ups = screen.getAllByTitle('Nach oben')
    const downs = screen.getAllByTitle('Nach unten')
    expect(ups[0]).toBeDisabled()        // first rule cannot move up
    expect(downs[downs.length - 1]).toBeDisabled() // last rule cannot move down
  })

  it('AC-RULE-3: opens the create-rule modal', () => {
    render(<FirewallRulesTable rulesData={RULES} rulesApi={rulesApi()} />)
    fireEvent.click(screen.getByText('+ Regel anlegen'))
    expect(screen.getByText('Firewall-Regel anlegen')).toBeInTheDocument()
  })
})

describe('FirewallRuleFormModal', () => {
  it('AC-RULE-1/EC-4: macro vs custom toggle switches between macro dropdown and proto fields', () => {
    render(
      <FirewallRuleFormModal
        rule={null}
        rulesApi={rulesApi()}
        macros={[{ macro: 'HTTP', descr: 'Web' }]}
        securityGroups={[]}
        onClose={() => {}}
      />,
    )
    // default mode = custom → proto dropdown visible
    expect(screen.getByText('– Protokoll wählen –')).toBeInTheDocument()
    // switch to macro mode → macro dropdown appears, proto dropdown gone
    fireEvent.click(screen.getByLabelText(/Macro \(vordefinierter Dienst\)/))
    expect(screen.getByText('– Macro wählen –')).toBeInTheDocument()
    expect(screen.queryByText('– Protokoll wählen –')).not.toBeInTheDocument()
  })

  it('AC-RULE-1: protocol and interface are dropdowns (proto options + iface suggestions)', () => {
    render(
      <FirewallRuleFormModal
        rule={null}
        rulesApi={rulesApi()}
        macros={[]}
        securityGroups={[]}
        ifaceOptions={['net0', 'net1']}
        onClose={() => {}}
      />,
    )
    // proto dropdown carries common protocols + the "Eigener Wert…" escape
    const proto = screen.getByLabelText('Protokoll')
    expect(proto.tagName).toBe('SELECT')
    expect(screen.getAllByRole('option', { name: 'tcp' }).length).toBeGreaterThan(0)
    // interface dropdown carries the passed suggestions
    const iface = screen.getByLabelText('Interface (optional)')
    expect(iface.tagName).toBe('SELECT')
    expect(screen.getByRole('option', { name: 'net0' })).toBeInTheDocument()
    expect(screen.getAllByRole('option', { name: 'Eigener Wert…' }).length).toBeGreaterThan(0)
  })

  it('AC-RULE-1: source/dest offer an Alias/IPSet reference dropdown (like Proxmox)', () => {
    render(
      <FirewallRuleFormModal
        rule={null}
        rulesApi={rulesApi()}
        macros={[]}
        securityGroups={[]}
        refs={[
          { type: 'ipset', name: 'test1-all', comment: 'All subnets' },
          { type: 'alias', name: 'gateway', comment: 'GW' },
        ]}
        onClose={() => {}}
      />,
    )
    // the ref-insert dropdown is present with the ipset shown as +name and the alias by name
    expect(screen.getAllByRole('option', { name: /\+test1-all/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('option', { name: /gateway/ }).length).toBeGreaterThan(0)
  })

  it('AC-RULE-1: ICMP type field replaces ports when protocol is icmp', () => {
    render(
      <FirewallRuleFormModal rule={null} rulesApi={rulesApi()} macros={[]} securityGroups={[]} onClose={() => {}} />,
    )
    // ports visible for the default (no proto)
    expect(screen.getByLabelText('Ziel-Port(s)')).toBeInTheDocument()
    // pick icmp → ICMP type field appears, ports disappear
    fireEvent.change(screen.getByLabelText('Protokoll'), { target: { value: 'icmp' } })
    expect(screen.getByLabelText('ICMP-Typ')).toBeInTheDocument()
    expect(screen.queryByLabelText('Ziel-Port(s)')).not.toBeInTheDocument()
  })

  it('AC-RULE-1: group direction shows a security-group action dropdown', () => {
    render(
      <FirewallRuleFormModal
        rule={null}
        rulesApi={rulesApi()}
        macros={[]}
        securityGroups={[{ group: 'webservers' }]}
        onClose={() => {}}
      />,
    )
    fireEvent.change(screen.getByLabelText(/Richtung/), { target: { value: 'group' } })
    expect(screen.getByText('– Security-Group wählen –')).toBeInTheDocument()
  })
})

describe('FirewallOptionsForm', () => {
  it('AC-OPT-3: datacenter enable is shown read-only (not a checkbox)', () => {
    render(<FirewallOptionsForm level="datacenter" options={{ enable: false, policy_in: 'ACCEPT' }} onSave={vi.fn()} />)
    expect(screen.getByText(/Globale Firewall:/)).toBeInTheDocument()
    expect(screen.getByText(/nur lesbar/)).toBeInTheDocument()
    // No "enable" checkbox at datacenter level
    expect(screen.queryByLabelText(/Node aktiviert/)).not.toBeInTheDocument()
  })

  it('AC-OPT-4: enabling a guest firewall with DROP default policy shows a soft warning', () => {
    render(<FirewallOptionsForm level="guest" options={{ enable: false, policy_in: 'DROP' }} onSave={vi.fn()} />)
    // toggle enable on
    fireEvent.click(screen.getByLabelText(/Firewall für diesen Gast aktiviert/))
    expect(screen.getByText(/kann bei einer/)).toBeInTheDocument()
  })
})

describe('FirewallPage gating', () => {
  beforeEach(() => vi.resetModules())

  it('AC-UI-1: shows the Datacenter area for a manage_firewall user', async () => {
    vi.doMock('../../hooks/useAuth', () => ({ useAuth: () => ({ role: 'operator', portalPermissions: ['manage_firewall'] }) }))
    vi.doMock('../../features/node_assignments/hooks/useNodeAssignments', () => ({ useMyNodeAssignments: () => ({ assignments: [] }) }))
    vi.doMock('../../api/cluster', () => ({ getNodes: vi.fn().mockResolvedValue([{ node: 'pve1', portal_node_id: 1, portal_node_name: 'inst1' }]) }))
    vi.doMock('../../components/firewall/DatacenterFirewallPanel', () => ({ default: () => <div data-testid="dc-panel" /> }))
    vi.doMock('../../components/firewall/NodeFirewallPanel', () => ({ default: () => <div data-testid="node-panel" /> }))
    const { default: FirewallPage } = await import('../../pages/v2/FirewallPage')
    render(<MemoryRouter initialEntries={['/firewall']}><FirewallPage /></MemoryRouter>)
    await screen.findByTestId('dc-panel')
    expect(screen.getByRole('button', { name: 'Datacenter' })).toBeInTheDocument()
  })

  it('AC-RBAC-1: a node:manage_firewall-only user sees the Node area but not Datacenter', async () => {
    vi.doMock('../../hooks/useAuth', () => ({ useAuth: () => ({ role: 'operator', portalPermissions: [] }) }))
    vi.doMock('../../features/node_assignments/hooks/useNodeAssignments', () => ({
      useMyNodeAssignments: () => ({ assignments: [{ node_name: 'pve1', preset_node_actions: ['node:manage_firewall'] }] }),
    }))
    vi.doMock('../../api/cluster', () => ({ getNodes: vi.fn().mockResolvedValue([{ node: 'pve1', portal_node_id: 1 }]) }))
    vi.doMock('../../components/firewall/DatacenterFirewallPanel', () => ({ default: () => <div data-testid="dc-panel" /> }))
    vi.doMock('../../components/firewall/NodeFirewallPanel', () => ({ default: () => <div data-testid="node-panel" /> }))
    const { default: FirewallPage } = await import('../../pages/v2/FirewallPage')
    render(<MemoryRouter initialEntries={['/firewall']}><FirewallPage /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Node' })
    expect(screen.queryByRole('button', { name: 'Datacenter' })).not.toBeInTheDocument()
  })
})
