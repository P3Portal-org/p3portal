// p3portal.org
// PROJ-73: Stale-Daten-Warning-Banner
import { useTranslation } from 'react-i18next'
import { formatRelative } from '../utils'

export default function StaleWarning({ lastSuccessAt }) {
  const { t } = useTranslation()
  const rel = lastSuccessAt ? formatRelative(lastSuccessAt) : null
  return (
    <div className="flex items-start gap-2 rounded-lg border border-[var(--portal-warn)] bg-[var(--portal-warn-bg,#fffbeb)] dark:bg-yellow-950/30 px-4 py-3">
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 mt-0.5 shrink-0 text-[var(--portal-warn)]" aria-hidden="true">
        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd"/>
      </svg>
      <p className="text-xs text-yellow-800 dark:text-yellow-300">
        {rel
          ? t('nodeUpdates.stale_warning_with_time', { time: rel })
          : t('nodeUpdates.stale_warning')}
      </p>
    </div>
  )
}
