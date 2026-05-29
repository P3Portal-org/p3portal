// p3portal.org
// PROJ-73: Refresh-Button mit Spinner und Disabled-State
import { useTranslation } from 'react-i18next'

export default function RefreshButton({ onClick, loading, disabled }) {
  const { t } = useTranslation()
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="btn-secondary flex items-center gap-1.5 text-xs"
      title={loading ? t('nodeUpdates.refreshing') : t('nodeUpdates.refresh_button')}
    >
      {loading ? (
        <svg className="w-3.5 h-3.5 animate-spin shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
          <circle cx="12" cy="12" r="10" strokeOpacity={0.25}/>
          <path d="M12 2a10 10 0 0 1 10 10" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/>
        </svg>
      )}
      {loading ? t('nodeUpdates.refreshing') : t('nodeUpdates.refresh_button')}
    </button>
  )
}
