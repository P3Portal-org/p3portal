// p3portal.org
import { useEffect, useState, useCallback } from 'react'
import { fetchProxmoxTemplates, deleteProxmoxTemplate } from '../../api/packer'
import { usePackerNodes } from '../../hooks/usePackerNodes'
import { useAuth } from '../../hooks/useAuth'
import ConfirmModal from '../common/ConfirmModal'

const inputBase =
  'border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition'

function formatCtime(ctime) {
  if (!ctime) return '–'
  return new Date(ctime * 1000).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function TmplBadge({ type }) {
  const label = type === 'lxc' ? 'tmpl/CT' : 'tmpl'
  return (
    <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 border border-purple-200 dark:border-purple-800">
      {label}
    </span>
  )
}

function TemplateRow({ tmpl, isAdmin, onRequestDelete, busy, error }) {
  return (
    <tr className="border-b border-gray-100 dark:border-zinc-700/50 bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors opacity-75">
      <td className="px-4 py-2 text-xs tabular-nums text-gray-500 dark:text-zinc-400">{tmpl.vmid}</td>
      <td className="px-4 py-2 text-sm text-gray-900 dark:text-white">{tmpl.name}</td>
      <td className="px-4 py-2"><TmplBadge type={tmpl.type} /></td>
      <td className="px-4 py-2 text-xs text-gray-600 dark:text-zinc-400">{tmpl.node}</td>
      <td className="px-4 py-2 text-xs tabular-nums text-gray-500 dark:text-zinc-400">{formatCtime(tmpl.ctime)}</td>
      <td className="px-4 py-3 text-right">
        {error && <span className="text-xs text-red-500 mr-2">{error}</span>}
        {isAdmin && (
          <button
            onClick={() => onRequestDelete(tmpl)}
            disabled={busy}
            className="btn-table-danger"
          >
            {busy ? '…' : 'Löschen'}
          </button>
        )}
      </td>
    </tr>
  )
}

export default function ProxmoxTemplatesTab() {
  const { role } = useAuth()
  const [templates, setTemplates] = useState([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templatesError, setTemplatesError] = useState(null)
  const [selectedNode, setSelectedNode] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(null)
  const [deleteError, setDeleteError] = useState({})
  const isAdmin = role === 'admin'

  const {
    nodes, nodesLoading, nodesError, fetchNodes,
  } = usePackerNodes()

  const load = useCallback(async () => {
    setTemplatesLoading(true)
    setTemplatesError(null)
    try {
      const data = await fetchProxmoxTemplates()
      setTemplates(data)
    } catch (err) {
      setTemplatesError(err.response?.data?.detail ?? err.message ?? 'Fehler beim Laden')
    } finally {
      setTemplatesLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchNodes()
    load()
  }, [fetchNodes, load])

  // Auto-select single node (Core edition)
  useEffect(() => {
    if (nodesLoading || nodesError || nodes.length !== 1) return
    if (selectedNode === nodes[0].name) return
    setSelectedNode(nodes[0].name)
  }, [nodes, nodesLoading, nodesError, selectedNode])

  const handleDeleted = (vmid) => {
    setTemplates(prev => prev.filter(t => t.vmid !== vmid))
  }

  const executeDelete = async () => {
    if (!deleteTarget) return
    const tmpl = deleteTarget
    setDeleteTarget(null)
    setDeleteBusy(tmpl.vmid)
    setDeleteError(prev => { const next = { ...prev }; delete next[tmpl.vmid]; return next })
    try {
      await deleteProxmoxTemplate(tmpl.vmid)
      handleDeleted(tmpl.vmid)
    } catch (err) {
      setDeleteError(prev => ({ ...prev, [tmpl.vmid]: err.response?.data?.detail ?? 'Löschen fehlgeschlagen.' }))
    } finally {
      setDeleteBusy(null)
    }
  }

  const visibleTemplates = selectedNode
    ? templates.filter(t => t.node === selectedNode)
    : templates

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-zinc-950">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">Proxmox VM-Templates</h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Alle Templates im Proxmox-Cluster (VMs mit Template-Flag)
          </p>
        </div>
        <button
          onClick={load}
          disabled={templatesLoading}
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-50 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 ${templatesLoading ? 'animate-spin' : ''}`}>
            <path d="M21 2v6h-6" /><path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
            <path d="M3 22v-6h6" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
          Aktualisieren
        </button>
      </div>

      {/* Node selector */}
      <div className="mb-5 space-y-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
          Proxmox Node
        </label>
        <select
          value={selectedNode}
          onChange={e => setSelectedNode(e.target.value)}
          disabled={nodesLoading}
          className={`${inputBase} w-full max-w-xs`}
        >
          <option value="">{nodesLoading ? 'Lädt…' : nodes.length > 1 ? '– Node auswählen –' : '–'}</option>
          {nodes.map(n => (
            <option key={n.name} value={n.name} disabled={n.status !== 'online'}>
              {n.name}{n.status !== 'online' ? ` (${n.status})` : ''}
            </option>
          ))}
        </select>
        {nodesError && (
          <p className="text-xs text-amber-600 dark:text-amber-400">Node-Liste nicht verfügbar.</p>
        )}
      </div>

      {templatesLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
          ))}
        </div>
      )}

      {!templatesLoading && templatesError && (
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {templatesError}
        </div>
      )}

      {!templatesLoading && !templatesError && !selectedNode && nodes.length > 1 && (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-400 dark:text-zinc-500">Node auswählen um Templates anzuzeigen.</p>
        </div>
      )}

      {!templatesLoading && !templatesError && (selectedNode || nodes.length <= 1) && visibleTemplates.length === 0 && (
        <div className="py-16 text-center">
          <p className="text-sm text-gray-500 dark:text-zinc-400">Keine VM-Templates gefunden</p>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
            Templates werden durch Packer-Builds auf dem Proxmox-Cluster erstellt.
          </p>
        </div>
      )}

      {!templatesLoading && !templatesError && (selectedNode || nodes.length <= 1) && visibleTemplates.length > 0 && (
        <div className="border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden rounded-lg">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700">
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">ID</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Typ</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Node</th>
                <th className="px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Erstellt</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {visibleTemplates.map(tmpl => (
                <TemplateRow
                  key={tmpl.vmid}
                  tmpl={tmpl}
                  isAdmin={isAdmin}
                  onRequestDelete={setDeleteTarget}
                  busy={deleteBusy === tmpl.vmid}
                  error={deleteError[tmpl.vmid]}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Template löschen"
          body={`Template „${deleteTarget.name}" (VMID ${deleteTarget.vmid}) wirklich löschen?`}
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={executeDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
