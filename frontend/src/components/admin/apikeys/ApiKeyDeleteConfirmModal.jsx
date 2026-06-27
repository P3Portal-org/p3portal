// p3portal.org
import { useState } from 'react'
import { deleteApiKey } from '../../../api/apikeys'

export default function ApiKeyDeleteConfirmModal({ apiKey, onClose, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteApiKey(apiKey.id)
      onDeleted()
    } catch (ex) {
      setError(ex.response?.data?.detail ?? 'Key konnte nicht gelöscht werden.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">API-Key löschen</h2>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-sm text-gray-700 dark:text-zinc-300">
            Soll der Key <strong className="text-gray-900 dark:text-zinc-100">{apiKey.name}</strong> endgültig gelöscht werden?
          </p>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Diese Aktion kann nicht rückgängig gemacht werden. Audit-Log-Einträge des Keys bleiben erhalten.
          </p>
          {error && (
            <p className="text-xs text-portal-danger bg-portal-danger/10 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 pb-6">
          <button
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            Abbrechen
          </button>
          <button
            onClick={handleDelete}
            disabled={busy}
            className="btn-danger"
          >
            {busy ? 'Lösche…' : 'Ja, endgültig löschen'}
          </button>
        </div>
      </div>
    </div>
  )
}
