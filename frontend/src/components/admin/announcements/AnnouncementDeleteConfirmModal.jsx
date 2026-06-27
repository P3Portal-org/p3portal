// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteAnnouncement } from '../../../api/announcements'

export default function AnnouncementDeleteConfirmModal({ announcement, onClose, onDeleted }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setBusy(true)
    setError('')
    try {
      await deleteAnnouncement(announcement.id)
      onDeleted()
    } catch {
      setError(t('admin.announcements.delete_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-sm mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {t('admin.announcements.delete_title')}
          </h2>
          <button onClick={onClose} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {t('admin.announcements.delete_confirm')}
          </p>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-800 rounded-lg px-3 py-2 break-words">
            &ldquo;{announcement.message}&rdquo;
          </p>

          {error && (
            <p className="text-xs text-portal-danger bg-portal-danger/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="btn-danger"
            >
              {busy ? t('common.loading') : t('common.delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
