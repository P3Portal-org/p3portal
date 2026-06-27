// p3portal.org
import { useState } from 'react'

export default function ConfirmModal({
  title,
  body,
  confirmLabel = 'OK',
  cancelLabel = 'Abbrechen',
  variant = 'primary', // 'primary' | 'danger'
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await onConfirm?.()
      onClose?.()
    } catch (err) {
      setError(err.message || 'Ein Fehler ist aufgetreten.')
    } finally {
      setBusy(false)
    }
  }

  const confirmCls = variant === 'danger' ? 'btn-danger' : 'btn-primary'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 id="confirm-modal-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {title}
          </h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          {body && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">{body}</p>
          )}
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={confirmCls}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
