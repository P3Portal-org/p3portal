// p3portal.org
import { useState, useEffect } from 'react'
import { getClusterStatus, getNodes } from '../../api/cluster'
import NotificationBell from '../../features/notifications/components/NotificationBell'
import ToolingIndicators from '../../features/tooling/components/ToolingIndicators'

function MiniBar({ pct, color }) {
  const clamped = Math.min(100, Math.max(0, pct ?? 0))
  const bar = color === 'blue' ? 'bg-portal-info' : 'bg-portal-accent'
  const high = clamped > 80
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex w-10 h-1.5 bg-white/20 rounded-full overflow-hidden shrink-0">
        <span
          className={`h-1.5 rounded-full transition-all duration-500 ${high ? 'bg-portal-danger' : bar}`}
          style={{ width: `${clamped}%` }}
        />
      </span>
      <span className={`tabular-nums text-[10px] ${high ? 'text-portal-danger' : ''}`}>
        {clamped.toFixed(0)}%
      </span>
    </span>
  )
}

function NodePill({ node }) {
  const isOnline = node.status === 'online'
  const cpuPct = isOnline ? (node.cpu ?? 0) * 100 : null
  const memPct = isOnline && node.maxmem ? (node.mem / node.maxmem) * 100 : null

  return (
    <span className={`flex items-center gap-1.5 ${isOnline ? 'text-portal-text2' : 'text-portal-danger'}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? 'bg-portal-success' : 'bg-portal-danger'}`} />
      <span className="font-medium">{node.node}</span>
      {cpuPct !== null && <MiniBar pct={cpuPct} color="orange" />}
      {memPct !== null && <MiniBar pct={memPct} color="blue" />}
    </span>
  )
}

const sep = <span className="text-portal-border2 select-none">|</span>

export default function ClusterStatusBar() {
  const [status, setStatus] = useState(null)
  const [nodes, setNodes]   = useState([])

  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      try {
        const [s, n] = await Promise.all([getClusterStatus(), getNodes()])
        if (!cancelled) { setStatus(s); setNodes(n) }
      } catch {
        // silently ignore — local user or no service account
      }
    }
    fetchData()
    const id = setInterval(fetchData, 30_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  const onlineNodes = nodes.filter(n => n.status === 'online')
  const totalNodes  = nodes.length

  const hasQuorum = status?.quorum
  const ha = status?.ha_status
  const healthy = hasQuorum && ha === 'active'
  const noHA    = hasQuorum && (ha === 'none' || !ha)

  const dotColor  = !hasQuorum ? 'bg-portal-danger' : healthy ? 'bg-portal-success' : 'bg-portal-warn'
  const textColor = !hasQuorum
    ? 'text-portal-danger'
    : healthy
    ? 'text-portal-success'
    : 'text-portal-warn'
  const label = !hasQuorum ? 'Kein Quorum' : healthy ? 'Cluster OK' : noHA ? 'HA inaktiv' : 'Cluster Warnung'

  // Single-node: show node name + per-node CPU/RAM
  if (nodes.length === 1) {
    const n = nodes[0]
    return (
      <div className="h-10 flex items-center px-4 gap-3 text-xs border-b border-portal-border bg-portal-sidebar shrink-0">
        <NodePill node={n} />
        {sep}
        <div className="ml-auto flex items-center gap-2">
          <ToolingIndicators />
          <NotificationBell />
        </div>
      </div>
    )
  }

  // Multi-node: show each node individually (PROJ-36 bug fix – no averages)
  if (nodes.length > 1) {
    return (
      <div className="h-10 flex items-center px-4 gap-3 text-xs border-b border-portal-border bg-portal-sidebar shrink-0 overflow-x-auto">
        {status && (
          <>
            <span className={`flex items-center gap-1.5 font-medium shrink-0 ${textColor}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
              {label}
            </span>
            {sep}
            <span className="text-portal-text2 shrink-0">{onlineNodes.length}/{totalNodes}</span>
            {sep}
          </>
        )}
        {nodes.map((n, i) => (
          <span key={n.node} className="flex items-center gap-1.5 shrink-0">
            {i > 0 && sep}
            <NodePill node={n} />
          </span>
        ))}
        {sep}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          <ToolingIndicators />
          <NotificationBell />
        </div>
      </div>
    )
  }

  // No nodes yet (loading or no config)
  return (
    <div className="h-10 flex items-center px-4 gap-3 text-xs border-b border-portal-border bg-portal-sidebar shrink-0">
      <div className="ml-auto flex items-center gap-2">
        <ToolingIndicators />
        <NotificationBell />
      </div>
    </div>
  )
}
