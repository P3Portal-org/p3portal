// p3portal.org
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { startPackerBuild, getNextVmid } from '../../api/packer'
import { getNodeDefaultStorages } from '../../api/admin'
import PlaybookFormField from '../playbooks/PlaybookFormField'
import { usePackerNodes } from '../../hooks/usePackerNodes'
import IsoDownloadModal from './IsoDownloadModal'

function validate(params, values, t) {
  const errors = {}
  for (const p of params) {
    const val = values[p.id]
    if (p.required && (val === '' || val == null)) {
      errors[p.id] = t('packer.field_required')
    }
    if (p.type === 'integer' && val !== '' && val != null) {
      if (p.min != null && Number(val) < p.min) errors[p.id] = t('packer.field_min', { min: p.min })
      if (p.max != null && Number(val) > p.max) errors[p.id] = t('packer.field_max', { max: p.max })
    }
  }
  return errors
}

const inputBase =
  'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent/50 transition'

// ── VM-ID Feld mit Auto-Fill ──────────────────────────────────────────────────

function VmIdField({ param, value, onChange, error, vmidRange, onRefresh, refreshing }) {
  const { t } = useTranslation()
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={vmidRange?.min ?? param.min}
          max={vmidRange?.max ?? param.max}
          required={param.required}
          onChange={e => onChange(param.id, e.target.value)}
          className={`flex-1 border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent/50 transition ${error ? 'border-portal-danger/50' : ''}`}
        />
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          title={t('packer.vmid_next_free')}
          className="shrink-0 px-2.5 py-2 border border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-portal-accent/50 hover:text-portal-accent transition disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}>
            <path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>
      {vmidRange && (
        <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
          {t('packer.vmid_range', { min: vmidRange.min, max: vmidRange.max })}
        </p>
      )}
      {error && <p className="text-xs text-portal-danger mt-1">{error}</p>}
    </div>
  )
}

// ── Node-Dropdown ─────────────────────────────────────────────────────────────

function NodeDropdown({ param, value, onChange, nodes, loading, error }) {
  const { t } = useTranslation()
  // Fallback to text input when API is unavailable
  if (error && nodes.length === 0) {
    return (
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
          {param.label}
          {param.required && <span className="text-portal-danger ml-1">*</span>}
        </label>
        <input
          type="text"
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value)}
          placeholder={t('packer.node_input_placeholder')}
          className={inputBase}
        />
        <p className="text-xs text-portal-warn">
          {t('packer.node_list_unavailable')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(param.id, e.target.value)}
        disabled={loading}
        className={inputBase}
      >
        <option value="">{loading ? t('packer.loading') : t('packer.node_select_placeholder')}</option>
        {nodes.map(n => (
          <option key={n.name} value={n.name} disabled={n.status !== 'online'}>
            {n.name}{n.status !== 'online' ? ` (${n.status})` : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

// ── Storage-Pool-Dropdown ─────────────────────────────────────────────────────

function StoragePoolDropdown({ param, value, onChange, storages, loading, error, node }) {
  const { t } = useTranslation()
  if (!node) {
    return (
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
          {param.label}
          {param.required && <span className="text-portal-danger ml-1">*</span>}
        </label>
        <p className="text-xs text-gray-400 dark:text-zinc-500 italic py-2">
          {t('packer.storage_select_node_first')}
        </p>
      </div>
    )
  }

  if (error && storages.length === 0) {
    return (
      <div className="space-y-1">
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
          {param.label}
          {param.required && <span className="text-portal-danger ml-1">*</span>}
        </label>
        <input
          type="text"
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value)}
          placeholder={t('packer.storage_input_placeholder')}
          className={inputBase}
        />
        <p className="text-xs text-portal-warn">
          {t('packer.storage_list_unavailable')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>
      <select
        value={value ?? ''}
        onChange={e => onChange(param.id, e.target.value)}
        disabled={loading}
        className={inputBase}
      >
        <option value="">{loading ? t('packer.loading') : t('packer.storage_select_placeholder')}</option>
        {storages.map(s => (
          <option key={s.name} value={s.name}>
            {s.name} ({s.type})
          </option>
        ))}
      </select>
    </div>
  )
}

// ── ISO-Select ────────────────────────────────────────────────────────────────

function IsoSelect({ param, value, onChange, isos, loading, error, node, onOpenDownload, onRefresh, downloadJob }) {
  const navigate = useNavigate()
  const { t } = useTranslation()

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
          {param.label}
          {param.required && <span className="text-portal-danger ml-1">*</span>}
        </label>
        {node && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="text-xs text-gray-400 dark:text-zinc-500 hover:text-portal-accent transition-colors disabled:opacity-50"
            title={t('packer.iso_refresh_list')}
          >
            {loading ? (
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <polyline points="1 4 1 10 7 10" />
                <path d="M3.51 15a9 9 0 1 0 .49-4.95" />
              </svg>
            )}
          </button>
        )}
      </div>

      {!node ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 italic py-2">
          {t('packer.iso_select_node_first')}
        </p>
      ) : error ? (
        <div className="border border-portal-warn/30 bg-portal-warn/10 px-3 py-2 text-xs text-portal-warn">
          {t('packer.iso_list_unavailable', { detail: error.response?.data?.detail ?? error.message })}
        </div>
      ) : (
        <select
          value={value ?? ''}
          onChange={e => {
            if (e.target.value === '__download__') {
              onOpenDownload()
            } else {
              onChange(param.id, e.target.value)
            }
          }}
          disabled={loading}
          className={inputBase}
        >
          <option value="">{loading ? t('packer.loading') : t('packer.iso_select_placeholder')}</option>
          {isos.map(iso => (
            <option key={iso.volid} value={iso.volid}>{iso.filename}</option>
          ))}
          <option value="__download__">{t('packer.iso_download_option')}</option>
        </select>
      )}

      {!loading && !error && node && isos.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          {t('packer.iso_none_in_local')}{' '}
          <button
            type="button"
            onClick={onOpenDownload}
            className="text-portal-accent hover:underline"
          >
            {t('packer.iso_download_title')}
          </button>
        </p>
      )}

      {downloadJob && (
        <div className="flex items-center gap-2 bg-portal-info/10 border border-portal-info/30 px-3 py-2 text-xs text-portal-info">
          <svg className="animate-spin w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
          <span>{t('packer.iso_download_running')}</span>
          <button
            type="button"
            onClick={() => navigate(`/events/${downloadJob.id}`)}
            className="ml-auto hover:underline shrink-0"
          >
            Job anzeigen →
          </button>
        </div>
      )}
    </div>
  )
}

// ── Haupt-Formular ────────────────────────────────────────────────────────────

export default function PackerBuildForm({ template, isRunning, onBuildStarted }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [values, setValues] = useState(() =>
    Object.fromEntries((template.parameters ?? []).map(p => [p.id, p.default ?? '']))
  )
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const [downloadJob, setDownloadJob] = useState(null)
  const pendingIsoRef = useRef(null)

  const hasNodeParam    = (template.parameters ?? []).some(p => p.id === 'node')
  const hasIsoParam     = (template.parameters ?? []).some(p => p.id === 'iso_file')
  const hasStorageParam = (template.parameters ?? []).some(p => p.id === 'storage_pool')
  const hasVmIdParam    = (template.parameters ?? []).some(p => p.id === 'vm_id')

  const [vmidRange, setVmidRange]           = useState(null)
  const [vmidRefreshing, setVmidRefreshing] = useState(false)
  const [nodeStorageDefaults, setNodeStorageDefaults] = useState({})

  const fetchNextVmid = useCallback(async () => {
    setVmidRefreshing(true)
    try {
      const data = await getNextVmid()
      setVmidRange({ min: data.min, max: data.max })
      setValues(v => ({ ...v, vm_id: String(data.vmid) }))
    } catch {
      // graceful: leave existing value, no range hint
    } finally {
      setVmidRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (hasVmIdParam) fetchNextVmid()
  }, [hasVmIdParam, fetchNextVmid])

  const {
    nodes, isos, storages,
    nodesLoading, isosLoading, storagesLoading,
    nodesError, isosError, storagesError,
    fetchNodes, fetchIsos, fetchStorages,
    queryUrl, startDownload,
  } = usePackerNodes()

  // Load node list + storage defaults once on mount
  useEffect(() => {
    if (hasNodeParam) fetchNodes()
  }, [hasNodeParam, fetchNodes])

  useEffect(() => {
    if (!hasStorageParam) return
    getNodeDefaultStorages().then(data => {
      setNodeStorageDefaults(data)
      // Node may have been auto-selected before defaults loaded — apply retroactively
      setValues(v => {
        if (!v.node || v.storage_pool) return v
        const defaultStorage = data[v.node]
        if (!defaultStorage) return v
        return { ...v, storage_pool: defaultStorage }
      })
    }).catch(() => {})
  }, [hasStorageParam])

  // Auto-select single node in Core edition (only 1 node returned)
  useEffect(() => {
    if (!hasNodeParam || nodesLoading || nodesError || nodes.length !== 1) return
    const singleNode = nodes[0].name
    if (values.node === singleNode) return
    // Admin-Default als Vorbelegung übernehmen (sonst greift unten der Fallback
    // auf das erste verfügbare Storage). Kein stiller leerer storage_pool mehr.
    const defaultStorage = nodeStorageDefaults[singleNode] ?? ''
    setValues(v => ({ ...v, node: singleNode, iso_file: '', storage_pool: defaultStorage }))
  }, [nodes, nodesLoading, nodesError, hasNodeParam, values.node, nodeStorageDefaults])

  // Reload ISOs whenever node selection changes
  useEffect(() => {
    if (!hasIsoParam || !values.node) return
    fetchIsos(values.node).then(newIsos => {
      if (pendingIsoRef.current && newIsos?.length) {
        const match = newIsos.find(iso => iso.filename === pendingIsoRef.current)
        if (match) {
          setValues(v => ({ ...v, iso_file: match.volid }))
          pendingIsoRef.current = null
        }
      }
    })
  }, [values.node, hasIsoParam, fetchIsos])

  // Reload storage pools whenever node selection changes und einen gültigen
  // Storage vorbelegen: gültige (Admin-Default/Nutzer-)Wahl bleibt erhalten,
  // sonst Fallback auf das erste verfügbare Storage. Verhindert den stillen
  // local-lvm-Fallback ('storage does not exist'); Dropdown bleibt änderbar.
  useEffect(() => {
    if (!hasStorageParam || !values.node) return
    fetchStorages(values.node).then(list => {
      if (!Array.isArray(list) || list.length === 0) return
      setValues(v => {
        if (v.storage_pool && list.some(s => s.name === v.storage_pool)) return v
        return { ...v, storage_pool: list[0].name }
      })
    }).catch(() => {})
  }, [values.node, hasStorageParam, fetchStorages])

  const handleChange = (id, val) => {
    if (id === 'node') {
      const defaultStorage = nodeStorageDefaults[val] ?? ''
      setValues(v => ({ ...v, node: val, iso_file: '', storage_pool: defaultStorage }))
      setErrors(e => ({ ...e, node: undefined, iso_file: undefined, storage_pool: undefined }))
      setDownloadJob(null)
      pendingIsoRef.current = null
    } else {
      setValues(v => ({ ...v, [id]: val }))
      setErrors(e => ({ ...e, [id]: undefined }))
    }
  }

  const handleRefreshIsos = () => {
    if (!values.node) return
    fetchIsos(values.node).then(newIsos => {
      if (pendingIsoRef.current && newIsos?.length) {
        const match = newIsos.find(iso => iso.filename === pendingIsoRef.current)
        if (match) {
          setValues(v => ({ ...v, iso_file: match.volid }))
          pendingIsoRef.current = null
        }
      }
    })
  }

  const handleDownloadStarted = (job, filename) => {
    setDownloadJob(job)
    pendingIsoRef.current = filename
  }

  // Called when user picks "Vorhandenes ISO verwenden" from the 409 warning
  const handleUseExistingIso = (filename) => {
    const match = isos.find(iso => iso.filename === filename)
    if (match) {
      setValues(v => ({ ...v, iso_file: match.volid }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(template.parameters ?? [], values)
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    try {
      const cleaned = Object.fromEntries(
        Object.entries(values).filter(([id, val]) => {
          const p = (template.parameters ?? []).find(param => param.id === id)
          return !(p?.type === 'ssh_key' && (val === '' || val == null))
        })
      )
      const result = await startPackerBuild(template.id, cleaned)
      onBuildStarted?.()
      // PROJ-50: HTTP 202 → Freigabe erforderlich, Weiterleitung zur Pending-Page
      if (result?.approval_id) {
        navigate(`/approvals/pending/${result.approval_id}`)
      } else {
        navigate(`/events/${result.id}`)
      }
    } catch (err) {
      if (err.response?.status === 409) {
        setSubmitError(t('packer.build_already_running'))
      } else {
        setSubmitError(err.response?.data?.detail ?? 'Fehler beim Starten des Builds.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const disabled = isRunning || submitting

  return (
    <>
      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        {(template.parameters ?? []).map(param => {
          if (param.id === 'vm_id' && hasVmIdParam) {
            return (
              <VmIdField
                key={param.id}
                param={param}
                value={values[param.id]}
                onChange={handleChange}
                error={errors[param.id]}
                vmidRange={vmidRange}
                onRefresh={fetchNextVmid}
                refreshing={vmidRefreshing}
              />
            )
          }
          if (param.id === 'node' && hasNodeParam) {
            return (
              <NodeDropdown
                key={param.id}
                param={param}
                value={values[param.id]}
                onChange={handleChange}
                nodes={nodes}
                loading={nodesLoading}
                error={nodesError}
              />
            )
          }
          if (param.id === 'storage_pool' && hasStorageParam) {
            return (
              <StoragePoolDropdown
                key={param.id}
                param={param}
                value={values[param.id]}
                onChange={handleChange}
                storages={storages}
                loading={storagesLoading}
                error={storagesError}
                node={values.node}
              />
            )
          }
          if (param.id === 'iso_file' && hasIsoParam) {
            return (
              <IsoSelect
                key={param.id}
                param={param}
                value={values[param.id]}
                onChange={handleChange}
                isos={isos}
                loading={isosLoading}
                error={isosError}
                node={values.node}
                onOpenDownload={() => setShowDownloadModal(true)}
                onRefresh={handleRefreshIsos}
                downloadJob={downloadJob}
              />
            )
          }
          return (
            <PlaybookFormField
              key={param.id}
              param={param}
              value={values[param.id]}
              onChange={handleChange}
              error={errors[param.id]}
            />
          )
        })}

        {submitError && (
          <div className="bg-portal-danger/10 border border-portal-danger/30 px-4 py-3 text-sm text-portal-danger">
            {submitError}
          </div>
        )}

        <button
          type={isRunning ? 'button' : 'submit'}
          disabled={disabled}
          className={`w-full flex items-center justify-center gap-2 transition-colors ${
            isRunning
              ? 'text-sm font-medium px-4 py-2.5 bg-gray-200 dark:bg-zinc-700 text-gray-500 dark:text-zinc-400 cursor-not-allowed'
              : 'btn-primary'
          }`}
        >
          {isRunning ? (
            <>
              <span className="w-2 h-2 rounded-full bg-portal-accent animate-pulse" />
              {t('packer.build_running')}
            </>
          ) : submitting ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              {t('packer.build_starting')}
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              {t('packer.build_start')}
            </>
          )}
        </button>
      </form>

      {showDownloadModal && (
        <IsoDownloadModal
          node={values.node}
          onClose={() => setShowDownloadModal(false)}
          onDownloadStarted={handleDownloadStarted}
          onUseExisting={handleUseExistingIso}
          queryUrl={queryUrl}
          startDownload={startDownload}
        />
      )}
    </>
  )
}
