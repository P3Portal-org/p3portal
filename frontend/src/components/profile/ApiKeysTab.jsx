// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { listMyApiKeys, revokeMyApiKey } from '../../api/userApiKeys'
import { useCapability } from '../../hooks/useCapability'
import ApiKeyCreateModal from './ApiKeyCreateModal'

function formatDate(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function ScopeTag({ scope }) {
  return (
    <span className="inline-block text-xs font-mono bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700 px-1.5 py-0.5">
      {scope}
    </span>
  )
}

export default function ApiKeysTab({ allowedScopes, maxKeys }) {
  const isPlus = useCapability('api_key_max_count_override')
  const [keys, setKeys]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [showModal, setShowModal] = useState(false)
  const [revoking, setRevoking]   = useState(null)
  const [revokeErr, setRevokeErr] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    listMyApiKeys()
      .then(setKeys)
      .catch(() => setError('API-Keys konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleRevoke = async (id) => {
    setRevokeErr('')
    setRevoking(id)
    try {
      await revokeMyApiKey(id)
      setKeys(prev => prev.filter(k => k.id !== id))
    } catch {
      setRevokeErr('Fehler beim Widerrufen des Keys.')
    } finally {
      setRevoking(null)
    }
  }

  const activeCount  = keys.filter(k => k.is_active).length
  const atLimit      = maxKeys != null && activeCount >= maxKeys

  if (loading) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
        <p className="text-sm text-gray-400 dark:text-zinc-500">Lädt…</p>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6 space-y-4">
      {/* Info + create button */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-gray-600 dark:text-zinc-400">
            Persönliche API-Keys für Skripte, CI/CD-Pipelines und Automationen.
          </p>
          {maxKeys != null && (
            <p className={`text-xs mt-0.5 ${atLimit ? 'text-portal-danger' : 'text-gray-400 dark:text-zinc-500'}`}>
              {activeCount} / {maxKeys} aktive Keys
              {!isPlus && maxKeys === 1 && (
                <span className="ml-2 text-gray-400 dark:text-zinc-600">– Upgrade auf P3 Plus für mehr Keys</span>
              )}
            </p>
          )}
        </div>
        <div className="relative group shrink-0">
          <button
            onClick={() => !atLimit && setShowModal(true)}
            disabled={atLimit}
            className="btn-primary flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Neuer Key
          </button>
          {atLimit && (
            <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block w-52 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2.5 py-1.5 shadow-lg pointer-events-none">
              {isPlus ? 'Limit erreicht – vom Admin konfigurierbar' : 'Limit erreicht – Upgrade auf P3 Plus'}
            </div>
          )}
        </div>
      </div>

      {error && (
        <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">{error}</p>
      )}
      {revokeErr && (
        <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">{revokeErr}</p>
      )}

      {/* Key list */}
      {keys.length === 0 ? (
        <div className="border border-dashed border-gray-200 dark:border-zinc-700 p-8 text-center">
          <p className="text-sm text-gray-400 dark:text-zinc-500">Noch keine API-Keys erstellt.</p>
          <p className="text-xs text-gray-300 dark:text-zinc-600 mt-1">
            Erstelle einen Key, um das Portal programmatisch zu nutzen.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map(k => (
            <div
              key={k.id}
              className={`p-4 border ${
                k.is_active
                  ? 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50'
                  : 'border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900/50 opacity-60'
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-900 dark:text-zinc-100">{k.name}</span>
                    {!k.is_active && (
                      <span className="text-xs bg-portal-danger/10 text-portal-danger border border-portal-danger/30 px-1.5 py-0.5">
                        Widerrufen
                      </span>
                    )}
                    {k.is_active && k.expires_at && new Date(k.expires_at) < new Date() && (
                      <span className="text-xs bg-portal-warn/10 text-portal-warn border border-portal-warn/30 px-1.5 py-0.5">
                        Abgelaufen
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-mono text-gray-500 dark:text-zinc-500">
                    {k.key_prefix}…
                  </p>

                  <div className="flex flex-wrap gap-1">
                    {k.scopes.map(s => <ScopeTag key={s} scope={s} />)}
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400 dark:text-zinc-600 pt-0.5">
                    <span>Erstellt: {formatDate(k.created_at)}</span>
                    <span>Läuft ab: {k.expires_at ? formatDate(k.expires_at) : 'Nie'}</span>
                    <span>Letzter Zugriff: {formatDate(k.last_used_at)}</span>
                  </div>
                </div>

                {k.is_active && (
                  <button
                    onClick={() => handleRevoke(k.id)}
                    disabled={revoking === k.id}
                    className="btn-table-danger shrink-0"
                  >
                    {revoking === k.id ? '…' : 'Widerrufen'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <ApiKeyCreateModal
          allowedScopes={allowedScopes}
          onCreated={load}
          onClose={() => setShowModal(false)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
