// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchAdminAnnouncements, updateAnnouncement } from '../../../api/announcements'
import AnnouncementFormModal from './AnnouncementFormModal'
import AnnouncementDeleteConfirmModal from './AnnouncementDeleteConfirmModal'

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function SeverityBadge({ severity }) {
  const { t } = useTranslation()
  const cls = {
    info: 'bg-portal-info/15 text-portal-info',
    warn: 'bg-portal-warn/15 text-portal-warn',
    critical: 'bg-portal-danger/15 text-portal-danger',
    success: 'bg-portal-success/15 text-portal-success',
  }[severity] ?? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {t(`admin.announcements.severity_${severity}`, severity)}
    </span>
  )
}

function StatusBadge({ active, expired }) {
  const { t } = useTranslation()
  if (expired) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
        {t('admin.announcements.status_expired')}
      </span>
    )
  }
  if (active) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-portal-success/15 text-portal-success">
        {t('admin.announcements.status_active')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
      {t('admin.announcements.status_inactive')}
    </span>
  )
}

function isExpired(item) {
  if (!item.expires_at) return false
  return new Date(item.expires_at) < new Date()
}

function formatDate(iso) {
  if (!iso) return '–'
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export default function AnnouncementsSection() {
  const { t } = useTranslation()
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [modal, setModal] = useState(null)

  const load = useCallback(async () => {
    setFetchError('')
    try {
      const data = await fetchAdminAnnouncements()
      setAnnouncements(data)
    } catch {
      setFetchError(t('admin.announcements.load_error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { load() }, [load])

  const handleToggleActive = async (item) => {
    try {
      await updateAnnouncement(item.id, { active: !item.active })
      setAnnouncements((prev) =>
        prev.map((a) => a.id === item.id ? { ...a, active: !a.active } : a)
      )
    } catch {
      // silent – table still shows current state
    }
  }

  const handleSaved = () => {
    setModal(null)
    load()
  }

  const handleDeleted = () => {
    setModal(null)
    load()
  }

  const activeCount = announcements.filter((a) => a.active && !isExpired(a)).length

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {t('admin.announcements.title')}
          </h2>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            {t('admin.announcements.description')}
          </p>
        </div>
        <button
          onClick={() => setModal({ type: 'create' })}
          className="btn-primary flex items-center gap-1.5"
        >
          <PlusIcon />
          {t('admin.announcements.create_btn')}
        </button>
      </div>

      {activeCount > 3 && (
        <div className="mb-4 rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-2.5 text-sm text-portal-warn">
          {t('admin.announcements.many_active_hint', { count: activeCount })}
        </div>
      )}

      {fetchError && (
        <p className="text-sm text-portal-danger bg-portal-danger/10 px-3 py-2 rounded-lg mb-4">{fetchError}</p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500 text-center py-8">{t('common.loading')}</p>
      ) : announcements.length === 0 ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500 text-center py-8">{t('admin.announcements.empty')}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                  {t('admin.announcements.col_message')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                  {t('admin.announcements.col_severity')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                  {t('admin.announcements.col_status')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider hidden md:table-cell">
                  {t('admin.announcements.col_expires')}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider hidden lg:table-cell">
                  {t('admin.announcements.col_created_by')}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                  {t('admin.announcements.col_actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {announcements.map((item) => {
                const expired = isExpired(item)
                return (
                  <tr key={item.id} className="bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800/50 transition-colors">
                    <td className="px-4 py-3 text-zinc-900 dark:text-zinc-100 max-w-xs">
                      <span className="line-clamp-2">{item.message}</span>
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={item.severity} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => !expired && handleToggleActive(item)}
                          disabled={expired}
                          title={expired ? t('admin.announcements.status_expired') : ''}
                          className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-portal-accent focus:ring-offset-1 ${
                            item.active && !expired
                              ? 'bg-portal-accent'
                              : 'bg-zinc-300 dark:bg-zinc-600'
                          } ${expired ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                          aria-label={t('admin.announcements.toggle_active_label')}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition-transform ${
                              item.active && !expired ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                        <StatusBadge active={item.active} expired={expired} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
                      {formatDate(item.expires_at)}
                    </td>
                    <td className="px-4 py-3 text-zinc-500 dark:text-zinc-400 hidden lg:table-cell">
                      {item.created_by}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setModal({ type: 'edit', item })}
                          className="btn-table"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          onClick={() => setModal({ type: 'delete', item })}
                          className="btn-table-danger"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal?.type === 'create' && (
        <AnnouncementFormModal onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.type === 'edit' && (
        <AnnouncementFormModal announcement={modal.item} onClose={() => setModal(null)} onSaved={handleSaved} />
      )}
      {modal?.type === 'delete' && (
        <AnnouncementDeleteConfirmModal announcement={modal.item} onClose={() => setModal(null)} onDeleted={handleDeleted} />
      )}
    </>
  )
}
