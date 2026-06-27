// p3portal.org
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchAllowlistEntries, createAllowlistEntry, deleteAllowlistEntry } from '../../api/webhook_allowlist'

export default function WebhookAllowlistSection() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [pattern, setPattern] = useState('')
  const [allowHttp, setAllowHttp] = useState(false)
  const [addError, setAddError] = useState('')

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['webhook-allowlist'],
    queryFn: fetchAllowlistEntries,
  })

  const addMutation = useMutation({
    mutationFn: () => createAllowlistEntry(pattern.trim(), allowHttp),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['webhook-allowlist'] })
      setPattern('')
      setAllowHttp(false)
      setAddError('')
    },
    onError: (err) => {
      const detail = err.response?.data?.detail
      setAddError(typeof detail === 'string' ? detail : t('admin.security.allowlist_add_error'))
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAllowlistEntry,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhook-allowlist'] }),
  })

  const handleAdd = (e) => {
    e.preventDefault()
    if (!pattern.trim()) return
    setAddError('')
    addMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-portal-text mb-1">
          {t('admin.security.allowlist_title')}
        </h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('admin.security.allowlist_description')}
        </p>
      </div>

      {/* Einträge */}
      <div className="bg-white dark:bg-zinc-900 border border-portal-border rounded-lg divide-y divide-zinc-100 dark:divide-zinc-800">
        {isLoading ? (
          <div className="px-4 py-3 text-sm text-zinc-400">{t('common.loading')}</div>
        ) : entries.length === 0 ? (
          <div className="px-4 py-3 text-sm text-zinc-400 text-center">
            {t('admin.security.allowlist_empty')}
          </div>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="px-4 py-2.5 flex items-center gap-3">
              <code className="flex-1 font-mono text-xs text-portal-text truncate">
                {entry.pattern}
              </code>
              {entry.allow_http && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-portal-warn/15 text-portal-warn shrink-0">
                  HTTP
                </span>
              )}
              <span className="text-xs text-zinc-400 shrink-0 hidden sm:block">
                {entry.created_by}
              </span>
              <button
                onClick={() => deleteMutation.mutate(entry.id)}
                disabled={deleteMutation.isPending}
                className="btn-table-danger shrink-0"
              >
                {t('common.delete')}
              </button>
            </div>
          ))
        )}
      </div>

      {/* Neuen Eintrag hinzufügen */}
      <form onSubmit={handleAdd} className="space-y-3">
        <p className="text-xs font-medium text-portal-text">{t('admin.security.allowlist_add')}</p>
        <div className="flex gap-2 flex-wrap">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={t('admin.security.allowlist_placeholder')}
            className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-portal-border bg-white dark:bg-zinc-800 text-portal-text focus:outline-none focus:ring-2 focus:ring-portal-accent"
          />
          <label className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={allowHttp}
              onChange={(e) => setAllowHttp(e.target.checked)}
              className="rounded"
            />
            HTTP erlauben
          </label>
          <button
            type="submit"
            disabled={!pattern.trim() || addMutation.isPending}
            className="btn-primary shrink-0"
          >
            {addMutation.isPending ? '…' : t('common.add')}
          </button>
        </div>
        {addError && (
          <p className="text-xs text-portal-danger">{addError}</p>
        )}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {t('admin.security.allowlist_hint')}
        </p>
      </form>
    </div>
  )
}
