// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getNodeBackups } from '../../api/cluster'

const STATUS_STYLE = {
  OK:      { dot: 'bg-portal-success',  text: 'text-portal-success',  label: 'OK' },
  ok:      { dot: 'bg-portal-success',  text: 'text-portal-success',  label: 'OK' },
  RUNNING: { dot: 'bg-portal-accent', text: 'text-portal-accent', label: 'Running' },
  running: { dot: 'bg-portal-accent', text: 'text-portal-accent', label: 'Running' },
  ERROR:   { dot: 'bg-portal-danger',    text: 'text-portal-danger',       label: 'ERROR' },
  error:   { dot: 'bg-portal-danger',    text: 'text-portal-danger',       label: 'ERROR' },
}

function getStatusStyle(status) {
  return STATUS_STYLE[status] ?? { dot: 'bg-gray-400', text: 'text-gray-500 dark:text-zinc-400', label: status }
}

function formatTs(ts) {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(seconds) {
  if (seconds == null) return '–'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default function ComputeBackupsTab({ nodeName, active }) {
  const { t } = useTranslation()
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]    = useState(null)
  const loadedFor = useRef(null)

  useEffect(() => {
    if (!active || !nodeName) return
    if (loadedFor.current === nodeName) return
    loadedFor.current = nodeName
    setLoading(true)
    setError(null)
    getNodeBackups(nodeName)
      .then(data => setBackups(data))
      .catch(err => setError(err?.response?.status === 403 ? '403' : t('backup_jobs.backups_load_error')))
      .finally(() => setLoading(false))
  }, [active, nodeName, t])

  useEffect(() => {
    loadedFor.current = null
    setBackups([])
    setError(null)
  }, [nodeName])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (error === '403') {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">{t('backup_jobs.backups_no_access_title')}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          {t('backup_jobs.backups_no_access_body')}
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
        {error}
      </div>
    )
  }

  if (backups.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">
        {t('backup_jobs.backups_empty')}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700">
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.backups_col_vmid')}</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.backups_col_status')}</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.backups_col_starttime')}</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('backup_jobs.backups_col_duration')}</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900">
          {backups.map(b => {
            const s = getStatusStyle(b.status)
            return (
              <tr key={b.upid} className="border-b border-gray-100 dark:border-zinc-800 last:border-0">
                <td className="px-4 py-2.5 text-xs font-mono text-gray-600 dark:text-zinc-300">{b.vmid ?? '–'}</td>
                <td className="px-4 py-2.5">
                  <span className={`flex items-center gap-1.5 text-xs ${s.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
                    {s.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">{formatTs(b.starttime)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400">{formatDuration(b.duration)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
