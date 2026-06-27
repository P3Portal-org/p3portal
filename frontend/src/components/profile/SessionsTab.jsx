// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { getSessions, revokeSession, revokeAllOtherSessions } from '../../api/profile'

function formatDateTime(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SessionsTab() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    getSessions()
      .then(setSessions)
      .catch(() => setError('Sessions konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleRevoke = async (id) => {
    setError('')
    setBusy(id)
    try {
      await revokeSession(id)
      setSessions(s => s.filter(x => x.id !== id))
    } catch {
      setError('Fehler beim Beenden der Session.')
    } finally {
      setBusy(null)
    }
  }

  const handleRevokeAll = async () => {
    setError('')
    setBusy('all')
    try {
      await revokeAllOtherSessions()
      setSessions(s => s.filter(x => x.is_current))
    } catch {
      setError('Fehler beim Beenden der Sessions.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <p className="text-sm text-gray-400 dark:text-zinc-500 py-4">Lädt…</p>

  const others = sessions.filter(s => !s.is_current)

  return (
    <div className="space-y-4">
      {error && (
        <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">{error}</p>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500">Keine aktiven Sessions gefunden.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <div
              key={s.id}
              className={`flex items-start justify-between gap-4 p-3 border ${
                s.is_current
                  ? 'border-portal-accent/30 bg-portal-accent/10'
                  : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50'
              }`}
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  {s.is_current && (
                    <span className="text-xs bg-portal-accent/10 text-portal-accent border border-portal-accent/30 px-1.5 py-0.5">
                      Diese Sitzung
                    </span>
                  )}
                  <span className="text-xs text-gray-500 dark:text-zinc-500 font-mono truncate">
                    {s.ip_address ?? 'Unbekannte IP'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 dark:text-zinc-600 truncate">
                  {s.user_agent ?? 'Unbekannter Browser'}
                </p>
                <p className="text-xs text-gray-400 dark:text-zinc-600">
                  Angemeldet: {formatDateTime(s.created_at)}
                  &nbsp;·&nbsp;
                  Läuft ab: {formatDateTime(s.expires_at)}
                </p>
              </div>
              {!s.is_current && (
                <button
                  onClick={() => handleRevoke(s.id)}
                  disabled={busy === s.id}
                  className="shrink-0 btn-table-danger"
                >
                  {busy === s.id ? '…' : 'Beenden'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {others.length > 0 && (
        <button
          onClick={handleRevokeAll}
          disabled={busy === 'all'}
          className="btn-danger"
        >
          {busy === 'all' ? 'Beende…' : `Alle anderen Sessions beenden (${others.length})`}
        </button>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
