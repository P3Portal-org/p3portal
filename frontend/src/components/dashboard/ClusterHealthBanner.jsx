// p3portal.org
import { useState } from 'react'

function haLabel(ha) {
  if (!ha || ha === 'none') return 'HA nicht konfiguriert'
  if (ha === 'active') return 'HA aktiv'
  return `HA: ${ha}`
}

function CloseButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="ml-auto text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
      aria-label="Ausblenden"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}

const SESSION_KEY = 'p3-cluster-banner-dismissed'
const UNREACHABLE_KEY = 'p3-unreachable-banner-dismissed'

export default function ClusterHealthBanner({ status, unreachable_nodes = [] }) {
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === 'true'
  )
  const [unreachableDismissed, setUnreachableDismissed] = useState(
    () => sessionStorage.getItem(UNREACHABLE_KEY) === 'true'
  )

  const dismiss = () => {
    sessionStorage.setItem(SESSION_KEY, 'true')
    setDismissed(true)
  }

  const dismissUnreachable = () => {
    sessionStorage.setItem(UNREACHABLE_KEY, 'true')
    setUnreachableDismissed(true)
  }

  const showUnreachable = unreachable_nodes.length > 0 && !unreachableDismissed
  const showCluster = status && status.node_count !== 1 && !dismissed

  if (!showUnreachable && !showCluster) return null

  let clusterVariant = null
  if (showCluster) {
    const hasQuorum = status.quorum
    const haStatus = status.ha_status
    clusterVariant = !hasQuorum
      ? { bg: 'border-portal-danger/30 bg-portal-danger/10 bg-portal-danger/10', icon: '⚠', text: 'text-portal-danger', label: 'Kein Quorum – Cluster nicht funktionsfähig' }
      : haStatus === 'active'
      ? { bg: 'border-portal-success/30 bg-portal-success/10 bg-portal-success/10', icon: '✓', text: 'text-portal-success', label: `Cluster OK · ${status.node_count ?? '?'} Nodes · ${haLabel(haStatus)}` }
      : { bg: 'border-portal-warn/30 bg-portal-warn/10 bg-portal-warn/10', icon: '⚠', text: 'text-portal-warn', label: `Quorum OK · ${status.node_count ?? '?'} Nodes · ${haLabel(haStatus)}` }
  }

  return (
    <div className="space-y-2">
      {showUnreachable && (
        <div className="flex items-center gap-3 border border-portal-accent/30 bg-portal-accent/10 rounded-lg px-4 py-2.5 text-sm">
          <span className="font-bold text-portal-accent">⚠</span>
          <span className="flex-1 text-portal-accent">
            Nicht erreichbar: {unreachable_nodes.join(', ')}
          </span>
          <CloseButton onClick={dismissUnreachable} />
        </div>
      )}
      {showCluster && clusterVariant && (
        <div className={`flex items-center gap-3 border rounded-lg px-4 py-2.5 text-sm ${clusterVariant.bg}`}>
          <span className={`font-bold ${clusterVariant.text}`}>{clusterVariant.icon}</span>
          <span className={`flex-1 ${clusterVariant.text}`}>{clusterVariant.label}</span>
          <CloseButton onClick={dismiss} />
        </div>
      )}
    </div>
  )
}
