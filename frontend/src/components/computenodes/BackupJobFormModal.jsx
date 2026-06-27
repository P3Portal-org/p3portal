// p3portal.org
/**
 * PROJ-78: Modal for creating or editing a Proxmox datacenter-wide backup job.
 * Handles all four VM-selection modes: all, vmids, pool, all-except-exclusion.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createBackupJob, updateBackupJob, listBackupJobPools, listBackupJobStorages } from '../../api/backupJobs'
import BackupSchedulePicker from './BackupSchedulePicker'
import VmMultiSelect from './VmMultiSelect'

// Option keys (labels resolved via i18n in render)
const MODE_OPTIONS = [
  { value: 'snapshot', labelKey: 'mode_snapshot' },
  { value: 'stop',     labelKey: 'mode_stop' },
  { value: 'suspend',  labelKey: 'mode_suspend' },
]

const COMPRESS_OPTIONS = [
  { value: 'zstd', labelKey: 'compress_zstd' },
  { value: 'lzo',  labelKey: 'compress_lzo' },
  { value: 'gzip', labelKey: 'compress_gzip' },
  { value: '0',    labelKey: 'compress_none' },
]

// VM-selection modes
const VM_SEL_MODES = [
  { value: 'all',     labelKey: 'vmsel_all' },
  { value: 'vmids',   labelKey: 'vmsel_vmids' },
  { value: 'pool',    labelKey: 'vmsel_pool' },
  { value: 'exclude', labelKey: 'vmsel_exclude' },
]

function errMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('backup_jobs.form_err_403')
  if (s === 503) return t('backup_jobs.form_err_503')
  if (s === 422) return (typeof d === 'string' ? d : t('backup_jobs.form_err_422'))
  if (s === 502) return t('backup_jobs.form_err_502')
  return (typeof d === 'string' ? d : null) ?? t('backup_jobs.form_err_generic')
}

/** Build initial form state from an existing job (edit) or defaults (create). */
function buildInitialState(job) {
  if (!job) {
    return {
      schedule: '02:00',  // matches BackupSchedulePicker default (daily 02:00)
      storage: '',
      mode: 'snapshot',
      compress: 'zstd',
      enabled: true,
      comment: '',
      mailto: '',
      vmSelMode: 'all',
      vmids: '',
      pool: '',
      exclude: '',
      keepLast: '',
      keepDaily: '',
      keepWeekly: '',
      keepMonthly: '',
    }
  }

  // Detect VM-selection mode from existing job
  let vmSelMode = 'all'
  if (job.vmid) vmSelMode = 'vmids'
  else if (job.pool) vmSelMode = 'pool'
  else if (job.all && job.exclude) vmSelMode = 'exclude'
  else if (job.all) vmSelMode = 'all'

  const ret = job.retention ?? {}
  return {
    schedule:   job.schedule   ?? '',
    storage:    job.storage    ?? '',
    mode:       job.mode       ?? 'snapshot',
    compress:   job.compress   ?? 'zstd',
    enabled:    job.enabled    ?? true,
    comment:    job.comment    ?? '',
    mailto:     job.mailto     ?? '',
    vmSelMode,
    vmids:      job.vmid       ?? '',
    pool:       job.pool       ?? '',
    exclude:    job.exclude    ?? '',
    keepLast:   ret.keep_last    != null ? String(ret.keep_last)    : '',
    keepDaily:  ret.keep_daily   != null ? String(ret.keep_daily)   : '',
    keepWeekly: ret.keep_weekly  != null ? String(ret.keep_weekly)  : '',
    keepMonthly:ret.keep_monthly != null ? String(ret.keep_monthly) : '',
  }
}

/** Convert form state to BackupJobCreateRequest/UpdateRequest payload. */
function buildPayload(form) {
  const retention = {}
  if (form.keepLast    !== '') retention.keep_last    = parseInt(form.keepLast,    10)
  if (form.keepDaily   !== '') retention.keep_daily   = parseInt(form.keepDaily,   10)
  if (form.keepWeekly  !== '') retention.keep_weekly  = parseInt(form.keepWeekly,  10)
  if (form.keepMonthly !== '') retention.keep_monthly = parseInt(form.keepMonthly, 10)

  const payload = {
    schedule:  form.schedule.trim(),
    storage:   form.storage.trim(),
    mode:      form.mode,
    compress:  form.compress,
    enabled:   form.enabled,
    comment:   form.comment.trim(),
    mailto:    form.mailto.trim(),
    all_vms:   false,
    vmids:     '',
    pool:      '',
    exclude:   '',
    retention,
  }

  if (form.vmSelMode === 'all') {
    payload.all_vms = true
  } else if (form.vmSelMode === 'vmids') {
    payload.vmids = form.vmids.trim()
  } else if (form.vmSelMode === 'pool') {
    payload.pool = form.pool.trim()
  } else if (form.vmSelMode === 'exclude') {
    payload.all_vms = true
    payload.exclude = form.exclude.trim()
  }

  return payload
}

const inputCls  = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls  = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls  = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls  = 'space-y-1'

export default function BackupJobFormModal({ node, job, onClose, onSuccess }) {
  const { t } = useTranslation()
  const isEdit = Boolean(job)
  const [form, setForm]       = useState(() => buildInitialState(job))
  const [pools, setPools]     = useState([])
  const [storages, setStorages] = useState([])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  // Fetch pool list for Pool-selection mode
  useEffect(() => {
    if (!node) return
    listBackupJobPools(node)
      .then(data => setPools(data ?? []))
      .catch(() => setPools([]))
  }, [node])

  // Fetch backup-capable storages for the Storage dropdown
  useEffect(() => {
    if (!node) return
    listBackupJobStorages(node)
      .then(data => setStorages(data ?? []))
      .catch(() => setStorages([]))
  }, [node])

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setBool = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))
  const setVal = (key) => (val) => setForm(prev => ({ ...prev, [key]: val }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.schedule.trim()) { setError(t('backup_jobs.val_schedule_required')); return }
    if (!form.storage.trim())  { setError(t('backup_jobs.val_storage_required')); return }
    if (form.vmSelMode === 'vmids' && !form.vmids.trim()) {
      setError(t('backup_jobs.val_vmid_required')); return
    }
    if (form.vmSelMode === 'pool' && !form.pool.trim()) {
      setError(t('backup_jobs.val_pool_required')); return
    }

    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      if (isEdit) {
        await updateBackupJob(node, job.id, payload)
      } else {
        await createBackupJob(node, payload)
      }
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errMsg(err, t))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl w-full max-w-2xl rounded-xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="backup-job-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="backup-job-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('backup_jobs.modal_title_edit', { id: job.id }) : t('backup_jobs.modal_title_new')}
          </h2>
          <button onClick={onClose} aria-label={t('backup_jobs.aria_close')} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form id="backup-job-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {/* Schedule */}
          <div className={fieldCls}>
            <BackupSchedulePicker
              label={t('backup_jobs.field_schedule')}
              value={form.schedule}
              onChange={setVal('schedule')}
            />
          </div>

          {/* Storage */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="bj-storage">{t('backup_jobs.field_storage')} <span className="text-portal-danger">*</span></label>
            {storages.length > 0 ? (
              <select id="bj-storage" value={form.storage} onChange={set('storage')} className={inputCls}>
                <option value="">{t('backup_jobs.storage_select')}</option>
                {storages.map(s => {
                  const sid = s.storage ?? s
                  return (
                    <option key={sid} value={sid}>
                      {sid}{s.type ? ` (${s.type})` : ''}
                    </option>
                  )
                })}
                {/* Keep an unknown existing value selectable on edit */}
                {form.storage && !storages.some(s => (s.storage ?? s) === form.storage) && (
                  <option value={form.storage}>{t('backup_jobs.storage_not_in_list', { storage: form.storage })}</option>
                )}
              </select>
            ) : (
              <input
                id="bj-storage"
                type="text"
                value={form.storage}
                onChange={set('storage')}
                placeholder={t('backup_jobs.storage_ph')}
                className={inputCls}
              />
            )}
            <p className={smallCls}>{t('backup_jobs.storage_hint')}</p>
          </div>

          {/* VM-Auswahl */}
          <div className={fieldCls}>
            <label className={labelCls}>{t('backup_jobs.field_vm_selection')} <span className="text-portal-danger">*</span></label>
            <div className="flex gap-2 flex-wrap">
              {VM_SEL_MODES.map(m => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setForm(prev => ({ ...prev, vmSelMode: m.value }))}
                  className={`px-3 py-1.5 text-xs rounded border transition-colors ${
                    form.vmSelMode === m.value
                      ? 'bg-portal-accent border-portal-accent text-white'
                      : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:border-portal-accent'
                  }`}
                >
                  {t(`backup_jobs.${m.labelKey}`)}
                </button>
              ))}
            </div>

            {/* Conditional sub-inputs */}
            {form.vmSelMode === 'vmids' && (
              <div className="mt-2">
                <VmMultiSelect
                  pveNode={node}
                  value={form.vmids}
                  onChange={setVal('vmids')}
                  emptyHint={t('backup_jobs.vmids_empty_hint')}
                />
              </div>
            )}
            {form.vmSelMode === 'pool' && (
              <div className="mt-2">
                {pools.length > 0 ? (
                  <select value={form.pool} onChange={set('pool')} className={inputCls}>
                    <option value="">{t('backup_jobs.pool_select')}</option>
                    {pools.map(p => (
                      <option key={p.poolid ?? p} value={p.poolid ?? p}>
                        {p.poolid ?? p}{p.comment ? ` – ${p.comment}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={form.pool}
                    onChange={set('pool')}
                    placeholder={t('backup_jobs.pool_ph')}
                    className={inputCls}
                  />
                )}
              </div>
            )}
            {form.vmSelMode === 'exclude' && (
              <div className="mt-2">
                <p className={`${smallCls} mb-2`}>{t('backup_jobs.exclude_hint')}</p>
                <VmMultiSelect
                  pveNode={node}
                  value={form.exclude}
                  onChange={setVal('exclude')}
                  emptyHint={t('backup_jobs.exclude_empty_hint')}
                />
              </div>
            )}
          </div>

          {/* Row: Mode + Compress */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-mode">{t('backup_jobs.field_mode')}</label>
              <select id="bj-mode" value={form.mode} onChange={set('mode')} className={inputCls}>
                {MODE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{t(`backup_jobs.${o.labelKey}`)}</option>
                ))}
              </select>
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-compress">{t('backup_jobs.field_compress')}</label>
              <select id="bj-compress" value={form.compress} onChange={set('compress')} className={inputCls}>
                {COMPRESS_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{t(`backup_jobs.${o.labelKey}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Retention */}
          <div>
            <p className={labelCls}>{t('backup_jobs.field_retention')}</p>
            <div className="grid grid-cols-4 gap-3">
              {[
                { key: 'keepLast',    label: t('backup_jobs.ret_label_keep_last'),    id: 'bj-keep-last'    },
                { key: 'keepDaily',   label: t('backup_jobs.ret_label_keep_daily'),   id: 'bj-keep-daily'   },
                { key: 'keepWeekly',  label: t('backup_jobs.ret_label_keep_weekly'),  id: 'bj-keep-weekly'  },
                { key: 'keepMonthly', label: t('backup_jobs.ret_label_keep_monthly'), id: 'bj-keep-monthly' },
              ].map(({ key, label, id }) => (
                <div key={key} className={fieldCls}>
                  <label className={labelCls} htmlFor={id}>{label}</label>
                  <input
                    id={id}
                    type="number"
                    min="0"
                    value={form[key]}
                    onChange={set(key)}
                    placeholder="–"
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Mail + Comment */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-mailto">{t('backup_jobs.field_mailto')}</label>
              <input
                id="bj-mailto"
                type="text"
                value={form.mailto}
                onChange={set('mailto')}
                placeholder={t('backup_jobs.mailto_ph')}
                className={inputCls}
              />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="bj-comment">{t('backup_jobs.field_comment')}</label>
              <input
                id="bj-comment"
                type="text"
                value={form.comment}
                onChange={set('comment')}
                placeholder={t('backup_jobs.comment_ph')}
                className={inputCls}
              />
            </div>
          </div>

          {/* Enabled toggle */}
          <div className="flex items-center gap-3">
            <input
              id="bj-enabled"
              type="checkbox"
              checked={form.enabled}
              onChange={setBool('enabled')}
              className="w-4 h-4 rounded accent-portal-accent"
            />
            <label htmlFor="bj-enabled" className="text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
              {t('backup_jobs.enabled_label')}
            </label>
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            {t('backup_jobs.btn_cancel')}
          </button>
          <button type="submit" form="backup-job-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? t('backup_jobs.btn_save') : t('backup_jobs.btn_save_new')}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
