// p3portal.org
/**
 * PROJ-78: Datacenter-wide Proxmox backup job management tab.
 * Shows all scheduled backup jobs for the Proxmox installation a node belongs to.
 * Provides CRUD + run-now for users with manage_backup_jobs or admin role.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { listBackupJobs, deleteBackupJob, updateBackupJob, runBackupNow } from '../../api/backupJobs'
import BackupJobFormModal from './BackupJobFormModal'
import ConfirmModal from '../common/ConfirmModal'

// ── Helper: human-readable schedule hint ────────────────────────────────────

function scheduleHint(schedule, t) {
  if (!schedule) return ''
  const s = schedule.trim()
  // Simple Proxmox calendar-event / cron display
  if (s.match(/^\d{2}:\d{2}$/)) return t('backup_jobs.hint_daily_at', { time: s })
  if (s === 'daily')             return t('backup_jobs.hint_daily')
  if (s === 'weekly')            return t('backup_jobs.hint_weekly')
  if (s === 'monthly')           return t('backup_jobs.hint_monthly')
  return ''
}

// ── Helper: VM-Auswahl Kurzform ───────────────────────────────────────────────

function vmSelLabel(job, t) {
  if (job.vmid)                    return t('backup_jobs.vm_sel_vmids', { vmid: job.vmid })
  if (job.pool)                    return t('backup_jobs.vm_sel_pool', { pool: job.pool })
  if (job.all && job.exclude)      return t('backup_jobs.vm_sel_all_except', { exclude: job.exclude })
  if (job.all)                     return t('backup_jobs.vm_sel_all')
  return t('backup_jobs.dash')
}

// ── Helper: Retention Kurzform ────────────────────────────────────────────────

function retentionLabel(retention, t) {
  if (!retention) return t('backup_jobs.dash')
  const parts = []
  if (retention.keep_last    != null) parts.push(t('backup_jobs.ret_keep_last',    { count: retention.keep_last }))
  if (retention.keep_daily   != null) parts.push(t('backup_jobs.ret_keep_daily',   { count: retention.keep_daily }))
  if (retention.keep_weekly  != null) parts.push(t('backup_jobs.ret_keep_weekly',  { count: retention.keep_weekly }))
  if (retention.keep_monthly != null) parts.push(t('backup_jobs.ret_keep_monthly', { count: retention.keep_monthly }))
  return parts.length > 0 ? parts.join(', ') : t('backup_jobs.dash')
}

// ── Helper: error message from API error ──────────────────────────────────────

function apiErrMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('backup_jobs.err_403')
  if (s === 503) return t('backup_jobs.err_503')
  if (s === 502) return t('backup_jobs.err_502')
  return (typeof d === 'string' ? d : null) ?? t('backup_jobs.err_generic')
}

// ── Aktionen-Button-Leiste ────────────────────────────────────────────────────

function JobActions({ job, onEdit, onDelete, onRun, busy, t }) {
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <button
        onClick={() => onEdit(job)}
        disabled={busy}
        className="btn-table"
        title={t('backup_jobs.title_edit')}
      >
        {t('backup_jobs.btn_edit')}
      </button>
      <button
        onClick={() => onRun(job)}
        disabled={busy}
        className="btn-table"
        title={t('backup_jobs.title_run_now')}
      >
        {t('backup_jobs.btn_run_now')}
      </button>
      <button
        onClick={() => onDelete(job)}
        disabled={busy}
        className="btn-table-danger"
        title={t('backup_jobs.title_delete')}
      >
        {t('backup_jobs.btn_delete')}
      </button>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ComputeBackupJobsTab({ nodeName, active }) {
  const { t } = useTranslation()
  const [data, setData]           = useState(null)   // { jobs, permission_denied, node_unreachable }
  const [loading, setLoading]     = useState(false)
  const [togglingId, setTogglingId] = useState(null) // job id being toggled

  // Modal states
  const [formJob, setFormJob]         = useState(undefined) // undefined = closed, null = create, obj = edit
  const [deleteJob, setDeleteJob]     = useState(null)
  const [runJob, setRunJob]           = useState(null)
  const [runResult, setRunResult]     = useState(null)  // { tasks: [...] } after run-now
  const [actionError, setActionError] = useState('')

  const load = useCallback(() => {
    if (!nodeName) return
    setLoading(true)
    listBackupJobs(nodeName)
      .then(d => setData(d))
      .catch(err => setData({ jobs: [], node_unreachable: true, detail: apiErrMsg(err, t) }))
      .finally(() => setLoading(false))
  }, [nodeName, t])

  useEffect(() => {
    if (!active) return
    load()
  }, [active, load])

  // Reset on node change
  useEffect(() => {
    setData(null)
    setFormJob(undefined)
    setDeleteJob(null)
    setRunJob(null)
    setRunResult(null)
    setActionError('')
  }, [nodeName])

  // ── Aktiv-Toggle ──────────────────────────────────────────────────────────

  const handleToggleEnabled = async (job) => {
    setTogglingId(job.id)
    setActionError('')
    try {
      // Build minimal update payload mirroring the full job but flipping enabled
      const payload = {
        schedule: job.schedule,
        storage:  job.storage,
        mode:     job.mode,
        compress: job.compress || 'zstd',
        enabled:  !job.enabled,
        comment:  job.comment || '',
        mailto:   job.mailto  || '',
        all_vms:  Boolean(job.all && !job.exclude),
        vmids:    job.vmid    || '',
        pool:     job.pool    || '',
        exclude:  job.exclude || '',
        retention: job.retention ?? {},
      }
      // Handle all+exclude case
      if (job.all && job.exclude) {
        payload.all_vms = true
        payload.exclude = job.exclude
      }
      await updateBackupJob(nodeName, job.id, payload)
      // Optimistic update
      setData(prev => prev ? {
        ...prev,
        jobs: prev.jobs.map(j => j.id === job.id ? { ...j, enabled: !j.enabled } : j),
      } : prev)
    } catch (err) {
      setActionError(apiErrMsg(err, t))
    } finally {
      setTogglingId(null)
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDeleteConfirm = async () => {
    try {
      await deleteBackupJob(nodeName, deleteJob.id)
      load()
    } catch (err) {
      throw new Error(apiErrMsg(err, t))
    }
  }

  // ── Run now ───────────────────────────────────────────────────────────────

  const handleRunConfirm = async () => {
    try {
      const result = await runBackupNow(nodeName, runJob.id)
      setRunResult(result)
      // Don't close automatically – show result to user; user closes via "OK"
    } catch (err) {
      throw new Error(apiErrMsg(err, t))
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (data?.node_unreachable) {
    return (
      <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
        {t('backup_jobs.node_unreachable')}
        {data.detail && (
          <span className="block mt-1 text-xs text-portal-warn/90">
            {t('backup_jobs.node_unreachable_cause', { detail: data.detail })}
          </span>
        )}
      </div>
    )
  }

  if (data?.permission_denied) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">{t('backup_jobs.no_access_title')}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          {t('backup_jobs.no_access_body')}
        </p>
      </div>
    )
  }

  const jobs = data?.jobs ?? []

  return (
    <div className="space-y-3">
      {/* Datacenter-hint + action button */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          {t('backup_jobs.datacenter_hint')}
        </p>
        <button
          onClick={() => { setActionError(''); setFormJob(null) }}
          className="btn-primary shrink-0"
        >
          {t('backup_jobs.btn_create')}
        </button>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 underline text-xs">{t('backup_jobs.btn_close')}</button>
        </div>
      )}

      {/* Run-now result */}
      {runResult && (
        <div className="rounded-lg border border-portal-success/30 bg-portal-success/10 px-4 py-3 text-sm text-portal-success">
          <strong>{t('backup_jobs.run_result_started', { count: runResult.tasks?.length ?? 0 })}</strong>{' '}
          {t('backup_jobs.run_result_followup')}
          <ul className="mt-1 text-xs space-y-0.5">
            {(runResult.tasks ?? []).map((task, i) => (
              <li key={i}>
                <span className="font-mono">{task.node}</span>: UPID <span className="font-mono text-[10px]">{task.upid}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => setRunResult(null)} className="mt-1 underline text-xs">{t('backup_jobs.btn_close')}</button>
        </div>
      )}

      {/* Empty state */}
      {jobs.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-400 dark:text-zinc-500">
          {t('backup_jobs.empty')}
        </div>
      )}

      {/* Job table */}
      {jobs.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_id')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_schedule')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_storage')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_target')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_mode')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_retention')}</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_enabled')}</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {jobs.map(job => {
                  const hint = scheduleHint(job.schedule, t)
                  const toggling = togglingId === job.id
                  return (
                    <tr key={job.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                      <td className="px-3 py-2.5 text-[11px] font-mono text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        {job.id}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-medium text-gray-800 dark:text-zinc-200">
                          {job.schedule}
                        </span>
                        {hint && (
                          <span className="block text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5">
                            {hint}
                          </span>
                        )}
                        {job.comment && (
                          <span className="block text-[10px] text-gray-400 dark:text-zinc-500 mt-0.5 truncate max-w-[140px]" title={job.comment}>
                            {job.comment}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-300 whitespace-nowrap">
                        {job.storage}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-300 max-w-[160px] truncate" title={vmSelLabel(job, t)}>
                        {vmSelLabel(job, t)}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        <span className="capitalize">{job.mode}</span>
                        {job.compress && job.compress !== '0' && (
                          <span className="block text-[10px] text-gray-400 dark:text-zinc-500">{job.compress}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                        {retentionLabel(job.retention, t)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <button
                          onClick={() => handleToggleEnabled(job)}
                          disabled={toggling}
                          title={job.enabled ? t('backup_jobs.toggle_title_active') : t('backup_jobs.toggle_title_inactive')}
                          className={`w-8 h-5 rounded-full transition-colors focus:outline-none ${
                            toggling ? 'opacity-40 cursor-not-allowed' :
                            job.enabled
                              ? 'bg-portal-success hover:bg-portal-success'
                              : 'bg-gray-300 dark:bg-zinc-600 hover:bg-gray-400'
                          }`}
                          aria-label={job.enabled ? t('backup_jobs.toggle_aria_active') : t('backup_jobs.toggle_aria_inactive')}
                        >
                          <span
                            className={`block w-3.5 h-3.5 bg-white rounded-full shadow-sm transition-transform mx-0.5 ${
                              job.enabled ? 'translate-x-3' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <JobActions
                          job={job}
                          onEdit={j => { setActionError(''); setFormJob(j) }}
                          onDelete={j => { setActionError(''); setDeleteJob(j); setRunResult(null) }}
                          onRun={j => { setActionError(''); setRunJob(j); setRunResult(null) }}
                          busy={toggling}
                          t={t}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Form modal: create (formJob===null) or edit (formJob===object) */}
      {formJob !== undefined && (
        <BackupJobFormModal
          node={nodeName}
          job={formJob}
          onClose={() => setFormJob(undefined)}
          onSuccess={() => { setFormJob(undefined); load() }}
        />
      )}

      {/* Delete confirm modal */}
      {deleteJob && (
        <ConfirmModal
          title={t('backup_jobs.delete_modal_title')}
          body={
            <>
              <p>{t('backup_jobs.delete_modal_confirm', { id: deleteJob.id })}</p>
              <p className="mt-2 text-xs text-gray-400 dark:text-zinc-500">
                {t('backup_jobs.delete_modal_hint')}
              </p>
            </>
          }
          confirmLabel={t('backup_jobs.delete_modal_btn')}
          variant="danger"
          onConfirm={handleDeleteConfirm}
          onClose={() => setDeleteJob(null)}
        />
      )}

      {/* Run-now confirm modal */}
      {runJob && !runResult && (
        <ConfirmModal
          title={t('backup_jobs.run_modal_title')}
          body={
            <>
              <p>{t('backup_jobs.run_modal_confirm', { id: runJob.id })}</p>
              <p className="mt-2 text-xs text-portal-warn">
                {t('backup_jobs.run_modal_hint')}
              </p>
            </>
          }
          confirmLabel={t('backup_jobs.run_modal_btn')}
          variant="primary"
          onConfirm={handleRunConfirm}
          onClose={() => setRunJob(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
