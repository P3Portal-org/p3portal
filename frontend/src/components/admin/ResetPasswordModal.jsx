// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resetUserPassword } from '../../api/admin'

export default function ResetPasswordModal({ user, onClose, onSuccess }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password.length < 10) {
      setError(t('admin.reset_password.err_min_length'))
      return
    }
    setError('')
    setLoading(true)
    try {
      await resetUserPassword(user.id, password)
      onSuccess()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail ?? t('admin.reset_password.err_save'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-sm mx-4 p-6 rounded-lg">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider mb-1">
          {t('admin.reset_password.title')}
        </h2>
        <p
          className="text-xs text-gray-500 dark:text-zinc-500 mb-5"
          dangerouslySetInnerHTML={{ __html: t('admin.reset_password.description', { username: user.username }) }}
        />

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
              {t('admin.reset_password.label')}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoFocus
                minLength={10}
                className="w-full bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 px-3 py-2 pr-10 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">{t('admin.reset_password.hint')}</p>
          </div>

          {error && (
            <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={loading}
              className="btn-primary flex-1"
            >
              {loading ? t('admin.reset_password.saving') : t('admin.reset_password.submit')}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:border-gray-500 dark:hover:border-zinc-400 text-sm py-2 transition-colors"
            >
              {t('admin.reset_password.cancel')}
            </button>
          </div>
        </form>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
