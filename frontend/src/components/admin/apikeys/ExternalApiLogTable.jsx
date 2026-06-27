// p3portal.org
import { useState } from 'react'
import { fetchExternalCalls } from '../../../api/userApiKeys'
import { useQuery } from '@tanstack/react-query'

const ALL_SCOPES = [
  'cluster:read',
  'jobs:read', 'jobs:write',
  'playbooks:read', 'playbooks:write',
  'packer:read', 'packer:write',
  'groups:read', 'groups:write',
  'pools:read', 'pools:write', 'pools:deploy',
  'owners:read',
  'approvals:read', 'approvals:approve',
]

const AUTH_KINDS = ['upk', 'm2m']

const STATUS_CLS = (code) => {
  if (!code) return 'text-portal-text/50'
  if (code >= 200 && code < 300) return 'text-portal-success'
  if (code >= 400 && code < 500) return 'text-portal-warn'
  return 'text-portal-danger'
}

function fmt(iso) {
  if (!iso) return '–'
  try { return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'medium' }) }
  catch { return iso }
}

const thCls = 'px-3 py-2 text-left text-xs font-medium text-portal-text/60 uppercase tracking-wider'
const tdCls = 'px-3 py-2 text-sm'

export default function ExternalApiLogTable() {
  const [filterKey, setFilterKey]       = useState('')
  const [filterScope, setFilterScope]   = useState('')
  const [filterAuth, setFilterAuth]     = useState('')

  const { data: logs = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['external-calls', filterKey, filterScope, filterAuth],
    queryFn: () => fetchExternalCalls({
      keyName: filterKey || undefined,
      scope: filterScope || undefined,
      authKind: filterAuth || undefined,
    }),
    staleTime: 30_000,
  })

  const inputCls = 'px-3 py-1.5 text-sm border border-portal-border bg-portal-bg text-portal-text focus:outline-none focus:ring-2 focus:ring-[var(--accent)] rounded-md'

  return (
    <div className="flex flex-col gap-4">
      {/* Filterleiste */}
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-portal-text/60 mb-1">Key-Name</label>
          <input
            type="text"
            value={filterKey}
            onChange={e => setFilterKey(e.target.value)}
            placeholder="Suche…"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs text-portal-text/60 mb-1">Scope</label>
          <select value={filterScope} onChange={e => setFilterScope(e.target.value)} className={inputCls}>
            <option value="">Alle</option>
            {ALL_SCOPES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-portal-text/60 mb-1">Auth-Art</label>
          <select value={filterAuth} onChange={e => setFilterAuth(e.target.value)} className={inputCls}>
            <option value="">Alle</option>
            {AUTH_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        <button onClick={() => refetch()} className="btn-secondary text-xs px-3 py-1.5">
          Aktualisieren
        </button>
      </div>

      {isError && (
        <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/20 px-3 py-2 rounded-md">
          Audit-Log konnte nicht geladen werden.
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-portal-text/50 py-6 text-center">Lade…</p>
      ) : logs.length === 0 ? (
        <p className="text-sm text-portal-text/50 py-8 text-center">Noch keine Audit-Log-Einträge vorhanden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-portal-border">
              <tr>
                <th className={thCls}>Key-Name</th>
                <th className={thCls}>Auth</th>
                <th className={thCls}>Scope</th>
                <th className={thCls}>Methode</th>
                <th className={thCls}>Endpunkt</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Job-ID</th>
                <th className={thCls}>Node</th>
                <th className={thCls}>Zeitpunkt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-portal-border/50">
              {logs.map(entry => (
                <tr key={entry.id} className="hover:bg-portal-bg/50">
                  <td className={`${tdCls} font-medium text-portal-text`}>
                    {entry.api_key_name ?? '–'}
                  </td>
                  <td className={tdCls}>
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      entry.auth_kind === 'upk'
                        ? 'bg-portal-info/10 text-portal-info'
                        : 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-400'
                    }`}>
                      {entry.auth_kind ?? '–'}
                    </span>
                  </td>
                  <td className={tdCls}>
                    <span className="font-mono text-xs bg-portal-bg border border-portal-border px-1.5 py-0.5 rounded">
                      {entry.scope_used ?? '–'}
                    </span>
                  </td>
                  <td className={`${tdCls} font-mono text-xs`}>{entry.method}</td>
                  <td className={`${tdCls} font-mono text-xs max-w-xs truncate`} title={entry.endpoint}>
                    {entry.endpoint}
                  </td>
                  <td className={`${tdCls} font-mono text-xs font-semibold ${STATUS_CLS(entry.status_code)}`}>
                    {entry.status_code ?? '–'}
                  </td>
                  <td className={`${tdCls} font-mono text-xs text-portal-text/50`}>
                    {entry.job_id ? entry.job_id.slice(0, 8) + '…' : '–'}
                  </td>
                  <td className={`${tdCls} text-xs`}>{entry.node ?? '–'}</td>
                  <td className={`${tdCls} whitespace-nowrap text-xs text-portal-text/60`}>
                    {fmt(entry.called_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
