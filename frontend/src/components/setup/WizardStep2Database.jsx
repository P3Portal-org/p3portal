// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setupDatabase, testDatabaseConnection } from '../../api/setup'

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

const DEFAULT_FORM = {
  db_type: 'sqlite',
  host: '',
  port: 5432,
  database: '',
  username: '',
  password: '',
}

export default function WizardStep1Database({ initial, onNext }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    ...DEFAULT_FORM,
    ...Object.fromEntries(Object.entries(initial || {}).filter(([, v]) => v !== undefined)),
  })
  const [showPw, setShowPw] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTestResult(null)
  }

  const isPostgres = form.db_type === 'postgresql'

  const validatePostgres = () => {
    if (!form.host.trim()) return t('setup.s2_err_host')
    if (!form.database.trim()) return t('setup.s2_err_db')
    if (!form.username.trim()) return t('setup.s2_err_user')
    if (!form.password) return t('setup.s2_err_pw')
    return null
  }

  const handleTest = async () => {
    const err = validatePostgres()
    if (err) { setTestResult({ ok: false, error: err }); return }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testDatabaseConnection({
        host: form.host,
        port: Number(form.port),
        database: form.database,
        username: form.username,
        password: form.password,
      })
      setTestResult(result)
    } catch (ex) {
      setTestResult({ ok: false, error: ex.response?.data?.detail ?? t('setup.test_btn') })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!isPostgres) {
      onNext({ db_type: 'sqlite' })
      return
    }

    const err = validatePostgres()
    if (err) { setError(err); return }

    setBusy(true)
    try {
      await setupDatabase({
        db_type: 'postgresql',
        host: form.host,
        port: Number(form.port),
        database: form.database,
        username: form.username,
        password: form.password,
      })
      onNext({
        db_type: 'postgresql',
        db_host: form.host,
        db_port: form.port,
        db_database: form.database,
        db_username: form.username,
      })
    } catch (ex) {
      setError(ex.response?.data?.detail ?? t('setup.s2_err_save'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('setup.s2_title')}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.s2_subtitle')}
        </p>
      </div>

      {/* DB-Typ Auswahl */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { value: 'sqlite', label: 'SQLite', desc: t('setup.s2_sqlite_desc'), experimental: false },
          { value: 'postgresql', label: 'PostgreSQL', desc: t('setup.s2_postgres_desc'), experimental: true },
        ].map(({ value, label, desc, experimental }) => (
          <button
            key={value}
            type="button"
            onClick={() => set('db_type', value)}
            className={`text-left p-4 rounded-lg border-2 transition-colors ${
              form.db_type === value
                ? 'border-portal-accent bg-portal-accent/10'
                : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
            }`}
          >
            <div className="flex items-center gap-2">
              <p className={`text-sm font-semibold ${form.db_type === value ? 'text-portal-accent' : 'text-zinc-800 dark:text-zinc-200'}`}>
                {label}
              </p>
              {experimental && (
                <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-portal-warn/10 text-portal-warn">
                  {t('setup.s2_experimental_badge')}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">{desc}</p>
          </button>
        ))}
      </div>

      {/* PostgreSQL-Felder */}
      {isPostgres && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 bg-portal-warn/10 border border-portal-warn/30 rounded-lg px-3 py-2.5">
            <span className="text-portal-warn shrink-0 text-sm mt-0.5">⚠</span>
            <p className="text-xs text-portal-warn">
              {t('setup.s2_postgres_warn')}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.field_host')}</label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => set('host', e.target.value)}
                className={inputCls}
                placeholder="192.168.1.10"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                {t('setup.field_port')} <span className="text-zinc-400 font-normal text-xs">{t('setup.s2_port_hint')}</span>
              </label>
              <input
                type="number"
                value={form.port}
                onChange={(e) => set('port', Number(e.target.value))}
                className={inputCls}
                min={1}
                max={65535}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.s2_field_db')}</label>
            <input
              type="text"
              value={form.database}
              onChange={(e) => set('database', e.target.value)}
              className={inputCls}
              placeholder="p3portal"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.field_username')}</label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => set('username', e.target.value)}
                className={inputCls}
                placeholder="p3portal"
                autoComplete="username"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.field_password')}</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  className={`${inputCls} pr-10`}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost"
                >
                  <EyeIcon open={showPw} />
                </button>
              </div>
            </div>
          </div>

          {/* Verbindungstest */}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="btn-secondary"
            >
              {testing ? t('setup.testing') : t('setup.test_btn')}
            </button>
            {testResult && (
              <span className={`text-sm ${testResult.ok ? 'text-portal-success' : 'text-portal-danger'}`}>
                {testResult.ok ? t('setup.s2_test_ok') : `✗ ${testResult.error}`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* SQLite-Info */}
      {!isPostgres && (
        <div className="flex items-start gap-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {t('setup.s2_sqlite_info')} <code className="text-xs bg-zinc-100 dark:bg-zinc-700 px-1 py-0.5 rounded">/app/data/portal.db</code>
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-end">
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
