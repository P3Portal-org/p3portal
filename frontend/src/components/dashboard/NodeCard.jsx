// p3portal.org
import UpdatesBadge from '../../features/node_updates/components/UpdatesBadge'

function fmt(bytes) {
  if (bytes == null) return '?'
  const gb = bytes / (1024 ** 3)
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

function uptimeLabel(seconds) {
  if (!seconds) return null
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d}D ${h}H`
  return `${h}H ${Math.floor((seconds % 3600) / 60)}M`
}

function ResourceRow({ label, pct, decimals = 0, colorClass = 'bg-orange-500' }) {
  const clamped = Math.min(100, Math.max(0, pct ?? 0))
  const critical = clamped >= 85
  const bar = critical ? 'bg-red-500' : colorClass
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-zinc-400">{label}</span>
        <span className={`tabular-nums font-medium ${critical ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-zinc-200'}`}>
          {clamped.toFixed(decimals)}%
        </span>
      </div>
      <div className="h-1.5 bg-gray-200 dark:bg-zinc-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${bar}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  )
}

export default function NodeCard({ node }) {
  const cpuPct   = (node.cpu ?? 0) * 100
  const ramPct   = node.maxmem  ? (node.mem  / node.maxmem)  * 100 : 0
  const diskPct  = node.maxdisk ? (node.disk / node.maxdisk) * 100 : 0
  const isOnline = node.status === 'online'
  const uptime   = uptimeLabel(node.uptime)

  const pingTitle = node.response_time_ms != null
    ? `${Math.round(node.response_time_ms)} ms`
    : undefined

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 hover:border-portal-accent dark:hover:border-portal-accent rounded-lg p-5 transition-colors">
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-base font-bold text-gray-900 dark:text-white tracking-tight">
              {node.node}
            </span>
            {node.portal_node_name && (
              <span className="text-xs font-medium text-orange-400 dark:text-orange-400">
                #{node.portal_node_name.toLowerCase().replace(/\s+/g, '-')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span
              title={pingTitle}
              className={`flex items-center gap-1 text-xs font-bold uppercase cursor-default ${isOnline ? 'text-green-500' : 'text-red-500'}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </span>
            {uptime && (
              <span className="text-xs text-gray-400 dark:text-zinc-500 uppercase tracking-wide">
                Uptime: {uptime}
              </span>
            )}
          </div>
        </div>

        {isOnline && node.maxcpu > 0 && (
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase tracking-widest text-gray-400 dark:text-zinc-500">Cores</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white leading-none">
              {node.maxcpu}
              <span className="text-sm font-medium text-gray-400 dark:text-zinc-500">x</span>
            </p>
          </div>
        )}
      </div>

      {/* Update-Badge (PROJ-73) */}
      {node.portal_node_id && (
        <div className="mt-2 mb-1">
          <UpdatesBadge portalNodeId={node.portal_node_id} nodeName={node.node} />
        </div>
      )}

      {/* Resource bars */}
      {isOnline && (
        <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
          <ResourceRow
            label={`CPU (${node.maxcpu ?? '?'} Cores)`}
            pct={cpuPct}
            decimals={1}
            colorClass="bg-orange-500"
          />
          <ResourceRow
            label={`RAM (${fmt(node.mem)} / ${fmt(node.maxmem)})`}
            pct={ramPct}
            colorClass="bg-blue-500"
          />
          <ResourceRow
            label={`Disk Space (${fmt(node.disk)} / ${fmt(node.maxdisk)})`}
            pct={diskPct}
            colorClass="bg-zinc-400"
          />
        </div>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
