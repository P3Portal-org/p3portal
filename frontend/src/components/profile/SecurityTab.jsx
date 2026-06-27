// p3portal.org
import { useState } from 'react'
import { changePassword } from '../../api/profile'

const inputCls =
  'w-full bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-600 ' +
  'text-gray-900 dark:text-zinc-100 pl-3 pr-9 py-2 text-sm ' +
  'focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent transition'

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function PasswordInput({ id, value, onChange, hasError }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={`${inputCls} ${hasError ? 'border-portal-danger' : ''}`}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 btn-ghost transition-colors"
        tabIndex={-1}
        aria-label={show ? 'Passwort verbergen' : 'Passwort anzeigen'}
      >
        <EyeIcon visible={show} />
      </button>
    </div>
  )
}

export default function SecurityTab({ authType, onPasswordChanged }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  if (authType !== 'local') {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
        <div className="py-4 px-3 bg-portal-info/10 border border-portal-info/30 text-sm text-portal-info">
          Ihr Passwort wird über Proxmox verwaltet. Eine Änderung ist nur direkt in Proxmox möglich.
        </div>
      </div>
    )
  }

  const validate = () => {
    const e = {}
    if (!form.current) e.current = 'Bitte aktuelles Passwort eingeben.'
    if (form.next.length < 10) e.next = 'Mindestens 10 Zeichen erforderlich.'
    if (form.next !== form.confirm) e.confirm = 'Passwörter stimmen nicht überein.'
    return e
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSuccess(false)
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setLoading(true)
    try {
      const data = await changePassword(form.current, form.next)
      if (data?.access_token) onPasswordChanged(data.access_token)
      setForm({ current: '', next: '', confirm: '' })
      setSuccess(true)
    } catch (err) {
      const status = err.response?.status
      if (status === 403) {
        setErrors({ current: 'Aktuelles Passwort ist falsch.' })
      } else {
        setErrors({ general: err.response?.data?.detail ?? 'Fehler beim Speichern.' })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
        {success && (
          <p className="text-xs text-portal-success bg-portal-success/10 border border-portal-success/30 px-3 py-2">
            Passwort erfolgreich geändert.
          </p>
        )}
        {errors.general && (
          <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
            {errors.general}
          </p>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
            Aktuelles Passwort
          </label>
          <PasswordInput
            id="pw-current"
            value={form.current}
            onChange={e => setForm(f => ({ ...f, current: e.target.value }))}
            hasError={!!errors.current}
          />
          {errors.current && <p className="text-xs text-portal-danger mt-1">{errors.current}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
            Neues Passwort
          </label>
          <PasswordInput
            id="pw-next"
            value={form.next}
            onChange={e => setForm(f => ({ ...f, next: e.target.value }))}
            hasError={!!errors.next}
          />
          {errors.next
            ? <p className="text-xs text-portal-danger mt-1">{errors.next}</p>
            : <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">Mindestens 10 Zeichen</p>
          }
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
            Neues Passwort bestätigen
          </label>
          <PasswordInput
            id="pw-confirm"
            value={form.confirm}
            onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
            hasError={!!errors.confirm}
          />
          {errors.confirm && <p className="text-xs text-portal-danger mt-1">{errors.confirm}</p>}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary"
        >
          {loading ? 'Speichern…' : 'Passwort ändern'}
        </button>
        <span className="rq hidden" aria-hidden="true" />
      </form>
    </div>
  )
}
