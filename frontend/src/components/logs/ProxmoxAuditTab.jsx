// p3portal.org
import { useMemo, useState } from 'react'

const STATUS_OPTIONS = [
  { value: 'all', label: 'Alle Status' },
  { value: 'error', label: 'Nur Fehler (4xx/5xx)' },
  { value: 'success', label: 'Nur Erfolg (2xx/3xx)' },
]

const METHOD_OPTIONS = [
  { value: 'all', label: 'Alle Methoden' },
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'DELETE', label: 'DELETE' },
]

function isError(status) {
  if (!status || status === 'ERR') return true
  const code = parseInt(status, 10)
  return code >= 400
}

function StatusBadge({ status }) {
  if (!status || status === 'ERR') {
    return <span className="font-mono font-bold text-portal-danger">ERR</span>
  }
  const code = parseInt(status, 10)
  const isErr = code >= 400
  const is2xx = code >= 200 && code < 300
  const cls = isErr
    ? 'text-portal-danger font-bold'
    : is2xx
      ? 'text-portal-success'
      : 'text-gray-600 dark:text-zinc-400'
  return <span className={`font-mono ${cls}`}>{status}</span>
}

function MethodBadge({ method }) {
  const colors = {
    GET:    'text-portal-info',
    POST:   'text-portal-success',
    PUT:    'text-portal-accent',
    DELETE: 'text-portal-danger',
  }
  return (
    <span className={`font-mono font-semibold text-xs ${colors[method] ?? 'text-gray-600 dark:text-zinc-400'}`}>
      {method ?? '—'}
    </span>
  )
}

export default function ProxmoxAuditTab({ entries, loading, error, refresh }) {
  const [statusFilter, setStatusFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    let list = entries
    if (statusFilter === 'error') list = list.filter(e => isError(e.status))
    else if (statusFilter === 'success') list = list.filter(e => !isError(e.status))
    if (methodFilter !== 'all') list = list.filter(e => e.method === methodFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(e =>
        e.endpoint?.toLowerCase().includes(q) ||
        e.token?.toLowerCase().includes(q) ||
        e.user?.toLowerCase().includes(q)
      )
    }
    return list
  }, [entries, statusFilter, methodFilter, search])

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-zinc-700 shrink-0 bg-gray-50 dark:bg-zinc-950 flex-wrap">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        >
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={methodFilter}
          onChange={e => setMethodFilter(e.target.value)}
          className="text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        >
          {METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Endpoint, Token, User…"
          className="flex-1 min-w-[140px] text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        />
        <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">
          {filtered.length} Einträge
        </span>
        <button
          onClick={refresh}
          disabled={loading}
          className="text-xs text-portal-accent hover:underline disabled:opacity-40 transition shrink-0"
          title="Aktualisieren"
        >
          {loading ? 'Lädt…' : '↻ Aktualisieren'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
        {error && (
          <div className="m-3 border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger">
            Fehler beim Laden des Proxmox Audit-Logs
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300 dark:text-zinc-600 mb-2">
              <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Einträge gefunden</p>
            <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
              Stelle sicher, dass <code className="font-mono bg-gray-100 dark:bg-zinc-800 px-1">PROXMOX_AUDIT_ENABLED=1</code> gesetzt ist.
            </p>
          </div>
        )}
        {filtered.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400 whitespace-nowrap w-40">Zeitstempel</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400">Token</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-28">User</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-16">Methode</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400">Endpoint</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-16">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((entry, i) => {
                const rowError = isError(entry.status)
                return (
                  <tr
                    key={i}
                    className={`border-b border-gray-100 dark:border-zinc-800 ${
                      rowError
                        ? 'bg-portal-danger/10 hover:bg-portal-danger/10'
                        : 'hover:bg-gray-50 dark:hover:bg-zinc-800/40'
                    }`}
                  >
                    <td className="px-4 py-2 font-mono text-gray-500 dark:text-zinc-500 whitespace-nowrap">
                      {entry.timestamp ? (() => { const d = new Date(entry.timestamp); return `${d.toLocaleDateString('de-DE')} ${d.toLocaleTimeString('de-DE')}` })() : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-700 dark:text-zinc-300 max-w-[180px] truncate" title={entry.token}>
                      {entry.token ?? '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-600 dark:text-zinc-400 truncate">
                      {entry.user || <span className="text-gray-300 dark:text-zinc-600">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <MethodBadge method={entry.method} />
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-600 dark:text-zinc-400 max-w-xs truncate" title={entry.endpoint}>
                      {entry.endpoint ?? '—'}
                      {entry.body && (
                        <span className="ml-1 text-gray-400 dark:text-zinc-600" title={`body=${entry.body}`}>[body]</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={entry.status} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
