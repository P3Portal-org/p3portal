// p3portal.org
import { useParams } from 'react-router-dom'
import { useClusterData } from '../../hooks/useClusterData'
import { useAuth } from '../../hooks/useAuth'
import ComputeBreadcrumb from '../../components/compute/ComputeBreadcrumb'
import NodeDetailSection from '../../components/compute/NodeDetailSection'
import VmSection from '../../components/dashboard/VmSection'
import PinIcon from '../../components/common/PinIcon'
import { usePinToggle } from '../../features/sidebar_pins/hooks/usePinToggle'
import Watermark from '../../components/common/Watermark'

export default function NodeDetailPage() {
  const { node } = useParams()
  const { vms, loading, refresh } = useClusterData()
  const { role } = useAuth()

  const nodeVms = vms.filter(vm => vm.node === node || vm.portal_node_name === node)

  const { isPinned, loading: pinLoading, toggle: pinToggle, atLimit } = usePinToggle({
    route: `/compute/${node}`,
    pinKind: 'node',
    defaultLabel: node,
  })

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <ComputeBreadcrumb node={node} />
          <button
            onClick={pinToggle}
            disabled={pinLoading || (atLimit && !isPinned)}
            className="p-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title={atLimit && !isPinned ? 'Pin-Limit erreicht' : isPinned ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
          >
            <PinIcon pinned={isPinned} disabled={atLimit && !isPinned} className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs text-portal-accent hover:underline disabled:opacity-40 transition-colors"
        >
          {loading ? 'Lädt…' : '↻ Aktualisieren'}
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-8 bg-transparent">
        <NodeDetailSection nodeName={node} />
        <VmSection
          vms={nodeVms}
          loading={loading}
          userRole={role}
          onRefresh={refresh}
        />
        <Watermark />
      </main>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
