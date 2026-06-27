// p3portal.org
// PROJ-48: Modal für Eigentums-Übertragung (AC-TR-1/AC-TR-2).
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchUsers } from '../../../api/admin'
import { formatApiError } from '../../../api/errors'

export default function TransferOwnerModal({ currentUserId, onClose, onTransfer }) {
  const { t } = useTranslation()
  const [users, setUsers] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchUsers()
      .then(data => setUsers(data.filter(u => u.id !== currentUserId)))
      .catch(err => setError(formatApiError(err)))
  }, [currentUserId])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedId || !confirmed) return
    setBusy(true)
    setError('')
    try {
      await onTransfer(Number(selectedId))
      onClose()
    } catch (err) {
      setError(formatApiError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col"
      >
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {t('owners.transfer_title')}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-gray-600 dark:text-zinc-400">{t('owners.transfer_hint')}</p>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wide mb-1">
              {t('owners.transfer_to_user')} *
            </label>
            <select
              value={selectedId}
              onChange={e => setSelectedId(e.target.value)}
              required
              className="w-full border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-sm text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-portal-accent"
            >
              <option value="">{t('owners.transfer_user_placeholder')}</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="w-4 h-4 accent-portal-accent"
            />
            {t('owners.transfer_confirm_check')}
          </label>
          {error && <p className="text-sm text-portal-danger">{error}</p>}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={busy}
            className="btn-secondary">
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={!selectedId || !confirmed || busy}
            className="btn-primary">
            {busy ? '…' : t('owners.transfer_btn')}
          </button>
        </div>
      </form>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
