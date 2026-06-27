// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createAnnouncement, updateAnnouncement } from '../../../api/announcements'

const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent focus:border-transparent'

const SEVERITY_OPTIONS = ['info', 'warn', 'critical', 'success']

export default function AnnouncementFormModal({ announcement, onClose, onSaved }) {
  const { t } = useTranslation()
  const isEdit = !!announcement

  const [form, setForm] = useState({
    message: announcement?.message ?? '',
    severity: announcement?.severity ?? 'info',
    active: announcement?.active ?? true,
    noExpiry: !announcement?.expires_at,
    expires_at: announcement?.expires_at
      ? announcement.expires_at.slice(0, 16)
      : '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const canSubmit = form.message.trim().length > 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      const payload = {
        message: form.message.trim(),
        severity: form.severity,
        active: form.active,
        expires_at: (!form.noExpiry && form.expires_at)
          ? new Date(form.expires_at).toISOString()
          : null,
      }
      if (isEdit) {
        await updateAnnouncement(announcement.id, payload)
      } else {
        await createAnnouncement(payload)
      }
      onSaved()
    } catch (ex) {
      const detail = ex.response?.data?.detail
      setError(
        typeof detail === 'string'
          ? detail
          : t('admin.announcements.save_error')
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {isEdit ? t('admin.announcements.modal_edit') : t('admin.announcements.modal_create')}
          </h2>
          <button onClick={onClose} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Message */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('admin.announcements.field_message')} <span className="text-portal-danger">*</span>
            </label>
            <textarea
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
              className={`${inputCls} resize-y min-h-[80px]`}
              placeholder={t('admin.announcements.field_message_placeholder')}
              autoFocus
            />
          </div>

          {/* Severity */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              {t('admin.announcements.field_severity')}
            </label>
            <div className="flex flex-wrap gap-3">
              {SEVERITY_OPTIONS.map((opt) => (
                <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="ann-severity"
                    value={opt}
                    checked={form.severity === opt}
                    onChange={() => set('severity', opt)}
                    className="h-4 w-4 border-zinc-300 text-portal-accent focus:ring-portal-accent"
                  />
                  <span className="text-sm text-zinc-800 dark:text-zinc-200">
                    {t(`admin.announcements.severity_${opt}`)}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Active */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set('active', e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-portal-accent focus:ring-portal-accent"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {t('admin.announcements.field_active')}
              </span>
            </label>
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              {t('admin.announcements.field_expires')}
            </label>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={form.noExpiry}
                onChange={(e) => set('noExpiry', e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-portal-accent focus:ring-portal-accent"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">
                {t('admin.announcements.no_expiry')}
              </span>
            </label>
            {!form.noExpiry && (
              <input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => set('expires_at', e.target.value)}
                className={inputCls}
              />
            )}
          </div>

          {error && (
            <p className="text-xs text-portal-danger bg-portal-danger/10 px-3 py-2 rounded-lg">{error}</p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={!canSubmit || busy}
              className="btn-primary"
            >
              {busy ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
