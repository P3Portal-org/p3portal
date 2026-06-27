// p3portal.org
import { Suspense } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useClusterData } from '../../hooks/useClusterData'
import { useAuth } from '../../hooks/useAuth'
import { useCapabilities } from '../../hooks/useCapability'
import { PlusComponents } from '../../plus'
import ComputeNodeCard from '../../components/computenodes/ComputeNodeCard'
import ComputeVmSection from '../../components/computenodes/ComputeVmSection'
import ComputeTemplatesTab from '../../components/computenodes/ComputeTemplatesTab'
import ComputeEventsTab from '../../components/computenodes/ComputeEventsTab'
import ComputeBackupsTab from '../../components/computenodes/ComputeBackupsTab'
import ComputeBackupJobsTab from '../../components/computenodes/ComputeBackupJobsTab'
import ComputeNetworkTab from '../../components/computenodes/ComputeNetworkTab'
import NodeFirewallPanel from '../../components/firewall/NodeFirewallPanel'
import UpdatesTab from '../../features/node_updates/components/UpdatesTab'
import { useMyNodeAssignments } from '../../features/node_assignments/hooks/useNodeAssignments'
import TokenMissingBanner from '../../components/ui/TokenMissingBanner'
import NodeDetailSection from '../../components/compute/NodeDetailSection'
import VmSection from '../../components/dashboard/VmSection'
import PinIcon from '../../components/common/PinIcon'
import { usePinToggle } from '../../features/sidebar_pins/hooks/usePinToggle'
import HelpButton from '../../features/help/components/HelpButton'
import TabHelpButton from '../../features/help/components/TabHelpButton'
import Watermark from '../../components/common/Watermark'

function NodeTabPinButton({ nodeName, tabId, tabLabel }) {
  const route = `/compute?node=${encodeURIComponent(nodeName)}&tab=${tabId}`
  const { isPinned, loading, toggle, atLimit } = usePinToggle({
    route,
    pinKind: 'node_tab',
    resourceRef: nodeName,
    defaultLabel: `${nodeName} – ${tabLabel}`,
  })
  return (
    <button
      onClick={toggle}
      disabled={loading || (atLimit && !isPinned)}
      className="p-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      title={atLimit && !isPinned ? 'Pin-Limit erreicht' : isPinned ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
    >
      <PinIcon pinned={isPinned} disabled={atLimit && !isPinned} className="w-3.5 h-3.5" />
    </button>
  )
}

function ErrorBanner({ error }) {
  const status = error?.response?.status
  const msg = status === 503
    ? 'Kein Service-Account konfiguriert.'
    : status === 401
    ? 'Authentifizierung fehlgeschlagen.'
    : 'Fehler beim Laden der Cluster-Daten.'
  return (
    <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
      {msg}
    </div>
  )
}

const TABS = [
  { id: 'info',             label: 'Node Details' },
  { id: 'vms',              label: 'VM & LXC' },
  { id: 'templates',        label: 'Templates' },
  { id: 'events',           label: 'Ereignisse' },
  { id: 'updates',          label: 'Updates',          nodeAction: 'node:view_updates' },
  { id: 'backups',          label: 'Backups' },
  { id: 'backup-jobs',      label: 'Backup-Jobs',      perm: 'manage_backup_jobs' },
  { id: 'networks',         label: 'Netzwerk',         netGate: true },
  { id: 'firewall',         label: 'Firewall',         fwGate: true },
  { id: 'alerting',         label: 'Alerting',         capKey: 'compute_alerting' },
  { id: 'schedules',        label: 'Scheduled Jobs',   capKey: 'compute_scheduled_jobs' },
  { id: 'config-snapshots', label: 'Config-Snapshots', capKey: 'config_snapshots' },
]

export default function ComputeNodesPage() {
  const { nodes, vms, loading, error, refresh } = useClusterData()
  const { role, auth_type, portalPermissions } = useAuth()
  const navigate = useNavigate()

  const caps = useCapabilities()
  const ComputeAlertingTab = PlusComponents.ComputeAlertingTab
  const ComputeScheduledJobsTab = PlusComponents.ComputeScheduledJobsTab
  const AddNodeCard = PlusComponents.AddNodeCard
  const ConfigSnapshotsNodeTab = PlusComponents.ConfigSnapshotsNodeTab

  const isLocalUser = auth_type === 'local'
  const is503 = error?.response?.status === 503
  const isAdmin = role === 'admin'
  const hasPerm = (perm) => isAdmin || (portalPermissions ?? []).includes(perm)
  const canManageNodes = hasPerm('manage_nodes')

  // PROJ-79: node-scope grant for node:manage_network (third OR-branch of the
  // network tab gate). Server-side _assert_network_access is the real boundary;
  // this is only the visual tab heuristic.
  const { assignments: myNodeAssignments } = useMyNodeAssignments()
  const nodeHasNetworkScope = (nodeName) =>
    (myNodeAssignments ?? []).some(
      a => a.node_name === nodeName && (a.preset_node_actions ?? []).includes('node:manage_network'),
    )
  const canManageNetwork = (nodeName) =>
    isAdmin || hasPerm('manage_networks') || nodeHasNetworkScope(nodeName)

  // PROJ-90: same OR-gate for the optional node firewall tab (AC-UI-3).
  const nodeHasFirewallScope = (nodeName) =>
    (myNodeAssignments ?? []).some(
      a => a.node_name === nodeName && (a.preset_node_actions ?? []).includes('node:manage_firewall'),
    )
  const canManageFirewall = (nodeName) =>
    isAdmin || hasPerm('manage_firewall') || nodeHasFirewallScope(nodeName)

  const [searchParams, setSearchParams] = useSearchParams()
  const selectedNodeKey = searchParams.get('node') || null
  const activeTab = searchParams.get('tab') || 'info'

  const selectedNode = selectedNodeKey
    ? nodes.find(n => n.node === selectedNodeKey)
    : null

  const nodeVms = selectedNode
    ? vms.filter(vm => vm.node === selectedNode.node || vm.portal_node_name === selectedNode.portal_node_name)
    : vms

  function handleNodeClick(n) {
    if (selectedNodeKey === n.node) {
      setSearchParams({})
    } else {
      setSearchParams({ node: n.node, tab: 'info' })
    }
  }

  function handleTabChange(tabId) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      next.set('tab', tabId)
      return next
    })
  }

  const showAddCard = canManageNodes && (caps.multiple_nodes ?? false)
  const totalItems = nodes.length + (showAddCard ? 1 : 0)
  const gridCols = totalItems === 1 ? 'grid-cols-1' : totalItems === 2 ? 'grid-cols-2' : 'grid-cols-3'

  const nonTemplateCnt = nodeVms.filter(v => !v.template).length

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Compute Nodes</h1>
          <HelpButton helpKey="compute" />
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs text-portal-accent hover:underline disabled:opacity-40 transition-colors"
        >
          {loading ? 'Lädt…' : '↻ Aktualisieren'}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-transparent">
        {error && is503 && isLocalUser
          ? <TokenMissingBanner role={role} />
          : error && <ErrorBanner error={error} />
        }

        {/* Node Cards */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
              Nodes ({nodes.length})
            </h2>
            {selectedNodeKey && (
              <button
                onClick={() => setSearchParams({})}
                className="text-[10px] text-portal-accent hover:underline"
              >
                Auswahl aufheben ×
              </button>
            )}
          </div>

          {loading && nodes.length === 0 ? (
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-40 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />
              ))}
            </div>
          ) : (
            <div className={`grid gap-4 ${gridCols}`}>
              {nodes.map(n => (
                <ComputeNodeCard
                  key={n.node}
                  node={n}
                  selected={selectedNodeKey === n.node}
                  onClick={() => handleNodeClick(n)}
                />
              ))}
              {showAddCard && AddNodeCard && (
                <Suspense fallback={null}>
                  <AddNodeCard onClick={() => navigate('/system-settings')} />
                </Suspense>
              )}
            </div>
          )}
        </section>

        {/* Bottom section */}
        <section>
          {selectedNode ? (
            <>
              {/* Tab bar – Plus-Tabs nur bei Plus-Lizenz, nodeAction-Tabs nur für Admins/Operators */}
              <div className="flex items-center border-b border-gray-200 dark:border-zinc-700 mb-4 overflow-x-auto">
                {TABS.filter(t => {
                  if (t.capKey && !(caps[t.capKey] ?? false)) return false
                  if (t.nodeAction && !isAdmin && role !== 'operator') return false
                  if (t.perm && !hasPerm(t.perm)) return false
                  // PROJ-79: OR-gated network tab (admin OR manage_networks OR node-scope).
                  if (t.netGate && !canManageNetwork(selectedNode.node)) return false
                  // PROJ-90: OR-gated firewall tab (admin OR manage_firewall OR node-scope).
                  if (t.fwGate && !canManageFirewall(selectedNode.node)) return false
                  return true
                }).map(tab => {
                  const isActive = activeTab === tab.id
                  return (
                    <button
                      key={tab.id}
                      onClick={() => handleTabChange(tab.id)}
                      className={`px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                        isActive
                          ? 'border-portal-accent/50 text-portal-accent'
                          : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
                      }`}
                    >
                      {tab.label}
                      {tab.id === 'vms' && (
                        <span className="tabular-nums text-[10px] text-gray-400 dark:text-zinc-500">
                          ({nonTemplateCnt})
                        </span>
                      )}
                      {tab.id === 'info' && (
                        <span className="text-[10px] font-mono text-gray-400 dark:text-zinc-500">
                          {selectedNode.node}
                        </span>
                      )}
                      {tab.capKey && (caps[tab.capKey] ?? false) && (
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5 text-portal-success shrink-0" aria-hidden="true">
                          <rect x="4" y="9" width="12" height="10" rx="2" />
                          <path d="M7 9V6a3 3 0 0 1 5.83-1" />
                          <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
                        </svg>
                      )}
                      {tab.id === 'alerting' && <TabHelpButton helpKey="compute.tabs.alerting" />}
                      {tab.id === 'schedules' && <TabHelpButton helpKey="compute.tabs.scheduled_jobs" />}
                    </button>
                  )
                })}
              </div>

              <div className="flex justify-end mb-2">
                <NodeTabPinButton
                  nodeName={selectedNode.node}
                  tabId={activeTab}
                  tabLabel={TABS.find(t => t.id === activeTab)?.label ?? activeTab}
                />
              </div>

              {activeTab === 'vms'       && <ComputeVmSection vms={nodeVms} loading={loading} />}
              {activeTab === 'info'      && <NodeDetailSection nodeName={selectedNode.node} />}
              {activeTab === 'templates' && <ComputeTemplatesTab vms={nodeVms} loading={loading} />}
              {activeTab === 'events'    && <ComputeEventsTab nodeName={selectedNode.node} active={activeTab === 'events'} />}
              {activeTab === 'updates'   && <UpdatesTab portalNodeId={selectedNode.portal_node_id} active={activeTab === 'updates'} />}
              {activeTab === 'backups'   && <ComputeBackupsTab nodeName={selectedNode.node} active={activeTab === 'backups'} />}
              {activeTab === 'backup-jobs' && <ComputeBackupJobsTab nodeName={selectedNode.node} active={activeTab === 'backup-jobs'} />}
              {activeTab === 'networks'    && canManageNetwork(selectedNode.node) && <ComputeNetworkTab nodeName={selectedNode.node} active={activeTab === 'networks'} />}
              {activeTab === 'firewall'    && canManageFirewall(selectedNode.node) && <NodeFirewallPanel nodeName={selectedNode.node} installation={selectedNode.portal_node_id} active={activeTab === 'firewall'} />}
              {activeTab === 'alerting' && (caps.compute_alerting ?? false) && ComputeAlertingTab && (
                <Suspense fallback={null}>
                  <ComputeAlertingTab nodeName={selectedNode.node} active={activeTab === 'alerting'} />
                </Suspense>
              )}
              {activeTab === 'schedules' && (caps.compute_scheduled_jobs ?? false) && ComputeScheduledJobsTab && (
                <Suspense fallback={null}>
                  <ComputeScheduledJobsTab nodeName={selectedNode.node} active={activeTab === 'schedules'} />
                </Suspense>
              )}
              {activeTab === 'config-snapshots' && (caps.config_snapshots ?? false) && ConfigSnapshotsNodeTab && (
                <Suspense fallback={null}>
                  <ConfigSnapshotsNodeTab portalNodeId={selectedNode.portal_node_id} active={activeTab === 'config-snapshots'} />
                </Suspense>
              )}
            </>
          ) : (
            <VmSection vms={vms} loading={loading} userRole={role} onRefresh={refresh} />
          )}
        </section>
        <Watermark />
      </main>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
