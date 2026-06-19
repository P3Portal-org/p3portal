// p3portal.org
// PROJ-83: „Host-Key zurücksetzen" pro managed Host (TOFU-Korrektur).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ConfirmModal from '../../../components/common/ConfirmModal'
import { useResetHostKey } from '../hooks'

export default function HostKeyResetButton({ host }) {
  const { t } = useTranslation()
  const [confirm, setConfirm] = useState(false)
  const reset = useResetHostKey()

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        className="btn-table text-xs"
        title={t('ansible_inventory.reset_host_key')}
      >
        {t('ansible_inventory.reset_host_key')}
      </button>
      {confirm && (
        <ConfirmModal
          title={t('ansible_inventory.reset_confirm_title')}
          body={t('ansible_inventory.reset_confirm_body')}
          confirmLabel={t('ansible_inventory.reset_host_key')}
          cancelLabel={t('common.cancel')}
          variant="danger"
          onConfirm={() => reset.mutateAsync({
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
