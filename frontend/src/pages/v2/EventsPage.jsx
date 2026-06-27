// p3portal.org
import { useRef, useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useJobs, useJobLog } from '../../hooks/useJobs'
import { useAuth } from '../../hooks/useAuth'
import { useAuditLogs } from '../../hooks/useLogs'
import { useProxmoxAuditLog } from '../../hooks/useProxmoxAuditLog'
import { cancelJob } from '../../api/jobs'
import ProxmoxAuditTab from '../../components/logs/ProxmoxAuditTab'
import AlertHistoryTab from '../../components/logs/AlertHistoryTab'
import PinIcon from '../../components/common/PinIcon'
import { usePinToggle } from '../../features/sidebar_pins/hooks/usePinToggle'
import HelpButton from '../../features/help/components/HelpButton'

function TabPinButton({ tabId, label }) {
  const { isPinned, loading, toggle, atLimit } = usePinToggle({
    route: `/events?tab=${tabId}`,
    pinKind: 'other',
    defaultLabel: `Events – ${label}`,
  })
  return (
    <button
      onClick={e => { e.stopPropagation(); toggle() }}
      disabled={loading || (atLimit && !isPinned)}
      className="p-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      title={atLimit && !isPinned ? 'Pin-Limit erreicht' : isPinned ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
    >
      <PinIcon pinned={isPinned} disabled={atLimit && !isPinned} className="w-3.5 h-3.5" />
    </button>
  )
}

const STATUS_COLOR = {
  pending: 'text-gray-500 dark:text-zinc-400',
  running: 'text-portal-accent',
  success: 'text-portal-success',
  failed:  'text-portal-danger',
}

function JobRow({ job, active, onClick }) {
  const date = new Date(job.created_at)
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-100 dark:border-zinc-800 transition-colors ${
        active ? 'bg-portal-accent/10 border-l-2 border-l-orange-500' : 'hover:bg-gray-50 dark:hover:bg-zinc-800/60'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-900 dark:text-zinc-100 truncate">{job.playbook}</span>
        <span className={`text-xs font-medium shrink-0 ${STATUS_COLOR[job.status] ?? ''}`}>
          {job.status}
        </span>
      </div>
      <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
        {date.toLocaleDateString('de-DE')} {date.toLocaleTimeString('de-DE')}
        {' · '}<span className="font-mono">{job.username}</span>
      </p>
    </button>
  )
}

function LogPanel({ jobId }) {
  const { lines, status, connected, job } = useJobLog(jobId)
  const logRef = useRef(null)
  const [cancelling, setCancelling] = useState(false)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [lines])

  async function handleCancel() {
    if (!confirm('Job wirklich abbrechen?')) return
    setCancelling(true)
    try { await cancelJob(jobId) } catch { /* Status-Update kommt via WebSocket */ } finally { setCancelling(false) }
  }

  const STATUS_BADGE = {
    pending: 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400',
    running: 'bg-portal-accent/10 text-portal-accent',
    success: 'bg-portal-success/10 text-portal-success',
    failed:  'bg-portal-danger/10 text-portal-danger',
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-zinc-700 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <span className={`shrink-0 text-xs font-medium px-2.5 py-1 ${STATUS_BADGE[status] ?? STATUS_BADGE.pending}`}>
            {status === 'running' && (
              <svg className="inline animate-spin w-3 h-3 mr-1 -mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            )}
            {status}
          </span>
          {job && (
            <span className="text-xs text-gray-500 dark:text-zinc-400 truncate">
              <span className="font-mono text-portal-accent">{job.username}</span>
              <span className="mx-1">·</span>
              {job.playbook}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {status === 'running' && (
            <button onClick={handleCancel} disabled={cancelling}
              className="text-xs text-portal-danger hover:underline disabled:opacity-40 transition">
              {cancelling ? 'Abbricht…' : 'Abbrechen'}
            </button>
          )}
          <span className={`text-xs ${connected ? 'text-portal-success' : 'text-gray-400 dark:text-zinc-500'}`}>
            {connected ? '● live' : '○ getrennt'}
          </span>
        </div>
      </div>
      <div ref={logRef} className="flex-1 overflow-y-auto bg-zinc-950 p-4 font-mono text-xs text-zinc-300 leading-relaxed">
        {lines.length === 0
          ? <span className="text-zinc-600">Warte auf Ausgabe…</span>
          : lines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-all">{line}</div>)
        }
      </div>
    </div>
  )
}

const AUDIT_ALL_LIMIT = 10000  // Backend-Cap für „Alle anzeigen"

// PROJ: zieh-/breitenverstellbare Spalten (localStorage-persistent)
const AUDIT_COLS = [
  { key: 'time',   label: 'Zeit',     def: 160 },
  { key: 'event',  label: 'Ereignis', def: 220 },
  { key: 'user',   label: 'Nutzer',   def: 120 },
  { key: 'ip',     label: 'IP',       def: 140 },
  { key: 'detail', label: 'Detail',   def: 420 },
]
const AUDIT_COL_LS = 'p3.auditColWidths'
const AUDIT_COL_MIN = 60

function loadColWidths() {
  const defaults = Object.fromEntries(AUDIT_COLS.map(c => [c.key, c.def]))
  try {
    const stored = JSON.parse(localStorage.getItem(AUDIT_COL_LS) || '{}')
    return { ...defaults, ...stored }
  } catch {
    return defaults
  }
}

function AuditLogsTab() {
  const [filterEvent, setFilterEvent] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [debouncedUser, setDebouncedUser] = useState('')
  const [pageSize, setPageSize] = useState(100)   // 25 | 50 | 100 | 200 | 'all'
  const [colWidths, setColWidths] = useState(loadColWidths)

  useEffect(() => {
    localStorage.setItem(AUDIT_COL_LS, JSON.stringify(colWidths))
  }, [colWidths])

  const startResize = (key, e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidths[key]
    const onMove = (ev) => {
      const next = Math.max(AUDIT_COL_MIN, startW + (ev.clientX - startX))
      setColWidths(w => ({ ...w, [key]: next }))
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const tableWidth = AUDIT_COLS.reduce((sum, c) => sum + colWidths[c.key], 0)

  // Header- und Body-Tabelle horizontal synchron halten (Header scrollt nicht
  // selbst → vertikale Scrollbar beginnt erst unter der Kopfzeile)
  const headRef = useRef(null)
  const bodyRef = useRef(null)
  const syncHeadScroll = () => {
    if (headRef.current && bodyRef.current) {
      headRef.current.scrollLeft = bodyRef.current.scrollLeft
    }
  }

  useEffect(() => {
    const tt = setTimeout(() => setDebouncedUser(filterUser), 300)
    return () => clearTimeout(tt)
  }, [filterUser])
  const effLimit = pageSize === 'all' ? AUDIT_ALL_LIMIT : pageSize
  const { logs, total, loading, error, refresh, offset, setOffset, limit } = useAuditLogs({
    eventType: filterEvent, username: debouncedUser, limit: effLimit,
  })
  const hasPrev = offset > 0
  const hasNext = offset + limit < total
  const showPager = pageSize !== 'all' && total > limit

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 dark:border-zinc-700 shrink-0 bg-gray-50 dark:bg-zinc-950">
        <select value={filterEvent} onChange={e => { setFilterEvent(e.target.value); setOffset(0) }}
          className="text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent">
          <option value="">Alle Ereignisse</option>
          <option value="login_success">Login erfolgreich</option>
          <option value="login_failed">Login fehlgeschlagen</option>
          <option value="logout">Logout</option>
          <option value="job_started">Job gestartet</option>
          <option value="job_cancelled">Job abgebrochen</option>
          <option value="user_created">Nutzer erstellt</option>
          <option value="user_updated">Nutzer geändert</option>
          <option value="user_deleted">Nutzer gelöscht</option>
        </select>
        <input type="text" value={filterUser} onChange={e => { setFilterUser(e.target.value); setOffset(0) }}
          placeholder="Nutzername"
          className="flex-1 text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent" />
        <button onClick={refresh} disabled={loading}
          className="text-xs text-portal-accent hover:underline disabled:opacity-40 transition shrink-0">
          {loading ? '…' : '↻'}
        </button>
      </div>
      {error && <div className="m-3 border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger shrink-0">Fehler beim Laden</div>}
      {!loading && logs.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center py-16 text-center bg-white dark:bg-zinc-900">
          <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Einträge gefunden.</p>
        </div>
      )}
      {logs.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-zinc-900">
          {/* Kopfzeile – scrollt NICHT vertikal (Scrollbar beginnt darunter) */}
          <div ref={headRef} className="overflow-hidden shrink-0">
            <table className="text-xs" style={{ tableLayout: 'fixed', width: tableWidth }}>
              <colgroup>
                {AUDIT_COLS.map(c => <col key={c.key} style={{ width: colWidths[c.key] }} />)}
              </colgroup>
              <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
                <tr>
                  {AUDIT_COLS.map((c) => (
                    <th key={c.key} className="relative text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 select-none">
                      <span className="block truncate pr-1">{c.label}</span>
                      <span
                        onMouseDown={e => startResize(c.key, e)}
                        className="absolute top-0 -right-1 h-full w-3 cursor-col-resize hover:bg-portal-accent/10 z-10"
                        title="Spaltenbreite ziehen"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
            </table>
          </div>
          {/* Body – vertikaler + horizontaler Scroll, Kopfzeile folgt synchron */}
          <div ref={bodyRef} onScroll={syncHeadScroll} className="flex-1 overflow-auto" style={{ scrollbarGutter: 'stable' }}>
            <table className="text-xs" style={{ tableLayout: 'fixed', width: tableWidth }}>
              <colgroup>
                {AUDIT_COLS.map(c => <col key={c.key} style={{ width: colWidths[c.key] }} />)}
              </colgroup>
              <tbody>
                {logs.map(entry => {
                  const date = new Date(entry.created_at)
                  const ts = `${date.toLocaleDateString('de-DE')} ${date.toLocaleTimeString('de-DE')}`
                  return (
                    <tr key={entry.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                      <td className="px-3 py-2 font-mono text-gray-500 dark:text-zinc-500 truncate" title={ts}>{ts}</td>
                      <td className="px-3 py-2 text-gray-800 dark:text-zinc-200 truncate" title={entry.event_type}>{entry.event_type}</td>
                      <td className="px-3 py-2 font-mono text-gray-800 dark:text-zinc-200 truncate" title={entry.username ?? ''}>{entry.username ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-gray-500 dark:text-zinc-500 truncate" title={entry.ip_address ?? ''}>{entry.ip_address ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-zinc-500 truncate" title={entry.detail ?? ''}>{entry.detail ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {total > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-950 shrink-0">
          <span className="text-xs text-gray-500 dark:text-zinc-400">
            {pageSize === 'all'
              ? `${total} Einträge`
              : `${offset + 1}–${Math.min(offset + limit, total)} von ${total}`}
          </span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400">
              Einträge pro Seite:
              <select
                value={pageSize}
                onChange={e => { setPageSize(e.target.value === 'all' ? 'all' : Number(e.target.value)); setOffset(0) }}
                className="text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-portal-accent"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
                <option value="all">Alle</option>
              </select>
            </label>
            {showPager && (
              <div className="flex gap-2">
                <button onClick={() => setOffset(o => Math.max(0, o - limit))} disabled={!hasPrev}
                  className="text-xs text-portal-accent hover:underline disabled:opacity-40">← Zurück</button>
                <button onClick={() => setOffset(o => o + limit)} disabled={!hasNext}
                  className="text-xs text-portal-accent hover:underline disabled:opacity-40">Weiter →</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const TABS = [
  { id: 'jobs', label: 'Jobs' },
  { id: 'alerts', label: 'Alert-Historie' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'proxmox-audit', label: 'Proxmox Audit' },
]

export default function EventsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { jobs, loading, error, refresh } = useJobs()
  const { role, portalPermissions } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'jobs'
  const isAdmin = role === 'admin'
  const canViewLogs = isAdmin || (portalPermissions ?? []).includes('view_logs')
  const proxmoxAudit = useProxmoxAuditLog()
  const showProxmoxAudit = isAdmin && proxmoxAudit.tabVisible
  const [filterStatus, setFilterStatus] = useState('')
  const [filterName, setFilterName] = useState('')
  const [sortDesc, setSortDesc] = useState(true)

  const visibleJobs = useMemo(() => {
    let list = [...jobs]
    if (filterStatus) list = list.filter(j => j.status === filterStatus)
    if (filterName.trim()) {
      const q = filterName.trim().toLowerCase()
      list = list.filter(j => j.username?.toLowerCase().includes(q))
    }
    list.sort((a, b) => {
      const ta = new Date(a.created_at).getTime()
      const tb = new Date(b.created_at).getTime()
      return sortDesc ? tb - ta : ta - tb
    })
    return list
  }, [jobs, filterStatus, filterName, sortDesc])

  const visibleTabs = TABS.filter(t => {
    if (t.id === 'audit') return canViewLogs
    if (t.id === 'proxmox-audit') return showProxmoxAudit
    return true
  })

  const tabCls = (id) =>
    `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === id
        ? 'border-portal-accent/50 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Events</h1>
          <HelpButton helpKey="logs" />
        </div>
        {activeTab === 'jobs' && (
          <button onClick={refresh} disabled={loading}
            className="text-xs text-portal-accent hover:underline disabled:opacity-40 transition">
            {loading ? 'Lädt…' : '↻ Aktualisieren'}
          </button>
        )}
      </header>

      <div className="flex border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 shrink-0">
        {visibleTabs.map(tab => (
          <button key={tab.id} onClick={() => setSearchParams({ tab: tab.id })} className={tabCls(tab.id)}>
            {tab.label}
          </button>
        ))}
        <div className="ml-auto self-center pr-1">
          <TabPinButton tabId={activeTab} label={visibleTabs.find(t => t.id === activeTab)?.label ?? activeTab} />
        </div>
      </div>

      {activeTab === 'jobs' && (
        <div className="flex flex-1 min-h-0 m-4 rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700">
          <div className="w-80 shrink-0 border-r border-gray-200 dark:border-zinc-700 flex flex-col bg-gray-50 dark:bg-zinc-950">
            <div className="flex flex-col border-b border-gray-200 dark:border-zinc-700 shrink-0">
              <div className="flex items-center gap-2 px-3 py-2">
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="flex-1 text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent">
                  <option value="">Alle Status</option>
                  <option value="running">Läuft</option>
                  <option value="pending">Ausstehend</option>
                  <option value="success">Erfolgreich</option>
                  <option value="failed">Fehlgeschlagen</option>
                </select>
                <button onClick={() => setSortDesc(d => !d)}
                  className="shrink-0 flex items-center gap-1 text-xs text-gray-500 dark:text-zinc-400 border border-gray-200 dark:border-zinc-700 px-2 py-1.5 bg-white dark:bg-zinc-800 transition-colors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 transition-transform ${sortDesc ? '' : 'rotate-180'}`}>
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                  {sortDesc ? 'Neu' : 'Alt'}
                </button>
              </div>
              {isAdmin && (
                <div className="px-3 pb-2">
                  <input type="text" value={filterName} onChange={e => setFilterName(e.target.value)}
                    placeholder="Nutzer filtern"
                    className="w-full text-xs border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-700 dark:text-zinc-300 placeholder-gray-400 dark:placeholder-zinc-500 px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-portal-accent" />
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {error && <div className="m-3 border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger">Fehler beim Laden</div>}
              {!loading && visibleJobs.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center px-4">
                  <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Jobs gefunden.</p>
                </div>
              )}
              {visibleJobs.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  active={String(job.id) === String(id)}
                  onClick={() => navigate(`/events/${job.id}`)}
                />
              ))}
            </div>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            {id ? (
              <LogPanel jobId={id} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center bg-gray-50 dark:bg-zinc-950">
                <p className="text-sm text-gray-500 dark:text-zinc-400">Job auswählen</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'alerts' && (
        <div className="flex flex-1 min-h-0 m-4 rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700">
          <AlertHistoryTab />
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="flex flex-1 min-h-0 m-4 rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700">
          <AuditLogsTab />
        </div>
      )}

      {activeTab === 'proxmox-audit' && (
        <div className="flex flex-1 min-h-0 m-4 rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700">
          <ProxmoxAuditTab
            entries={proxmoxAudit.entries}
            loading={proxmoxAudit.loading}
            error={proxmoxAudit.error}
            refresh={proxmoxAudit.refresh}
          />
        </div>
      )}
    </div>
  )
}
