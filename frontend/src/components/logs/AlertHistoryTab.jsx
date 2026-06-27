// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { listAlertEvents, acknowledgeAlert } from '../../api/alerts'

const SEVERITY_DOT = { critical: 'bg-portal-danger', warning: 'bg-portal-warn' }
const SEVERITY_TEXT = { critical: 'text-portal-danger', warning: 'text-portal-warn' }
const STATE_DOT = { firing: 'bg-portal-danger', resolved: 'bg-portal-success' }
const STATE_TEXT = { firing: 'text-portal-danger', resolved: 'text-portal-success' }
const STATE_LABEL = { firing: 'Auslösung', resolved: 'Erholt' }

const METRIC_LABEL = {
  cpu_percent: 'CPU',
  mem_percent: 'RAM',
  disk_percent: 'Disk',
  status: 'Status',
}

export default function AlertHistoryTab() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filterState, setFilterState] = useState('')
  const [filterVmid, setFilterVmid] = useState('')
  const [acking, setAcking] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = { limit: 200 }
      if (filterState) params.state = filterState
      if (filterVmid.trim()) params.vmid = filterVmid.trim()
      const data = await listAlertEvents(params)
      setEvents(data)
    } catch {
      setError('Alert-Ereignisse konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [filterState, filterVmid])

  useEffect(() => { load() }, [load])

  const handleAck = async (event) => {
    setAcking(event.id)
    try {
      await acknowledgeAlert(event.id)
      await load()
    } catch {
      // ignore
    } finally {
      setAcking(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-zinc-700 shrink-0 bg-gray-50 dark:bg-zinc-950">
        <select
          value={filterState}
          onChange={e => setFilterState(e.target.value)}
          className="text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        >
          <option value="">Alle Status</option>
          <option value="firing">Auslösung</option>
          <option value="resolved">Erholt</option>
        </select>
        <input
          type="text"
          value={filterVmid}
          onChange={e => setFilterVmid(e.target.value)}
          placeholder="VM-ID filtern…"
          className="flex-1 text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        />
        <button
          onClick={load}
          disabled={loading}
          className="text-xs text-portal-accent hover:underline disabled:opacity-40 transition shrink-0"
        >
          {loading ? 'Lade…' : '↻'}
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900">
        {error && (
          <div className="m-3 border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger rounded">
            {error}
          </div>
        )}

        {!loading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300 dark:text-zinc-600 mb-2">
              <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 10-12 0v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Alert-Ereignisse.</p>
          </div>
        )}

        {events.length > 0 && (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400 w-40">Zeit</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-24">Status</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-20">Severity</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-20">VM</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400">Regel</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-16">Metrik</th>
                <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-24">Wert</th>
                <th className="px-3 py-2 w-28" />
              </tr>
            </thead>
            <tbody>
              {events.map(ev => {
                const date = new Date(ev.timestamp)
                const isAcked = ev.acknowledged_by?.length > 0
                return (
                  <tr key={ev.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-2 font-mono text-gray-500 dark:text-zinc-500 whitespace-nowrap">
                      {date.toLocaleDateString('de-DE')} {date.toLocaleTimeString('de-DE')}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 font-medium ${STATE_TEXT[ev.state] ?? 'text-gray-600 dark:text-zinc-300'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATE_DOT[ev.state] ?? 'bg-gray-400'}`} />
                        {STATE_LABEL[ev.state] ?? ev.state}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 ${SEVERITY_TEXT[ev.severity] ?? ''}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_DOT[ev.severity] ?? 'bg-gray-400'}`} />
                        {ev.severity === 'critical' ? 'Kritisch' : 'Warnung'}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-800 dark:text-zinc-200">
                      {ev.vm_name ? (
                        <span title={ev.vmid}>{ev.vm_name}</span>
                      ) : ev.vmid}
                    </td>
                    <td className="px-3 py-2 text-gray-700 dark:text-zinc-300 truncate max-w-xs">
                      {ev.rule_name}
                    </td>
                    <td className="px-3 py-2 text-gray-500 dark:text-zinc-400">
                      {METRIC_LABEL[ev.metric] ?? ev.metric}
                    </td>
                    <td className="px-3 py-2 font-mono text-gray-500 dark:text-zinc-400">
                      {ev.value != null ? `${ev.value.toFixed(1)}%` : '—'}
                      {ev.threshold != null && <span className="text-gray-400 dark:text-zinc-600"> / {ev.threshold}%</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isAcked ? (
                        <span className="text-gray-400 dark:text-zinc-500" title={`Best. von: ${ev.acknowledged_by.join(', ')}`}>
                          ✓ Best.
                        </span>
                      ) : ev.state === 'firing' ? (
                        <button
                          onClick={() => handleAck(ev)}
                          disabled={acking === ev.id}
                          className="text-portal-accent hover:underline disabled:opacity-40 transition"
                        >
                          {acking === ev.id ? '…' : 'Best.'}
                        </button>
                      ) : null}
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
