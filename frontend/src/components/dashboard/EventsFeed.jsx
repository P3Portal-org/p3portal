// p3portal.org
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { getJobs } from '../../api/jobs'

const STATUS_DOT = {
  running: 'bg-portal-accent animate-pulse',
  success: 'bg-portal-success',
  failed:  'bg-portal-danger',
  pending: 'bg-gray-400 dark:bg-zinc-500',
}

const STATUS_LABEL = {
  running: 'läuft',
  success: 'OK',
  failed:  'Fehler',
  pending: 'ausstehend',
}

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return `vor ${diff}s`
  if (diff < 3600) return `vor ${Math.floor(diff / 60)}m`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)}h`
  return `vor ${Math.floor(diff / 86400)}d`
}

export default function EventsFeed() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      getJobs()
        .then(list => {
          if (!cancelled) {
            const sorted = [...list].sort((a, b) =>
              new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
            )
            setJobs(sorted.slice(0, 8))
            setLoading(false)
          }
        })
        .catch(() => { if (!cancelled) setLoading(false) })
    }
    load()
    const id = setInterval(load, 15_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
          Letzte Ereignisse
        </span>
        <Link
          to="/events"
          className="text-xs text-portal-accent hover:text-portal-accent transition-colors"
        >
          Alle →
        </Link>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500 py-4 text-center">Noch keine Ereignisse.</p>
      ) : (
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg divide-y divide-gray-100 dark:divide-zinc-800">
          {jobs.map(job => (
            <Link
              key={job.id}
              to={`/events/${job.id}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-zinc-800/60 transition-colors"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[job.status] ?? STATUS_DOT.pending}`} />
              <span className="flex-1 min-w-0">
                <span className="text-sm text-gray-900 dark:text-zinc-100 truncate block">{job.playbook}</span>
                <span className="text-xs text-gray-400 dark:text-zinc-500 font-mono">{job.username}</span>
              </span>
              <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">{timeAgo(job.created_at)}</span>
              <span className={`text-xs shrink-0 ${job.status === 'failed' ? 'text-portal-danger' : job.status === 'running' ? 'text-portal-accent' : 'text-gray-400 dark:text-zinc-500'}`}>
                {STATUS_LABEL[job.status] ?? job.status}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
