// p3portal.org
// PROJ-65: Dashboard-Widget – zeigt bis zu 3 Notifications einer Quelle
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNotificationWidget } from '../hooks'
import { SEVERITY_DOT } from '../severity'

function RelativeTime({ iso }) {
  if (!iso) return null
  try {
    const diff = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(diff / 60_000)
    if (mins < 1) return <span>gerade eben</span>
    if (mins < 60) return <span>vor {mins} Min.</span>
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return <span>vor {hrs} Std.</span>
    return <span>vor {Math.floor(hrs / 24)} T.</span>
  } catch {
    return null
  }
}

function SeverityDot({ severity }) {
  const cls = SEVERITY_DOT[severity] ?? SEVERITY_DOT.info
  return (
    <span className={`w-1.5 h-1.5 rounded-full bg-current shrink-0 mt-1.5 ${cls}`} aria-hidden="true" />
  )
}

const SOURCE_LABELS = {
  alert: 'notifications.widget_title_alerts',
  announcement: 'notifications.widget_title_announcements',
  event: 'notifications.widget_title_events',
}
const SOURCE_TABS = {
  alert: 'alerts',
  announcement: 'announcements',
  event: 'events',
}
const EMPTY_KEYS = {
  alert: 'notifications.widget_empty_alerts',
  announcement: 'notifications.widget_empty_announcements',
  event: 'notifications.widget_empty_events',
}

export default function NotificationWidget({ source }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: items = [], isLoading } = useNotificationWidget(source)

  const unreadCount = items.filter(i => !i.read).length
  const tab = SOURCE_TABS[source]

  const handleNavClick = () => navigate(`/announcements?tab=${tab}`)
  const handleItemClick = (item) => {
    navigate(`/announcements?tab=${tab}&item=${encodeURIComponent(item.source_id)}`)
  }

  return (
    <div className="relative group bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 hover:border-portal-accent dark:hover:border-portal-accent rounded-lg flex flex-col min-h-[140px] transition-colors">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-zinc-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider flex-1">
          {t(SOURCE_LABELS[source])}
        </span>
        {unreadCount > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-portal-danger text-portal-bg leading-none">
            {unreadCount}
          </span>
        )}
      </div>
      <div className="absolute top-2.5 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleNavClick}
          className="text-xs text-portal-accent bg-white dark:bg-zinc-900 px-2 py-0.5 border border-portal-accent/30 hover:bg-portal-accent/10 dark:hover:bg-zinc-800 transition-colors"
        >
          {t('notifications.widget_more')}
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 py-1">
        {isLoading && (
          <div className="space-y-2 px-4 py-2">
            {[1, 2].map(i => (
              <div key={i} className="h-4 bg-gray-100 dark:bg-zinc-800 rounded animate-pulse" />
            ))}
          </div>
        )}

        {!isLoading && items.length === 0 && (
          <p className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-500 italic">
            {t(EMPTY_KEYS[source])}
          </p>
        )}

        {!isLoading && items.slice(0, 3).map(item => (
          <button
            key={item.source_id}
            onClick={() => handleItemClick(item)}
            className={`w-full flex items-start gap-2 px-4 py-1.5 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors text-left ${
              !item.read ? 'opacity-100' : 'opacity-50'
            }`}
          >
            <SeverityDot severity={item.severity} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-800 dark:text-zinc-200 truncate leading-snug">
                {item.title}
              </p>
              {item.summary && (
                <p className="text-[11px] text-gray-500 dark:text-zinc-400 truncate leading-snug">
                  {item.summary}
                </p>
              )}
            </div>
            <span className="text-[10px] text-gray-400 dark:text-zinc-500 shrink-0 mt-0.5">
              <RelativeTime iso={item.created_at} />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
