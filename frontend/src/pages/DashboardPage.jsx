// p3portal.org
import { Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useClusterData } from '../hooks/useClusterData'
import { useAuth } from '../hooks/useAuth'
import { useCapability } from '../hooks/useCapability'
import { PlusComponents } from '../plus'
import ClusterHealthBanner from '../components/dashboard/ClusterHealthBanner'
import AnnouncementsBanner from '../components/dashboard/AnnouncementsBanner'
import AlertsBanner from '../components/dashboard/AlertsBanner'
import NodeSection from '../components/dashboard/NodeSection'
import VmSection from '../components/dashboard/VmSection'
import TokenMissingBanner from '../components/ui/TokenMissingBanner'
import HelpButton from '../features/help/components/HelpButton'
import NotificationDashboardRow from '../features/notifications/components/NotificationDashboardRow'
import LazyErrorBoundary from '../components/common/LazyErrorBoundary'
import Watermark from '../components/common/Watermark'

function LastUpdated({ date, onRefresh, loading }) {
  const { t, i18n } = useTranslation()
  if (!date && !loading) return null
  const locale = i18n.language === 'en' ? 'en-GB' : 'de-DE'
  return (
    <div className="flex items-center gap-3 text-xs dark:text-zinc-500 text-gray-500">
      {date && <span>{t('dashboard.last_updated', { time: date.toLocaleTimeString(locale) })}</span>}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="text-orange-500 hover:underline disabled:opacity-40 transition-colors"
      >
        {loading ? t('dashboard.refreshing') : t('dashboard.refresh')}
      </button>
    </div>
  )
}

function ErrorBanner({ error, isLocalUser }) {
  const { t } = useTranslation()
  const status = error?.response?.status

  if (status === 503 && isLocalUser) {
    // Fehlender Service-Account – gezielt anzeigen
    return null
  }

  const msg =
    status === 503
      ? t('dashboard.err_503')
      : status === 401
      ? t('dashboard.err_401')
      : t('dashboard.err_default')

  return (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
      {t('dashboard.err_prefix')}{msg}
    </div>
  )
}

export default function DashboardPage() {
  const { t } = useTranslation()
  const { nodes, vms, clusterStatus, loading, refreshing, error, lastUpdated, refresh } = useClusterData()
  const { role, auth_type } = useAuth()

  const isLocalUser = auth_type === 'local'
  const is503 = error?.response?.status === 503

  const [selectedNode, setSelectedNode] = useState(null)

  // PROJ-75: Topologie-Tab (Plus-only). Widget + Tab nur wenn Capability aktiv.
  const canTopology = useCapability('topology')
  const TopologyWidget = PlusComponents.TopologyWidget
  const TopologyTab = PlusComponents.TopologyTab
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = canTopology && searchParams.get('tab') === 'topology' ? 'topology' : 'overview'

  const tabCls = (active) =>
    `relative px-3 h-12 inline-flex items-center text-sm border-b-2 transition-colors ${
      active
        ? 'border-[var(--accent)] text-gray-900 dark:text-zinc-100 font-medium'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  const goTab = (tab) => {
    const next = new URLSearchParams(searchParams)
    if (tab === 'overview') next.delete('tab')
    else next.set('tab', tab)
    setSearchParams(next)
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('dashboard.title')}</h1>
          <HelpButton helpKey="dashboard" />
          {canTopology && (
            <nav className="ml-4 flex items-center gap-1 self-stretch -mb-px">
              <button className={tabCls(activeTab === 'overview')} onClick={() => goTab('overview')}>
                {t('dashboard.tab_overview')}
              </button>
              <button className={tabCls(activeTab === 'topology')} onClick={() => goTab('topology')}>
                {t('topology.tab')}
              </button>
            </nav>
          )}
        </div>
        {activeTab === 'overview' && (
          <LastUpdated date={lastUpdated} onRefresh={refresh} loading={loading || refreshing} />
        )}
      </header>

      {activeTab === 'topology' && TopologyTab ? (
        <LazyErrorBoundary message={t('topology.unavailable')}>
          <Suspense fallback={<div className="flex items-center justify-center flex-1 text-sm text-gray-400 dark:text-zinc-500">{t('topology.loading')}</div>}>
            <TopologyTab />
          </Suspense>
        </LazyErrorBoundary>
      ) : (
        <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6 bg-transparent">
          {error && is503 && isLocalUser
            ? <TokenMissingBanner role={role} />
            : error && <ErrorBanner error={error} isLocalUser={isLocalUser} />
          }
          <AnnouncementsBanner />
          <AlertsBanner />
          <ClusterHealthBanner status={clusterStatus} unreachable_nodes={clusterStatus?.unreachable_nodes ?? []} />
          <NotificationDashboardRow />
          {canTopology && TopologyWidget && (
            <LazyErrorBoundary message={t('topology.unavailable')} fallback={null}>
              <Suspense fallback={null}>
                <TopologyWidget />
              </Suspense>
            </LazyErrorBoundary>
          )}
          <NodeSection nodes={nodes} loading={loading} selectedNode={selectedNode} onNodeSelect={setSelectedNode} />
          <VmSection vms={vms} loading={loading} userRole={role} onRefresh={refresh} selectedNode={selectedNode} onNodeSelect={setSelectedNode} />
          <Watermark />
        </main>
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
