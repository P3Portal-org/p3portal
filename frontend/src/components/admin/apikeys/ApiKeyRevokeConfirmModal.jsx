// p3portal.org
import { useState } from 'react'
import { revokeApiKey } from '../../../api/apikeys'

export default function ApiKeyRevokeConfirmModal({ apiKey, onClose, onRevoked }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleRevoke = async () => {
    setBusy(true)
    setError('')
    try {
      await revokeApiKey(apiKey.id)
      onRevoked()
    } catch (ex) {
      setError(ex.response?.data?.detail ?? 'Key konnte nicht widerrufen werden.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">API-Key widerrufen</h2>
        </div>

        <div className="p-6 space-y-3">
          <p className="text-sm text-gray-700 dark:text-zinc-300">
            Soll der Key <strong className="text-gray-900 dark:text-zinc-100">{apiKey.name}</strong> widerrufen werden?
          </p>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Der Key wird sofort ungültig. Alle laufenden Requests, die diesen Key nutzen, erhalten danach <code className="font-mono">401 Unauthorized</code>. Der Key bleibt in der Liste sichtbar.
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
            onClick={handleRevoke}
            disabled={busy}
            className="btn-danger"
          >
            {busy ? 'Widerrufe…' : 'Ja, widerrufen'}
          </button>
        </div>
      </div>
    </div>
  )
}
