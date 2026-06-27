// p3portal.org
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { deletePackerIso } from '../../api/packer'
import { usePackerNodes } from '../../hooks/usePackerNodes'
import { useJobLog } from '../../hooks/useJobs'
import IsoDownloadModal from './IsoDownloadModal'

function formatBytes(bytes) {
  if (!bytes) return '–'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const STATUS_LABEL_KEY = {
  pending: 'packer.status_pending',
  running: 'packer.status_running',
  success: 'packer.status_success',
  failed: 'packer.status_failed',
}
const STATUS_COLOR = {
  pending: 'text-gray-500 dark:text-zinc-400',
  running: 'text-portal-accent',
  success: 'text-portal-success',
  failed: 'text-portal-danger',
}

function InlineJobLog({ jobId }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { lines, status, connected } = useJobLog(jobId)

  return (
    <div className="border border-gray-200 dark:border-zinc-700">
      <div className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium flex items-center gap-1 ${STATUS_COLOR[status] ?? 'text-gray-500'}`}>
            {status === 'running' && (
              <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            {t('packer.iso_job_label', { status: STATUS_LABEL_KEY[status] ? t(STATUS_LABEL_KEY[status]) : status })}
          </span>
          <span className={`text-xs ${connected ? 'text-portal-success' : 'text-gray-400 dark:text-zinc-600'}`}>
            {connected ? t('packer.iso_live') : t('packer.iso_disconnected')}
          </span>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/events/${jobId}`)}
          className="text-xs text-portal-accent hover:underline shrink-0"
        >
          {t('packer.iso_show_job')}
        </button>
      </div>
      <div className="h-44 overflow-y-auto bg-slate-950 p-3 font-mono text-xs text-slate-300 leading-relaxed">
        {lines.length === 0 ? (
          <span className="text-slate-600">{t('packer.iso_waiting_output')}</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))
        )}
      </div>
    </div>
  )
}

export default function IsoManagerTab() {
  const { t } = useTranslation()
  const {
    nodes, isos,
    nodesLoading, isosLoading,
    nodesError, isosError,
    fetchNodes, fetchIsos,
    queryUrl, startDownload,
  } = usePackerNodes()

  const [selectedNode, setSelectedNode] = useState('')
  const [deletingVolid, setDeletingVolid] = useState(null)
  const [deleteInProgress, setDeleteInProgress] = useState(null)
  const [deleteError, setDeleteError] = useState(null)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [downloadJob, setDownloadJob] = useState(null)

  const inputBase =
    'border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent/50 transition'

  useEffect(() => {
    fetchNodes()
  }, [fetchNodes])

  // Auto-select single node (Core edition)
  useEffect(() => {
    if (nodesLoading || nodesError || nodes.length !== 1) return
    if (selectedNode === nodes[0].name) return
    handleNodeChange(nodes[0].name)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, nodesLoading, nodesError])

  const handleNodeChange = (node) => {
    setSelectedNode(node)
    setDeleteError(null)
    setDeletingVolid(null)
    setDownloadJob(null)
    if (node) fetchIsos(node)
  }

  const handleRefresh = () => {
    if (selectedNode) fetchIsos(selectedNode)
  }

  const handleDeleteClick = async (volid) => {
    if (deletingVolid !== volid) {
      setDeletingVolid(volid)
      setDeleteError(null)
      return
    }
    setDeleteInProgress(volid)
    setDeleteError(null)
    try {
      await deletePackerIso(selectedNode, volid)
      setDeletingVolid(null)
      fetchIsos(selectedNode)
    } catch (err) {
      setDeleteError(err.response?.data?.detail ?? t('packer.iso_delete_failed'))
      setDeletingVolid(null)
    } finally {
      setDeleteInProgress(null)
    }
  }

  const handleDownloadStarted = (job) => {
    setDownloadJob(job)
    setShowDownloadModal(false)
  }

  const handleUseExisting = () => {
    fetchIsos(selectedNode)
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-gray-50 dark:bg-zinc-950">
      <div className="max-w-3xl space-y-5">

        {/* Header */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{t('packer.iso_mgmt_title')}</h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            {t('packer.iso_mgmt_subtitle')}
          </p>
        </div>

        {/* Node selector */}
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
            {t('packer.iso_node_select_label')}
          </label>
          <select
            value={selectedNode}
            onChange={e => handleNodeChange(e.target.value)}
            disabled={nodesLoading}
            className={`${inputBase} w-full max-w-xs`}
          >
            <option value="">{nodesLoading ? t('packer.loading') : t('packer.iso_node_placeholder')}</option>
            {nodes.map(n => (
              <option key={n.name} value={n.name} disabled={n.status !== 'online'}>
                {n.name}{n.status !== 'online' ? ` (${n.status})` : ''}
              </option>
            ))}
          </select>
          {nodesError && (
            <p className="text-xs text-portal-warn">
              {t('packer.iso_nodes_unavailable')}
            </p>
          )}
        </div>

        {/* ISO management area */}
        {selectedNode ? (
          <div className="space-y-3">
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                {t('packer.iso_list_on_node')}
                <span className="font-mono text-portal-accent">{selectedNode}</span>
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isosLoading}
                  className="p-1 text-gray-400 dark:text-zinc-500 hover:text-portal-accent transition-colors disabled:opacity-50"
                  title={t('packer.iso_refresh')}
                >
                  {isosLoading ? (
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                      <polyline points="1 4 1 10 7 10" />
                      <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
                    </svg>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDownloadModal(true)}
                  className="btn-primary flex items-center gap-1.5 text-xs"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {t('packer.iso_download_title')}
                </button>
              </div>
            </div>

            {deleteError && (
              <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger">
                {deleteError}
              </div>
            )}

            {/* ISO list */}
            {isosError ? (
              <div className="border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
                {t('packer.iso_list_unavailable', { detail: isosError.response?.data?.detail ?? isosError.message ?? isosError })}
              </div>
            ) : isosLoading ? (
              <div className="space-y-1">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-12 bg-gray-100 dark:bg-zinc-800 animate-pulse" />
                ))}
              </div>
            ) : isos.length === 0 ? (
              <div className="border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-4 py-10 text-center">
                <p className="text-sm text-gray-500 dark:text-zinc-400">{t('packer.iso_none')}</p>
                <button
                  type="button"
                  onClick={() => setShowDownloadModal(true)}
                  className="mt-2 text-xs text-portal-accent hover:underline"
                >
                  {t('packer.iso_download_title')}
                </button>
              </div>
            ) : (
              <div className="border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800 rounded-lg overflow-hidden">
                {isos.map(iso => (
                  <div key={iso.volid} className="flex items-center justify-between px-4 py-3 gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">{iso.filename}</p>
                      <p className="text-xs text-gray-400 dark:text-zinc-500 font-mono truncate">
                        {formatBytes(iso.size)} · {iso.volid}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {deletingVolid === iso.volid ? (
                        <>
                          <span className="text-xs text-portal-danger">{t('packer.iso_delete_confirm')}</span>
                          <button
                            onClick={() => handleDeleteClick(iso.volid)}
                            disabled={deleteInProgress === iso.volid}
                            className="text-xs bg-portal-danger hover:bg-portal-danger disabled:opacity-50 text-white px-2 py-1 transition-colors"
                          >
                            {deleteInProgress === iso.volid ? t('packer.iso_deleting') : t('packer.iso_delete_yes')}
                          </button>
                          <button
                            onClick={() => setDeletingVolid(null)}
                            className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 transition-colors"
                          >
                            {t('packer.cancel')}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleDeleteClick(iso.volid)}
                          disabled={deleteInProgress !== null}
                          className="text-xs text-portal-danger hover:text-portal-danger disabled:opacity-50 transition-colors"
                        >
                          {t('packer.delete')}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Inline job log for active download */}
            {downloadJob && (
              <InlineJobLog jobId={downloadJob.id} />
            )}
          </div>
        ) : (
          <div className="py-20 text-center">
            <p className="text-sm text-gray-400 dark:text-zinc-500">
              {t('packer.iso_select_node_hint')}
            </p>
          </div>
        )}
      </div>

      {showDownloadModal && selectedNode && (
        <IsoDownloadModal
          node={selectedNode}
          onClose={() => setShowDownloadModal(false)}
          onDownloadStarted={handleDownloadStarted}
          onUseExisting={handleUseExisting}
          queryUrl={queryUrl}
          startDownload={startDownload}
        />
      )}
    </div>
  )
}
