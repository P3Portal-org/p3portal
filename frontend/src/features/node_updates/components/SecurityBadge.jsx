// p3portal.org
// PROJ-73: Security-Badge-Pill für sicherheitsrelevante Pakete
import { useTranslation } from 'react-i18next'

export default function SecurityBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold bg-[var(--portal-danger-bg,#fef2f2)] text-[var(--portal-danger,#dc2626)] dark:bg-red-950/40 dark:text-red-400">
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-2.5 h-2.5 shrink-0" aria-hidden="true">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 3.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4.5zm0 6.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>
      </svg>
      {t('nodeUpdates.security_label')}
    </span>
  )
}
