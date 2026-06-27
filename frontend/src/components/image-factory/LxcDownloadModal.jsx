// p3portal.org
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { getLxcTemplateStorages, downloadLxcTemplate } from '../../api/cluster'

const inputCls =
  'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent/50 transition rounded'

export default function LxcDownloadModal({ template, portalNodes, onClose, onSuccess }) {
  const { t } = useTranslation()
  const [selectedNode, setSelectedNode] = useState(portalNodes[0]?.name ?? '')
  const [storages, setStorages] = useState([])
  const [selectedStorage, setSelectedStorage] = useState('')
  const [storagesLoading, setStoragesLoading] = useState(false)
  const [storagesError, setStoragesError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!selectedNode) return
    setStorages([])
    setSelectedStorage('')
    setStoragesError(null)
    setStoragesLoading(true)
    getLxcTemplateStorages(selectedNode)
      .then(list => {
        setStorages(list)
        setSelectedStorage(list[0] ?? '')
      })
      .catch(err => setStoragesError(err.response?.data?.detail ?? t('lxc_templates.dl_storages_load_failed')))
      .finally(() => setStoragesLoading(false))
  }, [selectedNode, t])

  async function handleDownload() {
    if (!selectedNode || !selectedStorage) return
    setSubmitting(true)
    setError(null)
    try {
      await downloadLxcTemplate({ node: selectedNode, template: template.template, storage: selectedStorage })
      onSuccess(t('lxc_templates.dl_started', { template: template.template, node: selectedNode, storage: selectedStorage }))
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? t('lxc_templates.dl_failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-md mx-4 shadow-xl rounded-lg"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('lxc_templates.dl_title')}</h2>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5 font-mono truncate max-w-xs">{template.template}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
            aria-label={t('lxc_templates.close')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Node */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              {t('lxc_templates.target_node')} <span className="text-portal-danger">*</span>
            </label>
            {portalNodes.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-zinc-500">{t('lxc_templates.no_nodes_configured')}</p>
            ) : (
              <select
                value={selectedNode}
                onChange={e => setSelectedNode(e.target.value)}
                className={inputCls}
              >
                {portalNodes.map(n => (
                  <option key={n.name} value={n.name}>{n.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Storage */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              {t('lxc_templates.target_storage')} <span className="text-portal-danger">*</span>
            </label>
            {storagesLoading ? (
              <div className="h-9 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
            ) : storagesError ? (
              <p className="text-sm text-portal-danger">{storagesError}</p>
            ) : storages.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-zinc-500">
                {selectedNode ? t('lxc_templates.no_vztmpl_storage') : t('lxc_templates.select_node_first')}
              </p>
            ) : (
              <select
                value={selectedStorage}
                onChange={e => setSelectedStorage(e.target.value)}
                className={inputCls}
              >
                {storages.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </div>

          {error && (
            <div className="bg-portal-danger/10 border border-portal-danger/30 px-4 py-3 text-sm text-portal-danger rounded-lg">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
            >
              {t('lxc_templates.cancel')}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              disabled={!selectedNode || !selectedStorage || submitting}
              className="flex-1 flex items-center justify-center gap-2 btn-primary"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {t('lxc_templates.dl_starting')}
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {t('lxc_templates.dl_start_btn')}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
