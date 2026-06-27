// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setupAdmin } from '../../api/setup'

function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export default function WizardStep3Admin({ initial, onNext, onBack }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    username: initial?.username ?? 'admin',
    password: '',
    confirm: '',
  })
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const validate = () => {
    if (!form.username.trim()) return t('setup.s3_err_user')
    if (form.password.length < 12) return t('setup.s3_err_pw_short')
    if (form.password !== form.confirm) return t('setup.s3_err_pw_match')
    return null
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setBusy(true)
    try {
      await setupAdmin({ username: form.username, password: form.password, confirm_password: form.confirm })
      onNext({ username: form.username })
    } catch (ex) {
      setError(ex.response?.data?.detail ?? t('setup.s3_err_save'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent pr-10'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('setup.s3_title')}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.s3_subtitle')}
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.field_username')}</label>
          <input
            type="text"
            value={form.username}
            onChange={(e) => set('username', e.target.value)}
            className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent"
            required
            autoComplete="username"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('setup.field_password')} <span className="text-zinc-400 font-normal">{t('setup.s3_pw_hint')}</span>
          </label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              className={inputCls}
              required
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost">
              <EyeIcon open={showPw} />
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.s3_field_confirm')}</label>
          <div className="relative">
            <input
              type={showConfirm ? 'text' : 'password'}
              value={form.confirm}
              onChange={(e) => set('confirm', e.target.value)}
              className={inputCls}
              required
              autoComplete="new-password"
            />
            <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost">
              <EyeIcon open={showConfirm} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="btn-secondary">
          {t('setup.back')}
        </button>
        <button
          type="submit"
          disabled={busy}
          className="btn-primary"
        >
          {busy ? t('setup.saving') : t('setup.next')}
        </button>
      </div>
    </form>
  )
}
