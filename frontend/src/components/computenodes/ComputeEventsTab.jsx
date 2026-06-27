// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { getNodeTasks } from '../../api/cluster'

const TYPE_LABELS = {
  // VM power
  qmstart:      'VM starten',
  qmstop:       'VM stoppen',
  qmreboot:     'VM neu starten',
  qmshutdown:   'VM herunterfahren',
  qmsuspend:    'VM suspendieren',
  qmresume:     'VM fortsetzen',
  qmpause:      'VM pausieren',
  // VM lifecycle
  qmcreate:     'VM erstellen',
  qmdestroy:    'VM löschen',
  qmmigrate:    'VM migrieren',
  qmclone:      'VM klonen',
  qmmove:       'Disk verschieben',
  qmconvert:    'VM konvertieren',
  // Snapshots
  qmsnapshot:   'Snapshot erstellen',
  qmdelsnapshot:'Snapshot löschen',
  qmrollback:   'Snapshot wiederherstellen',
  // Backup / restore
  vzdump:       'Backup',
  qmrestore:    'VM wiederherstellen',
  vzrestore:    'CT wiederherstellen',
  // CT power
  vzstart:      'CT starten',
  vzstop:       'CT stoppen',
  vzshutdown:   'CT herunterfahren',
  vzreboot:     'CT neu starten',
  vzpause:      'CT pausieren',
  vzresume:     'CT fortsetzen',
  vzsuspend:    'CT suspendieren',
  // CT lifecycle
  vzcreate:     'CT erstellen',
  vzdestroy:    'CT löschen',
  vzmigrate:    'CT migrieren',
  vzclone:      'CT klonen',
  vzevent:      'CT-Ereignis',
  // Node / storage
  'download-url': 'ISO herunterladen',
  imgcopy:      'Daten kopieren',
  aptupdate:    'Updates prüfen',
  'apt-update': 'Updates prüfen',
  srvreload:    'Dienst neu laden',
  vncproxy:     'VNC-Verbindung',
  spiceproxy:   'SPICE-Verbindung',
}

function typeLabel(type) {
  return TYPE_LABELS[type] ?? type
}

const STATUS_STYLE = {
  OK:      { dot: 'bg-portal-success',  text: 'text-portal-success',   label: 'OK' },
  ok:      { dot: 'bg-portal-success',  text: 'text-portal-success',   label: 'OK' },
  RUNNING: { dot: 'bg-portal-accent', text: 'text-portal-accent', label: 'Läuft' },
  running: { dot: 'bg-portal-accent', text: 'text-portal-accent', label: 'Läuft' },
  ERROR:   { dot: 'bg-portal-danger',    text: 'text-portal-danger',       label: 'Fehler' },
  error:   { dot: 'bg-portal-danger',    text: 'text-portal-danger',       label: 'Fehler' },
}

function statusStyle(status) {
  const key = status?.startsWith('WARNINGS') ? 'OK' : status
  return STATUS_STYLE[key] ?? { dot: 'bg-gray-400', text: 'text-gray-500 dark:text-zinc-400', label: status }
}

function formatTs(ts) {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(seconds) {
  if (seconds == null) return '–'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s}s`
}

export default function ComputeEventsTab({ nodeName, active }) {
  const [tasks, setTasks]     = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState(null)
  const loadedFor = useRef(null)

  useEffect(() => {
    if (!active || !nodeName) return
    if (loadedFor.current === nodeName) return
    loadedFor.current = nodeName
    setLoading(true)
    setError(null)
    getNodeTasks(nodeName, { limit: 50 })
      .then(data => setTasks(data))
      .catch(err => setError(err?.response?.status === 403 ? '403' : 'Ereignisse konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [active, nodeName])

  useEffect(() => {
    loadedFor.current = null
    setTasks([])
    setError(null)
  }, [nodeName])

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (error === '403') {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">Kein Zugriff</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          Du hast keine Berechtigung, die Ereignisse dieser Node zu sehen.
        </p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
        {error}
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">
        Keine Ereignisse gefunden
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700">
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Beschreibung</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Ressource</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Benutzer</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Status</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Startzeit</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Dauer</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900">
          {tasks.map(t => {
            const st = statusStyle(t.status)
            return (
              <tr key={t.upid} className="border-b border-gray-100 dark:border-zinc-800 last:border-0 hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                <td className="px-4 py-2.5">
                  <span className="text-xs text-gray-800 dark:text-zinc-200">{typeLabel(t.type)}</span>
                  <span className="ml-1.5 text-[10px] font-mono text-gray-400 dark:text-zinc-500">{t.type}</span>
                </td>
                <td className="px-4 py-2.5 text-xs font-mono text-gray-500 dark:text-zinc-400">
                  {t.id ? t.id : <span className="text-gray-300 dark:text-zinc-600">–</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400">{t.user || '–'}</td>
                <td className="px-4 py-2.5">
                  <span className={`flex items-center gap-1.5 text-xs ${st.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.dot}`} />
                    {st.label}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 whitespace-nowrap">{formatTs(t.starttime)}</td>
                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400">{formatDuration(t.duration)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
