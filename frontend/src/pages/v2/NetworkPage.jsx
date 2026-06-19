// p3portal.org
/**
 * PROJ-80: "Netzwerk" page – bundles two network areas behind one sidebar entry:
 *   1. Node-Interfaces – per-node bridges/VLANs (PROJ-79) behind a node <select>.
 *      Reuses the existing ComputeNetworkTab unchanged (zero logic duplication);
 *      the per-node Compute tab (PROJ-79) keeps working independently.
 *   2. SDN (Cluster) – cluster-wide zones/vnets/subnets (PROJ-80).
 *
 * Area visibility is gated (AC-NAV-5): Node-Interfaces for admin/manage_networks/
 * node:manage_network, SDN for admin/manage_sdn. The server (_assert_network_access
 * / _assert_sdn_access) is the real boundary; this is the cosmetic content gate too
 * (BUG-79-3 lesson: gate the content, not just the tab).
 */
import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useMyNodeAssignments } from '../../features/node_assignments/hooks/useNodeAssignments'
import { getNodes } from '../../api/cluster'
import ComputeNetworkTab from '../../components/computenodes/ComputeNetworkTab'
import SdnManagementTab from '../../components/sdn/SdnManagementTab'
import Watermark from '../../components/common/Watermark'
import HelpButton from '../../features/help/components/HelpButton'

export default function NetworkPage() {
  const { role, portalPermissions } = useAuth()
  const isAdmin = role === 'admin'
  const hasPerm = (perm) => isAdmin || (portalPermissions ?? []).includes(perm)
  const { assignments: myNodeAssignments } = useMyNodeAssignments()

  // Node-scope grant for node:manage_network (third OR-branch). Server-side
  // _assert_network_access is the real boundary; this only filters the node list.
  const networkScopeNodes = useMemo(
    () => (myNodeAssignments ?? [])
      .filter(a => (a.preset_node_actions ?? []).includes('node:manage_network'))
      .map(a => a.node_name),
    [myNodeAssignments],
  )

  const canSeeNode = isAdmin || hasPerm('manage_networks') || networkScopeNodes.length > 0
  const canSeeSdn  = isAdmin || hasPerm('manage_sdn')

  const [searchParams, setSearchParams] = useSearchParams()
  const requestedArea = searchParams.get('area')
  // Default area: node-interfaces if allowed, else sdn.
  const area = requestedArea === 'sdn'
    ? 'sdn'
    : requestedArea === 'node-interfaces'
      ? 'node-interfaces'
      : (canSeeNode ? 'node-interfaces' : 'sdn')

  function setArea(next) {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev)
      p.set('area', next)
      return p
    })
  }

  // ── Node list (member nodes across all installations) ────────────────────────
  // Loaded for either area: Node-Interfaces needs the member-node list, SDN needs
  // the distinct installations (one /cluster/sdn each).
  const [rawNodes, setRawNodes]   = useState([])
  const [selectedNode, setSelectedNode] = useState('')           // node-interfaces: member node name
  const [selectedInstallation, setSelectedInstallation] = useState(null)  // SDN: portal_node_id
  const [nodesLoading, setNodesLoading] = useState(false)

  const canManageAllNetworks = isAdmin || hasPerm('manage_networks')

  useEffect(() => {
    if (!canSeeNode && !canSeeSdn) return
    setNodesLoading(true)
    getNodes()
      .then(list => setRawNodes(Array.isArray(list) ? list : []))
      .catch(() => setRawNodes([]))
      .finally(() => setNodesLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeNode, canSeeSdn, networkScopeNodes.join(',')])

  // Node-Interfaces selector: cosmetically restricted to the nodes the user may manage.
  const nodes = useMemo(() => {
    if (!canSeeNode) return []
    return canManageAllNetworks ? rawNodes : rawNodes.filter(n => networkScopeNodes.includes(n.node))
  }, [rawNodes, canSeeNode, canManageAllNetworks, networkScopeNodes])

  useEffect(() => { setSelectedNode(prev => prev || nodes[0]?.node || '') }, [nodes])

  // SDN installations = distinct portal nodes (each = one independent Proxmox
  // installation with its own /cluster/sdn). For two standalone nodes this yields
  // two entries; for one cluster it collapses to one.
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
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Netzwerk</h1>
          <HelpButton helpKey="network" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 bg-transparent">
        {/* Area tabs */}
        <div className="flex items-center border-b border-gray-200 dark:border-zinc-700 mb-5 overflow-x-auto">
          {canSeeNode && (
            <button onClick={() => setArea('node-interfaces')} className={tabCls(area === 'node-interfaces')}>
              Node-Interfaces
            </button>
          )}
          {canSeeSdn && (
            <button onClick={() => setArea('sdn')} className={tabCls(area === 'sdn')}>
              SDN (Cluster)
            </button>
          )}
        </div>

        {/* Node-Interfaces area (PROJ-79 reuse behind a node selector) */}
        {area === 'node-interfaces' && canSeeNode && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <label htmlFor="net-node" className="text-xs font-medium text-gray-600 dark:text-zinc-400">Node</label>
              <select
                id="net-node"
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
              ? <ComputeNetworkTab nodeName={selectedNode} active={true} />
              : !nodesLoading && (
                  <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">
                    Keine verwaltbaren Nodes verfügbar.
                  </p>
                )}
          </div>
        )}

        {/* Node-Interfaces selected but not allowed */}
        {area === 'node-interfaces' && !canSeeNode && (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">
            Kein Zugriff auf die Node-Netzwerk-Verwaltung.
          </p>
        )}

        {/* SDN area */}
        {area === 'sdn' && canSeeSdn && (
          <div className="space-y-4">
            {installations.length > 1 && (
              <div className="flex items-center gap-3 flex-wrap">
                <label htmlFor="sdn-install" className="text-xs font-medium text-gray-600 dark:text-zinc-400">Installation</label>
                <select
                  id="sdn-install"
                  value={selectedInstallation ?? ''}
                  onChange={e => setSelectedInstallation(e.target.value ? Number(e.target.value) : null)}
                  disabled={nodesLoading}
                  className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent min-w-[180px]"
                >
                  {installations.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <span className="text-[11px] text-gray-400 dark:text-zinc-500">
                  SDN ist pro Proxmox-Installation getrennt.
                </span>
              </div>
            )}
            <SdnManagementTab key={selectedInstallation ?? 'default'} portalNodeId={selectedInstallation} />
          </div>
        )}
        {area === 'sdn' && !canSeeSdn && (
          <p className="text-sm text-gray-400 dark:text-zinc-500 py-8 text-center">
            Kein Zugriff auf die SDN-Verwaltung.
          </p>
        )}

        <Watermark />
      </main>
    </div>
  )
}
