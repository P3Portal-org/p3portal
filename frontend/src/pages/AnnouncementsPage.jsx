// p3portal.org
import { useAnnouncements } from '../hooks/useAnnouncements'

const VARIANT = {
  info: {
    bg: 'border-portal-info/30 bg-portal-info/10',
    text: 'text-portal-info',
    label: 'Info',
    labelBg: 'bg-portal-info/10 text-portal-info',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
  warn: {
    bg: 'border-portal-warn/30 bg-portal-warn/10',
    text: 'text-portal-warn',
    label: 'Warnung',
    labelBg: 'bg-portal-warn/10 text-portal-warn',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 shrink-0">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  error: {
    bg: 'border-portal-danger/30 bg-portal-danger/10',
    text: 'text-portal-danger',
    label: 'Fehler',
    labelBg: 'bg-portal-danger/10 text-portal-danger',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5 shrink-0">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
  },
}

export default function AnnouncementsPage() {
  const { announcements, loading, error } = useAnnouncements()

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">Ankündigungen</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-500 mt-0.5">
            Aktuelle Meldungen vom Administrator
          </p>
        </div>

        {loading && (
          <div className="space-y-3">
            {[1, 2].map(i => (
              <div key={i} className="h-16 bg-gray-100 dark:bg-zinc-800 rounded-lg animate-pulse" />
            ))}
          </div>
        )}

        {error && (
          <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-4 py-3 rounded-lg">
            Ankündigungen konnten nicht geladen werden.
          </p>
        )}

        {!loading && !error && announcements.length === 0 && (
          <div className="text-center py-12 text-gray-400 dark:text-zinc-600">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 mx-auto mb-3 opacity-40">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <p className="text-sm">Keine Ankündigungen vorhanden</p>
          </div>
        )}

        {!loading && !error && announcements.map(a => {
          const variant = VARIANT[a.severity] ?? VARIANT.info
          return (
            <div
              key={a.id}
              className={`flex items-start gap-4 border rounded-lg px-5 py-4 ${variant.bg}`}
            >
              <span className={variant.text}>{variant.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${variant.labelBg}`}>
                    {variant.label}
                  </span>
                </div>
                <p className={`text-sm break-words ${variant.text}`}>{a.message}</p>
              </div>
            </div>
          )
        })}
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
