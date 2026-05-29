// p3portal.org
// PROJ-73: Kleiner Update-Badge für NodeCard im Dashboard
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useNodeUpdatesBadgeData } from '../hooks'

function badgeStyle(packageCount, securityCount, hasError, lastSuccessAt) {
  if (hasError)         return 'text-[var(--portal-danger,#dc2626)]  bg-red-50    dark:bg-red-950/30   border-red-200   dark:border-red-800'
  if (!lastSuccessAt)   return 'text-gray-400 dark:text-zinc-500       bg-gray-50   dark:bg-zinc-800/40  border-gray-200  dark:border-zinc-700'
  if (packageCount === 0) return 'text-[var(--portal-success,#16a34a)] bg-green-50  dark:bg-green-950/30 border-green-200 dark:border-green-800'
  if (securityCount > 0)  return 'text-[var(--portal-warn,#ca8a04)]   bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800'
  return 'text-[var(--portal-info,#2563eb)] bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800'
}

export default function UpdatesBadge({ portalNodeId, nodeName }) {
  const { t }  = useTranslation()
  const nav    = useNavigate()
  const badges = useNodeUpdatesBadgeData()
  const data   = badges[portalNodeId]

  if (!data) return null

  const { packageCount, securityCount, lastSuccessAt, hasError, isStale } = data

  let label
  if (!lastSuccessAt && !hasError) {
    label = t('nodeUpdates.badge_no_check')
  } else if (packageCount === 0 && !hasError) {
    label = t('nodeUpdates.badge_up_to_date')
  } else if (hasError) {
    label = t('nodeUpdates.badge_error')
  } else if (securityCount > 0) {
    label = t('nodeUpdates.badge_with_security', { count: packageCount, security: securityCount })
  } else {
    label = t('nodeUpdates.badge_updates', { count: packageCount })
  }

  const style = badgeStyle(packageCount, securityCount, hasError, lastSuccessAt)
  const staleTitle = isStale
    ? `${t('nodeUpdates.badge_stale_hint')} – ${t('nodeUpdates.badge_click_hint')}`
    : t('nodeUpdates.badge_click_hint')

  return (
    <button
      onClick={e => {
        e.stopPropagation()
        nav(`/compute?node=${encodeURIComponent(nodeName)}&tab=updates`)
      }}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-opacity hover:opacity-80 ${style}`}
      title={staleTitle}
    >
      {isStale ? (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 shrink-0 opacity-70" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5"/>
          <path d="M8 4.5v4l2 1.5"/>
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="w-2.5 h-2.5 shrink-0" aria-hidden="true">
          <path d="M8 1v4m0 0 2-2M8 5 6 3M1 8h4m0 0L3 6m2 2-2 2m11-2h-4m0 0 2-2m-2 2 2 2M8 11v4m0 0 2-2m-2 2-2-2"/>
        </svg>
      )}
      {label}
      {isStale && <span className="opacity-60">⚠</span>}
    </button>
  )
}
