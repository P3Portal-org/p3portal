// p3portal.org
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCapability } from '../../hooks/useCapability'
import { PlusComponents } from '../../plus'
import { reorderNodes } from '../../api/nodes'

function nodeMaxDuration(cacheStats, nodeId) {
  const entries = cacheStats.filter((s) => s.node_id === nodeId && s.fetch_duration_ms != null)
  if (entries.length === 0) return null
  return Math.max(...entries.map((s) => s.fetch_duration_ms))
}

export default function NodeTable({ nodes, cacheStats = [], onRefresh, onEdit, onManageAccess }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [reordering, setReordering] = useState(false)
  const isPlus = useCapability('multiple_nodes')
  const NodeSetDefaultButton = PlusComponents.NodeSetDefaultButton
  const NodeDeleteButton = PlusComponents.NodeDeleteButton
  const canReorder = nodes.length > 1

  // Globale Node-Reihenfolge: Nachbar-Tausch -> reorderNodes(volle ID-Liste).
  const moveNode = async (index, dir) => {
    const target = index + dir
    if (target < 0 || target >= nodes.length || reordering) return
    const order = nodes.map((n) => n.id)
    ;[order[index], order[target]] = [order[target], order[index]]
    setReordering(true)
    setError('')
    try {
      await reorderNodes(order)
      onRefresh?.()
    } catch (e) {
      setError(e.response?.data?.detail ?? t('admin.nodes.reorder_failed'))
    } finally {
      setReordering(false)
    }
  }

  if (nodes.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 dark:text-zinc-500 text-sm">
        {t('admin.nodes.empty')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {error && (
        <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2 mb-2">
          {error}
        </p>
      )}

      <div className="overflow-x-auto border border-gray-200 dark:border-zinc-700 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-700">
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('admin.nodes.col_name')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('admin.nodes.col_url')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('admin.nodes.col_pve_node')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('admin.nodes.col_ssl')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('admin.nodes.col_poll')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('admin.nodes.col_last_response')}</th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('admin.nodes.col_default')}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-700/50">
            {nodes.map((node, index) => (
              <tr key={node.id} className="bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{node.name}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 font-mono text-xs max-w-0 overflow-hidden">
                  <div className="truncate" title={node.url}>{node.url}</div>
                </td>
                <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">
                  <span className="font-mono text-xs">{node.proxmox_node}</span>
                  {node.cluster_nodes?.length > 0 && (
                    <span
                      className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-portal-info/10 text-portal-info border border-portal-info/30"
                      title={t('admin.nodes.cluster_nodes_title', { nodes: node.cluster_nodes.join(', ') })}
                    >
                      +{node.cluster_nodes.length}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block w-2 h-2 rounded-full ${node.verify_ssl ? 'bg-portal-success' : 'bg-portal-warn'}`} />
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 text-xs">
                  {node.poll_interval}s
                </td>
                <td className="px-4 py-3 text-xs font-mono">
                  {(() => {
                    const ms = nodeMaxDuration(cacheStats, node.id)
                    if (ms === null) return <span className="text-gray-400 dark:text-zinc-600">{t('admin.nodes.cache_no_data')}</span>
                    const color = ms < 200 ? 'text-portal-success' : ms < 500 ? 'text-portal-warn' : 'text-portal-danger'
                    return <span className={color}>{ms.toFixed(0)}ms</span>
                  })()}
                </td>
                <td className="px-4 py-3">
                  {node.is_default ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-portal-accent/10 text-portal-accent border border-portal-accent/30">
                      {t('admin.nodes.default_badge')}
                    </span>
                  ) : isPlus && NodeSetDefaultButton ? (
                    <Suspense fallback={null}>
                      <NodeSetDefaultButton node={node} onRefresh={onRefresh} onError={setError} />
                    </Suspense>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {canReorder && (
                      <div className="flex items-center">
                        <button
                          onClick={() => moveNode(index, -1)}
                          disabled={index === 0 || reordering}
                          className="btn-table disabled:opacity-30"
                          title={t('admin.nodes.move_up')}
                          aria-label={t('admin.nodes.move_up')}
                        >↑</button>
                        <button
                          onClick={() => moveNode(index, 1)}
                          disabled={index === nodes.length - 1 || reordering}
                          className="btn-table disabled:opacity-30"
                          title={t('admin.nodes.move_down')}
                          aria-label={t('admin.nodes.move_down')}
                        >↓</button>
                      </div>
                    )}
                    {isPlus && onManageAccess && (
                      <button
                        onClick={() => onManageAccess(node)}
                        className="btn-table"
                        title={t('node_assignments.manage_access_tooltip')}
                      >
                        {t('node_assignments.manage_access_short')}
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(node)}
                      className="btn-table"
                    >
                      {t('admin.nodes.edit')}
                    </button>
                    {isPlus && !node.is_default && NodeDeleteButton && (
                      <Suspense fallback={null}>
                        <NodeDeleteButton node={node} onRefresh={onRefresh} onError={setError} />
                      </Suspense>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
