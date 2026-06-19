// p3portal.org
/**
 * PROJ-90: "Firewall" page – bundles two firewall areas behind one sidebar entry
 * (Muster PROJ-80 NetworkPage):
 *   1. Datacenter – options / security-groups / IPSets / aliases / rules, per
 *      Proxmox installation (Installations-Auswahl bei >1 Installation).
 *   2. Node – per-host options + rules behind a node <select>.
 *
 * Area visibility is gated (AC-UI-1 / AC-RBAC-1): Datacenter for admin/
 * manage_firewall; Node also for node:manage_firewall. The server (_assert_dc_/
 * _assert_node_firewall_access) is the real boundary; this is the cosmetic content
 * gate too. VM-level firewall lives as a tab on the VM detail page (AC-UI-2), not here.
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useMyNodeAssignments } from '../../features/node_assignments/hooks/useNodeAssignments'
import { getNodes } from '../../api/cluster'
import DatacenterFirewallPanel from '../../components/firewall/DatacenterFirewallPanel'
import NodeFirewallPanel from '../../components/firewall/NodeFirewallPanel'
import Watermark from '../../components/common/Watermark'
import HelpButton from '../../features/help/components/HelpButton'

export default function FirewallPage() {
  const { role, portalPermissions } = useAuth()
  const isAdmin = role === 'admin'
  const hasPerm = (perm) => isAdmin || (portalPermissions ?? []).includes(perm)
  const { assignments: myNodeAssignments } = useMyNodeAssignments()

  // Node-scope grant for node:manage_firewall (third OR-branch of the Node area).
  const firewallScopeNodes = useMemo(
    () => (myNodeAssignments ?? [])
      .filter(a => (a.preset_node_actions ?? []).includes('node:manage_firewall'))
      .map(a => a.node_name),
    [myNodeAssignments],
  )

  const canSeeDc   = isAdmin || hasPerm('manage_firewall')
  const canSeeNode = isAdmin || hasPerm('manage_firewall') || firewallScopeNodes.length > 0

  const [searchParams, setSearchParams] = useSearchParams()
  const requestedArea = searchParams.get('area')
  const area = requestedArea === 'node'
    ? 'node'
    : requestedArea === 'datacenter'
      ? 'datacenter'
      : (canSeeDc ? 'datacenter' : 'node')

  function setArea(next) {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('area', next)
      return p
    })
  }

  const [rawNodes, setRawNodes] = useState([])
  const [selectedNode, setSelectedNode] = useState('')              // node area: member node name
  const [selectedInstallation, setSelectedInstallation] = useState(null) // dc area: portal_node_id
  const [nodesLoading, setNodesLoading] = useState(false)

  const canManageAllFirewall = isAdmin || hasPerm('manage_firewall')

  useEffect(() => {
    if (!canSeeDc && !canSeeNode) return
    setNodesLoading(true)
    getNodes()
      .then(list => setRawNodes(Array.isArray(list) ? list : []))
      .catch(() => setRawNodes([]))
      .finally(() => setNodesLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeDc, canSeeNode, firewallScopeNodes.join(',')])

  // Node selector: cosmetically restricted to the nodes the user may manage.
  const nodes = useMemo(() => {
    if (!canSeeNode) return []
    return canManageAllFirewall ? rawNodes : rawNodes.filter(n => firewallScopeNodes.includes(n.node))
  }, [rawNodes, canSeeNode, canManageAllFirewall, firewallScopeNodes])

  useEffect(() => { setSelectedNode(prev => prev || nodes[0]?.node || '') }, [nodes])

  // Datacenter installations = distinct portal nodes (each = one /cluster/firewall).
  const installations = useMemo(() => {
    const seen = new Map()
    for (const n of rawNodes) {
      const id = n.portal_node_id
      if (id == null || seen.has(id)) continue
      seen.set(id, { id, name: n.portal_node_name || n.node })
    }
    return [...seen.values()]
  }, [rawNodes])

  useEffect(() => {
    setSelectedInstallation(prev => (prev != null ? prev : installations[0]?.id ?? null))
  }, [installations])

  // The node's installation id (for the Node panel's macro/SG dropdowns).
  const selectedNodeInstallation = useMemo(
    () => rawNodes.find(n => n.node === selectedNode)?.portal_node_id ?? null,
    [rawNodes, selectedNode],
  )

  const tabCls = (active) =>
    `px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
      active
        ? 'border-portal-accent text-portal-accent'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Firewall</h1>
          <HelpButton helpKey="firewall" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 bg-transparent">
        {/* Area tabs */}
        <div className="flex items-center border-b border-gray-200 dark:border-zinc-700 mb-5 overflow-x-auto">
          {canSeeDc && (
            <button onClick={() => setArea('datacenter')} className={tabCls(area === 'datacenter')}>Datacenter</button>
          )}
          {canSeeNode && (
            <button onClick={() => setArea('node')} className={tabCls(area === 'node')}>Node</button>
          )}
        </div>

        {/* Datacenter area */}
        {area === 'datacenter' && canSeeDc && (
          <div className="space-y-4">
            {installations.length > 1 && (
              <div className="flex items-center gap-3 flex-wrap">
                <label htmlFor="fw-install" className="text-xs font-medium text-gray-600 dark:text-zinc-400">Installation</label>
                <select
                  id="fw-install"
                  value={selectedInstallation ?? ''}
                  onChange={e => setSelectedInstallation(e.target.value ? Number(e.target.value) : null)}
                  disabled={nodesLoading}
                  className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent min-w-[180px]"
                >
                  {installations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <span className="text-[11px] text-gray-400 dark:text-zinc-500">
                  Die Datacenter-Firewall ist pro Proxmox-Installation getrennt.
                </span>
              </div>
            )}
            <DatacenterFirewallPanel key={selectedInstallation ?? 'default'} installation={selectedInstallation} />
          </div>
        )}
        {area === 'datacenter' && !canSeeDc && (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">Kein Zugriff auf die Datacenter-Firewall.</p>
        )}

        {/* Node area */}
        {area === 'node' && canSeeNode && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label htmlFor="fw-node" className="text-xs font-medium text-gray-600 dark:text-zinc-400">Node</label>
              <select
                id="fw-node"
                value={selectedNode}
                onChange={e => setSelectedNode(e.target.value)}
                disabled={nodesLoading || nodes.length === 0}
                className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent min-w-[180px]"
              >
                {nodes.length === 0 && <option value="">{nodesLoading ? 'Lädt…' : 'Keine Nodes'}</option>}
                {nodes.map(n => <option key={n.node} value={n.node}>{n.node}</option>)}
              </select>
            </div>
            {selectedNode
              ? <NodeFirewallPanel key={selectedNode} nodeName={selectedNode} installation={selectedNodeInstallation} active={true} />
              : !nodesLoading && (
                  <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">Keine verwaltbaren Nodes verfügbar.</p>
                )}
          </div>
        )}
        {area === 'node' && !canSeeNode && (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">Kein Zugriff auf die Node-Firewall.</p>
        )}

        <Watermark />
      </main>
    </div>
  )
}
