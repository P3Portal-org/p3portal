// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { changePassword } from '../api/profile'

const inputCls =
  'w-full bg-zinc-800 border border-zinc-700 text-zinc-100 px-3 py-2 text-sm ' +
  'placeholder-zinc-500 focus:outline-none focus:border-portal-accent/50 focus:ring-1 focus:ring-portal-accent transition'

export default function ChangePasswordPage() {
  const { t } = useTranslation()
  const { updateToken } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)

  const validate = () => {
    const e = {}
    if (!form.current) e.current = t('change_password.err_current')
    if (form.next.length < 10) e.next = t('change_password.err_min')
    if (form.next !== form.confirm) e.confirm = t('change_password.err_mismatch')
    return e
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)
    try {
      const data = await changePassword(form.current, form.next)
      if (data?.access_token) {
        updateToken(data.access_token)
      }
      navigate('/dashboard')
    } catch (err) {
      const status = err.response?.status
      if (status === 422) {
        const detail = err.response?.data?.detail
        if (Array.isArray(detail)) {
          setErrors({ next: detail[0]?.msg ?? t('change_password.err_invalid_input') })
        } else {
          setErrors({ general: detail ?? t('change_password.err_save') })
        }
      } else {
        setErrors({ general: err.response?.data?.detail ?? t('change_password.err_save') })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-bold text-white tracking-tight uppercase">P3 Portal</h1>
          <p className="text-zinc-500 text-sm mt-1">{t('change_password.subtitle')}</p>
        </div>

        <div className="bg-portal-accent/10 border border-portal-accent/30 px-4 py-3 mb-4">
          <p className="text-sm text-portal-accent">
            {t('change_password.notice')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-zinc-900 border border-zinc-700 p-8 space-y-5">
          {errors.general && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
              {errors.general}
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
              {t('change_password.label_current')}
            </label>
            <input
              type="password"
              value={form.current}
              onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
              required
              autoFocus
              className={`${inputCls} ${errors.current ? 'border-portal-danger/50' : ''}`}
            />
            {errors.current && <p className="text-xs text-portal-danger mt-1">{errors.current}</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
              {t('change_password.label_new')}
            </label>
            <input
              type="password"
              value={form.next}
              onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
              required
              className={`${inputCls} ${errors.next ? 'border-portal-danger/50' : ''}`}
            />
            {errors.next
              ? <p className="text-xs text-portal-danger mt-1">{errors.next}</p>
              : <p className="text-xs text-zinc-600 mt-1">{t('change_password.hint_min')}</p>
            }
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 uppercase tracking-wider mb-1.5">
              {t('change_password.label_confirm')}
            </label>
            <input
              type="password"
              value={form.confirm}
              onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
              required
              className={`${inputCls} ${errors.confirm ? 'border-portal-danger/50' : ''}`}
            />
            {errors.confirm && <p className="text-xs text-portal-danger mt-1">{errors.confirm}</p>}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
          >
            {loading ? t('change_password.saving') : t('change_password.submit')}
          </button>
        </form>

        <p className="text-center text-xs text-zinc-700 mt-6">p3portal.org</p>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
