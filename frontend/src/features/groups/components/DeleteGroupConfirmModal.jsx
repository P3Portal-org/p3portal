// p3portal.org
// PROJ-45: Bestätigungs-Modal für das Löschen einer Gruppe (AC-6).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { groupsApi } from '../api'
import { formatApiError } from '../../../api/errors'

export default function DeleteGroupConfirmModal({ group, onSuccess, onClose }) {
  const { t }       = useTranslation()
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setBusy(true)
    setError('')
    try {
      await groupsApi.remove(group.id)
      onSuccess()
    } catch (err) {
      setError(formatApiError(err, t('groups.delete_error')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {t('groups.delete_title')}
          </h2>
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-zinc-300">
            {t('groups.delete_confirm', { name: group.name })}
          </p>

          {group.member_count > 0 && (
            <div className="flex items-start gap-2 text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded-lg px-3 py-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{t('groups.delete_members_hint', { count: group.member_count })}</span>
            </div>
          )}

          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="btn-danger"
          >
            {busy ? '…' : t('common.delete')}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
