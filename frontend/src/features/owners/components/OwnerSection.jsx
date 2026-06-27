// p3portal.org
// PROJ-48: Owner-Sektion für VmDetailPage (AC-VIS-2, AC-CO-1..4, AC-TR-1..3, AC-ADOPT-2, AC-RES-3).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOwnersForResource, useInvalidateOwners } from '../hooks/useOwners'
import { useOwnerMutations } from '../hooks/useOwnerMutations'
import AddCoOwnerModal from './AddCoOwnerModal'
import TransferOwnerModal from './TransferOwnerModal'
import AdoptButton from './AdoptButton'
import DeleteRequestButton from './DeleteRequestButton'
import ConfirmModal from '../../../components/common/ConfirmModal'

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// currentUsername: eingeloggter User (aus useAuth().username)
export default function OwnerSection({ resourceType, nodeId, vmid, isAdmin, currentUsername }) {
  const { t } = useTranslation()
  const { data: owners, isLoading } = useOwnersForResource(resourceType, nodeId, vmid)
  const { addOwner, removeOwner, transferOwner, adopt, deleteRequest, busy, error, setError } =
    useOwnerMutations(resourceType, nodeId, vmid)
  const invalidate = useInvalidateOwners()

  const [showAddModal, setShowAddModal] = useState(false)
  const [transferFor, setTransferFor] = useState(null) // userId
  const [confirmRemove, setConfirmRemove] = useState(null) // { userId, isLast }

  const ownerList = owners?.owners ?? []
  const isOwner = ownerList.some(o => o.username === currentUsername)
  const canManage = isAdmin || isOwner
  const hasPendingDeleteRequest = false // PROJ-50-Stub

  const handleRemove = (userId) => {
    const isLast = ownerList.filter(o => !o.deleted_at).length === 1
    setConfirmRemove({ userId, isLast })
  }

  const doRemove = async (orphan = false) => {
    await removeOwner(confirmRemove.userId, orphan)
    setConfirmRemove(null)
    invalidate(resourceType, nodeId, vmid)
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('owners.section_title')}</h3>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <AdoptButton
              hasOwners={ownerList.length > 0}
              onAdopt={() => {
                adopt()
                invalidate(resourceType, nodeId, vmid)
              }}
            />
          )}
          {canManage && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="btn-primary"
            >
              {t('owners.add_co_owner_btn_short')}
            </button>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <p className="mb-2 text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">
          {error}
          <button type="button" onClick={() => setError('')} className="ml-2 text-xs underline">{t('common.dismiss')}</button>
        </p>
      )}

      {/* Loading */}
      {isLoading && (
        <p className="text-sm text-gray-400 dark:text-zinc-500 animate-pulse">{t('common.loading')}</p>
      )}

      {/* Empty state */}
      {!isLoading && ownerList.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('owners.section_empty')}</p>
      )}

      {/* Owner list */}
      {!isLoading && ownerList.length > 0 && (
        <ul className="divide-y divide-gray-100 dark:divide-zinc-800">
          {ownerList.map(owner => {
            const isSelf = owner.username === currentUsername
            const canAct = isAdmin || isSelf
            return (
              <li key={owner.user_id} className="flex items-center justify-between py-2.5 gap-2">
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-zinc-100">{owner.username}</span>
                  {isSelf && (
                    <span className="ml-2 text-xs bg-portal-accent/10 text-portal-accent px-1.5 py-0.5 rounded border border-portal-accent/30">
                      {t('owners.you_badge')}
                    </span>
                  )}
                  <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                    {t('owners.since_label', { date: formatDate(owner.assigned_at) })}
                    {owner.source === 'deploy' && ` · ${t('owners.source_deploy')}`}
                    {owner.source === 'adopt' && ` · ${t('owners.source_adopt')}`}
                    {owner.source === 'transfer' && ` · ${t('owners.source_transfer')}`}
                  </p>
                </div>
                {canAct && (
                  <div className="flex items-center gap-2 shrink-0">
                    {(isAdmin || isSelf) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setTransferFor(owner.user_id)}
                        className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors disabled:opacity-40"
                      >
                        {t('owners.transfer_btn_short')}
                      </button>
                    )}
                    {isSelf && isOwner && (
                      <DeleteRequestButton
                        hasPendingRequest={hasPendingDeleteRequest}
                        onDeleteRequest={deleteRequest}
                      />
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleRemove(owner.user_id)}
                      className="text-xs px-2.5 py-1 rounded border border-portal-danger/30 text-portal-danger hover:bg-portal-danger/10 transition-colors disabled:opacity-40"
                    >
                      {t('owners.remove_btn')}
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Modals */}
      {showAddModal && (
        <AddCoOwnerModal
          existingOwnerIds={ownerList.map(o => o.user_id)}
          onClose={() => setShowAddModal(false)}
          onAdd={addOwner}
        />
      )}

      {transferFor != null && (
        <TransferOwnerModal
          currentUserId={transferFor}
          onClose={() => setTransferFor(null)}
          onTransfer={transferOwner}
        />
      )}

      {confirmRemove && (
        confirmRemove.isLast ? (
          <ConfirmModal
            title={t('owners.last_owner_remove_title')}
            body={t('owners.last_owner_remove_body')}
            confirmLabel={t('owners.last_owner_remove_yes')}
            cancelLabel={t('common.cancel')}
            variant="danger"
            onConfirm={() => doRemove(true)}
            onClose={() => setConfirmRemove(null)}
          />
        ) : (
          <ConfirmModal
            title={t('owners.remove_owner_title')}
            body={t('owners.remove_owner_body')}
            confirmLabel={t('owners.remove_btn')}
            cancelLabel={t('common.cancel')}
            variant="danger"
            onConfirm={() => doRemove(false)}
            onClose={() => setConfirmRemove(null)}
          />
        )
      )}
    </div>
  )
}
