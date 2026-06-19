// p3portal.org
// PROJ-84: „Als verwaltet markieren" an einem eigenen/adoptierten [unmanaged]-Host
// (User-Scope, Core). Setzt ssh_managed=true ohne Ownership zu ändern. Voraussetzung:
// der Onboarding-Block wurde zuvor im Gast ausgeführt (Hinweis im Confirm).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../../../components/common/ConfirmModal'
import { useMarkManaged } from '../hooks'

export default function MarkManagedButton({ host }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  const mark = useMarkManaged()

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="btn-table text-xs"
        title={t('ansible_inventory.mark_managed')}
      >
        {t('ansible_inventory.mark_managed')}
      </button>
      {confirm && (
        <ConfirmModal
          title={t('ansible_inventory.mark_confirm_title')}
          body={t('ansible_inventory.mark_confirm_body')}
          confirmLabel={t('ansible_inventory.mark_managed')}
          cancelLabel={t('common.cancel')}
          variant="primary"
          onConfirm={() => mark.mutateAsync({
            portalNodeId: host.portal_node_id,
            kind: host.kind,
            vmid: host.vmid,
          })}
          onClose={() => setConfirm(false)}
        />
      )}
    </>
  )
}
