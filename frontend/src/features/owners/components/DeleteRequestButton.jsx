// p3portal.org
// PROJ-48: Löschantrag-Button für Owner (PROJ-50-Stub, AC-RES-3/AC-ADOPT-4).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function DeleteRequestButton({ hasPendingRequest, onDeleteRequest }) {
  const { t } = useTranslation()
  const [showForm, setShowForm] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  if (hasPendingRequest || done) {
    return (
      <span className="text-xs text-portal-warn flex items-center gap-1">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        {t('owners.delete_request_pending')}
      </span>
    )
  }

  if (showForm) {
    return (
      <div className="mt-2 space-y-2">
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={t('owners.delete_request_reason_placeholder')}
          rows={2}
          className="w-full text-xs border border-gray-300 dark:border-zinc-600 rounded px-2 py-1.5 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 resize-none focus:outline-none focus:ring-1 focus:ring-portal-accent"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await onDeleteRequest(reason)
              setDone(true)
              setBusy(false)
            }}
            className="btn-danger"
          >
            {busy ? '…' : t('owners.delete_request_submit')}
          </button>
          <button type="button" onClick={() => setShowForm(false)}
            className="btn-secondary">
            {t('common.cancel')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setShowForm(true)}
      className="btn-table-danger"
    >
      {t('owners.delete_request_btn')}
    </button>
  )
}
