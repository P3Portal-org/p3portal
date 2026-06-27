// p3portal.org
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createMyApiKey, getScopeManifest } from '../../api/userApiKeys'
import PlusBadge from '../common/PlusBadge'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'

const EXPIRY_OPTIONS = [
  { value: 30,   label: '30 Tage' },
  { value: 90,   label: '90 Tage' },
  { value: 180,  label: '180 Tage' },
  { value: 365,  label: '1 Jahr (Standard)' },
  { value: null, label: 'Unbegrenzt' },
]

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] transition'

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ScopeRow({ entry, isAllowed, selected, onToggle, expandedCurl, onToggleCurl, createdKey }) {
  const [endpointsOpen, setEndpointsOpen] = useState(false)
  const disabled = !isAllowed

  const curlText = entry.curl_example
    ? entry.curl_example
        .replace('<KEY>', createdKey?.plaintext_key ?? '<KEY>')
        .replace('<HOST>', window.location.origin)
    : ''

  return (
    <div className={`border rounded-md transition-colors ${
      selected
        ? 'border-[var(--accent)] bg-[var(--accent)]/5'
        : disabled
          ? 'border-gray-200 dark:border-zinc-700 opacity-50'
          : 'border-gray-200 dark:border-zinc-700 hover:border-[var(--accent)]/50'
    }`}>
      <label className={`flex items-start gap-3 p-3 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
        <input
          type="checkbox"
          checked={selected}
          disabled={disabled}
          onChange={() => !disabled && onToggle(entry.name)}
          className="mt-0.5 accent-[var(--accent)]"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-mono font-semibold text-gray-900 dark:text-zinc-100">{entry.name}</span>
            {entry.plus_only && <PlusBadge />}
            {disabled && (
              <span className="text-xs text-gray-400 dark:text-zinc-500 italic">
                Nicht freigeschaltet – frage einen Admin
              </span>
            )}
          </div>
        </div>
      </label>

      {/* Endpoint-Liste (expandable) */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={() => setEndpointsOpen(o => !o)}
          className="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
        >
          <ChevronIcon open={endpointsOpen} />
          {endpointsOpen ? 'Endpunkte ausblenden' : `${entry.endpoints.length} Endpunkt${entry.endpoints.length !== 1 ? 'e' : ''}`}
        </button>

        {endpointsOpen && (
          <div className="mt-2 space-y-1">
            {entry.endpoints.map((ep, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                  ep.method === 'GET'    ? 'bg-portal-info/10 text-portal-info' :
                  ep.method === 'POST'   ? 'bg-portal-success/10 text-portal-success' :
                  ep.method === 'DELETE' ? 'bg-portal-danger/10 text-portal-danger' :
                                           'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                }`}>{ep.method}</span>
                <span className="text-gray-600 dark:text-zinc-400">{ep.path}</span>
              </div>
            ))}
          </div>
        )}

        {/* curl-Beispiel */}
        {selected && curlText && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => onToggleCurl(entry.name)}
              className="flex items-center gap-1 text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
            >
              <ChevronIcon open={expandedCurl} />
              curl-Beispiel
            </button>
            {expandedCurl && (
              <pre className="mt-1.5 p-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded text-xs font-mono text-gray-700 dark:text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all">
                {curlText}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ApiKeyCreateModal({ onCreated, onClose }) {
  const [name, setName]           = useState('')
  const [scopes, setScopes]       = useState([])
  const [expiry, setExpiry]       = useState(365)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [createdKey, setCreatedKey] = useState(null)
  const [copied, setCopied]       = useState(false)
  const [expandedCurls, setExpandedCurls] = useState({})

  const { data: manifest } = useQuery({
    queryKey: ['scope-manifest'],
    queryFn: getScopeManifest,
    staleTime: 5 * 60 * 1000,
  })

  const allScopes = manifest?.scopes ?? []
  const allowedScopes = manifest?.allowed_scopes ?? null

  const isAllowed = (scopeName) => {
    if (!allowedScopes || allowedScopes.length === 0) return true
    return allowedScopes.includes(scopeName)
  }

  const toggleScope = (val) => {
    setScopes(prev =>
      prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    )
  }

  const toggleCurl = (scopeName) => {
    setExpandedCurls(prev => ({ ...prev, [scopeName]: !prev[scopeName] }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (scopes.length === 0) {
      setError('Mindestens einen Scope auswählen.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await createMyApiKey({
        name: name.trim(),
        scopes,
        expires_in_days: expiry,
      })
      setCreatedKey(result)
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'Fehler beim Erstellen des Keys.')
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!createdKey?.plaintext_key) return
    try {
      await navigator.clipboard.writeText(createdKey.plaintext_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback
    }
  }

  const handleDone = () => {
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {createdKey ? 'API-Key erstellt' : 'Neuer API-Key'}
            </h2>
            {!createdKey && (
              <p className="text-xs text-portal-warn mt-0.5">
                Dieser Key kann nie mehr als dein Nutzer-Account. Pool-/VM-/Node-/Playbook-Beschränkungen gelten weiter.
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.api_key_create" />
            <button onClick={onClose} className="btn-ghost" aria-label="Schließen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {/* ── Nach Erstellung: Einmalige Anzeige ── */}
          {createdKey ? (
            <div className="space-y-4">
              <div className="p-3 bg-portal-warn/10 border border-portal-warn/30 rounded text-xs text-portal-warn">
                <strong>Achtung:</strong> Kopiere den Key jetzt – er wird nur einmal angezeigt und kann danach nicht wiederhergestellt werden.
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                  Dein API-Key
                </label>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={createdKey.plaintext_key}
                    className="flex-1 font-mono text-xs bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 px-3 py-2 text-gray-900 dark:text-zinc-100 focus:outline-none"
                    onFocus={e => e.target.select()}
                    aria-label="API-Key"
                  />
                  <button type="button" onClick={handleCopy}
                    className={`shrink-0 px-3 py-2 text-xs border transition-colors ${
                      copied
                        ? 'border-portal-success text-portal-success bg-portal-success/10'
                        : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-300 hover:border-[var(--accent)] dark:hover:border-[var(--accent)]'
                    }`}>
                    {copied ? 'Kopiert!' : 'Kopieren'}
                  </button>
                </div>
              </div>

              <div className="text-xs text-gray-500 dark:text-zinc-500 space-y-1">
                <p><span className="font-medium">Name:</span> {createdKey.name}</p>
                <p><span className="font-medium">Scopes:</span> {createdKey.scopes.join(', ')}</p>
                <p><span className="font-medium">Läuft ab:</span> {createdKey.expires_at ? new Date(createdKey.expires_at).toLocaleDateString('de-DE') : 'Nie'}</p>
              </div>

              {/* curl-Beispiele mit echtem Key */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Verwendung (Bearer-Header):</p>
                {allScopes.filter(s => createdKey.scopes.includes(s.name)).map(entry => (
                  <div key={entry.name}>
                    <button type="button" onClick={() => toggleCurl(entry.name)}
                      className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300">
                      <ChevronIcon open={!!expandedCurls[entry.name]} />
                      <span className="font-mono">{entry.name}</span> – curl-Beispiel
                    </button>
                    {expandedCurls[entry.name] && (
                      <pre className="mt-1 p-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded text-xs font-mono text-gray-700 dark:text-zinc-300 overflow-x-auto whitespace-pre-wrap break-all">
                        {entry.curl_example
                          .replace('<KEY>', createdKey.plaintext_key)
                          .replace('<HOST>', window.location.origin)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>

              <button type="button" onClick={handleDone} className="btn-primary w-full">
                Fertig
              </button>
            </div>
          ) : (
            /* ── Erstellungs-Formular ── */
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                  Name / Label <span className="text-portal-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="z.B. GitLab CI, Homelab-Skript"
                  className={inputCls}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
                  Berechtigungen (Scopes) <span className="text-portal-danger">*</span>
                </label>
                {allScopes.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-zinc-500 py-4 text-center">Lade Scopes…</p>
                ) : (
                  <div className="space-y-2">
                    {allScopes.map(entry => (
                      <ScopeRow
                        key={entry.name}
                        entry={entry}
                        isAllowed={isAllowed(entry.name)}
                        isPlus={entry.plus_only}
                        selected={scopes.includes(entry.name)}
                        onToggle={toggleScope}
                        expandedCurl={!!expandedCurls[entry.name]}
                        onToggleCurl={toggleCurl}
                        createdKey={null}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
                  Ablaufzeit
                </label>
                <select
                  value={expiry === null ? 'null' : String(expiry)}
                  onChange={e => setExpiry(e.target.value === 'null' ? null : Number(e.target.value))}
                  className={inputCls}
                >
                  {EXPIRY_OPTIONS.map(opt => (
                    <option key={String(opt.value)} value={opt.value === null ? 'null' : String(opt.value)}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {error && (
                <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
                  {error}
                </p>
              )}

              <div className="flex gap-3 pt-1">
                <button type="submit" disabled={loading || allScopes.length === 0 || scopes.length === 0} className="btn-primary flex-1">
                  {loading ? 'Erstelle…' : 'Key erstellen'}
                </button>
                <button type="button" onClick={onClose} className="btn-secondary">
                  Abbrechen
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
