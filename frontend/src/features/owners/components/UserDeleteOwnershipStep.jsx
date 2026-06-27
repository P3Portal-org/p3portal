// p3portal.org
// PROJ-48: Pflicht-Sub-Schritt im User-Delete-Modal wenn User Owner-Einträge hat (AC-USER-DEL-1/2).
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export default function UserDeleteOwnershipStep({
  username,
  ownerCount,
  allUsers = [],
  onActionChange,
  onConfirm,
  onCancel,
  disabled = false,
}) {
  const { t } = useTranslation()
  const [action, setAction] = useState('') // '' | 'orphan' | 'transfer'
  const [transferToId, setTransferToId] = useState('')

  useEffect(() => {
    if (action === 'orphan') {
      onActionChange?.({ action: 'orphan', transferToId: null })
    } else if (action === 'transfer' && transferToId) {
      onActionChange?.({ action: 'transfer', transferToId: Number(transferToId) })
    } else {
      onActionChange?.(null)
    }
  }, [action, transferToId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ownerCount) return null

  return (
    <div className="mb-3 rounded border border-portal-warn/30 bg-portal-warn/10 p-4 space-y-3">
      <p className="text-sm font-semibold text-portal-warn">
        {t('owners.user_delete_step_title')}
      </p>
      <p className="text-xs text-portal-warn">
        {t('owners.user_delete_step_body', { count: ownerCount, username })}
      </p>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
          <input
            type="radio"
            name="ownership_action"
            value="orphan"
            checked={action === 'orphan'}
            onChange={() => { setAction('orphan'); setTransferToId('') }}
            className="accent-portal-accent"
          />
          {t('owners.user_delete_orphan')}
        </label>

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
          <input
            type="radio"
            name="ownership_action"
            value="transfer"
            checked={action === 'transfer'}
            onChange={() => setAction('transfer')}
            className="accent-portal-accent"
          />
          {t('owners.user_delete_transfer')}
        </label>

        {action === 'transfer' && (
          <select
            value={transferToId}
            onChange={e => setTransferToId(e.target.value)}
            className="w-full mt-1 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-portal-accent"
          >
            <option value="">– {t('owners.user_delete_transfer_to')} –</option>
            {allUsers.map(u => (
              <option key={u.id} value={u.id}>{u.username}</option>
            ))}
          </select>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled}
          className="text-xs px-3 py-1.5 bg-portal-danger hover:bg-portal-danger disabled:opacity-40 text-white transition-colors"
        >
          {t('admin.user_table.confirm_yes')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs px-3 py-1.5 border border-gray-600 text-gray-400 hover:border-gray-400 transition-colors"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
