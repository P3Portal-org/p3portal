// p3portal.org
// PROJ-48: Banner im Deploy-Formular wenn Owner-Limit erreicht (AC-EDIT-3).
import { useTranslation } from 'react-i18next'

export default function OwnershipLimitBanner({ current, max }) {
  const { t } = useTranslation()
  if (!max || current < max) return null
  return (
    <div className="rounded border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
      <span className="font-medium">{t('owners.limit_banner_title', { current, max })}</span>
      {' '}
      {t('owners.limit_banner_hint')}
    </div>
  )
}
