// p3portal.org
import { useState, useEffect, useCallback, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { createUser, updateUser, setPortalPermissions, resetUserPassword } from '../../api/admin'
import { getApiKeySettings, updateApiKeySettings } from '../../api/userApiKeys'
import { useCapability, useCapabilityList } from '../../hooks/useCapability'
import AssignmentSection from './rbac/AssignmentSection'
import { PlusComponents } from '../../plus'

const ApiKeyMaxCountField = PlusComponents.ApiKeyMaxCountField

// PROJ-44: vollständige kanonische Scope-Liste
const ALL_SCOPES = [
  { value: 'cluster:read',       label: 'cluster:read',       desc: 'Cluster-Status lesen' },
  { value: 'jobs:read',          label: 'jobs:read',          desc: 'Jobs & Logs lesen' },
  { value: 'jobs:write',         label: 'jobs:write',         desc: 'Playbooks starten / Jobs abbrechen' },
  { value: 'playbooks:read',     label: 'playbooks:read',     desc: 'Playbooks anzeigen' },
  { value: 'playbooks:write',    label: 'playbooks:write',    desc: 'Playbooks hochladen / löschen', isNew: true },
  { value: 'packer:read',        label: 'packer:read',        desc: 'Packer-Templates anzeigen' },
  { value: 'packer:write',       label: 'packer:write',       desc: 'Packer-Builds starten' },
  { value: 'groups:read',        label: 'groups:read',        desc: 'Gruppen anzeigen' },
  { value: 'groups:write',       label: 'groups:write',       desc: 'Gruppen verwalten (Plus)' },
  { value: 'pools:read',         label: 'pools:read',         desc: 'Pools anzeigen' },
  { value: 'pools:write',        label: 'pools:write',        desc: 'Pools verwalten (Plus)' },
  { value: 'pools:deploy',       label: 'pools:deploy',       desc: 'Gegen Pool-Quota deployen' },
  { value: 'owners:read',        label: 'owners:read',        desc: 'VM-Owner anzeigen', isNew: true },
  { value: 'approvals:read',     label: 'approvals:read',     desc: 'Freigaben einsehen', isNew: true },
  { value: 'approvals:approve',  label: 'approvals:approve',  desc: 'Freigaben erteilen / ablehnen', isNew: true },
]

const inputCls =
  'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent transition'

// ── Subcomponent: API Key Settings (only shown in edit mode) ─────────────────
function ApiKeySettings({ userId }) {
  const { t } = useTranslation()
  const [enabled, setEnabled]         = useState(false)
  const [scopes, setScopes]           = useState(null)     // null = all allowed
  const [allScopes, setAllScopes]     = useState(false)    // toggle: restrict or allow all
  const [maxCount, setMaxCount]       = useState('')
  const isPlus = useCapability('api_key_max_count_override')
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    getApiKeySettings(userId).then((settings) => {
      setEnabled(settings.api_keys_enabled)
      if (settings.api_keys_allowed_scopes === null) {
        setAllScopes(true)
        setScopes([])
      } else {
        setAllScopes(false)
        setScopes(settings.api_keys_allowed_scopes)
      }
      setMaxCount(settings.api_keys_max_count != null ? String(settings.api_keys_max_count) : '')
    }).catch(() => {
      setError(t('admin.user_form.api_keys_load_error'))
    }).finally(() => setLoading(false))
  }, [userId, t])

  useEffect(() => { load() }, [load])

  const toggleScope = (val) => {
    setScopes(prev => {
      if (!prev) return [val]
      return prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    })
  }

  const handleSave = async () => {
    setError('')
    setSuccess(false)
    setSaving(true)
    try {
      await updateApiKeySettings(userId, {
        enabled,
        allowedScopes: allScopes ? null : (scopes ?? []),
        maxCount: maxCount !== '' && isPlus ? Number(maxCount) : null,
      })
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('admin.user_form.api_keys_save_error'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-xs text-gray-400 dark:text-zinc-500 py-2">{t('admin.user_form.api_keys_loading')}</p>

  return (
    <div className="space-y-3 pt-1">
      {/* Enable / Disable toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <div className="relative">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
          />
          <div className="w-9 h-5 bg-gray-200 dark:bg-zinc-700 rounded-full peer-checked:bg-portal-accent transition-colors" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </div>
        <span className="text-sm text-gray-700 dark:text-zinc-300">
          {t('admin.user_form.api_keys_enable')}
        </span>
      </label>

      {enabled && (
        <>
          {/* Scope restriction */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
              {t('admin.user_form.api_keys_allowed_scopes')}
            </p>
            <label className="flex items-center gap-2 mb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allScopes}
                onChange={e => setAllScopes(e.target.checked)}
                className="accent-portal-accent"
              />
              <span className="text-xs text-gray-700 dark:text-zinc-300">{t('admin.user_form.api_keys_allow_all')}</span>
            </label>
            {!allScopes && (
              <div className="pl-1 space-y-1.5">
                {ALL_SCOPES.map(s => (
                  <label key={s.value} className="flex items-start gap-2 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={(scopes ?? []).includes(s.value)}
                      onChange={() => toggleScope(s.value)}
                      className="mt-0.5 accent-portal-accent"
                    />
                    <div>
                      <span className="text-xs font-mono text-gray-700 dark:text-zinc-300">{s.label}</span>
                      {s.isNew && (
                        <span className="ml-1.5 text-xs bg-portal-info/10 text-portal-info px-1 py-0.5 rounded">Neu</span>
                      )}
                      <p className="text-xs text-gray-400 dark:text-zinc-500">{s.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Max count – Plus only (Session 16: in plus/UserForm/ extrahiert) */}
          {isPlus && ApiKeyMaxCountField && (
            <Suspense fallback={null}>
              <ApiKeyMaxCountField value={maxCount} onChange={setMaxCount} />
            </Suspense>
          )}
        </>
      )}

      {error && (
        <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-2 py-1.5">{error}</p>
      )}
      {success && (
        <p className="text-xs text-portal-success bg-portal-success/10 border border-portal-success/30 px-2 py-1.5">{t('admin.user_form.api_keys_saved')}</p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="btn-primary"
      >
        {saving ? t('admin.user_form.api_keys_saving') : t('admin.user_form.api_keys_save')}
      </button>
    </div>
  )
}

// ── Subcomponent: Account-Status (Aktivieren / Deaktivieren) ─────────────────
function AccountStatusSection({ user, onRefresh }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = async () => {
    setError('')
    setBusy(true)
    try {
      await updateUser(user.id, { active: !user.active })
      onRefresh()
    } catch (err) {
      const msg = err.response?.data?.detail
      if (err.response?.status === 409) {
        setError(msg ?? t('admin.user_table.err_last_admin'))
      } else {
        setError(msg ?? t('admin.user_table.err_update'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-zinc-700 pt-4">
      <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
        {t('admin.user_form.account_status_section')}
      </h3>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-700 dark:text-zinc-300">
          {user.active ? t('admin.user_form.account_status_active') : t('admin.user_form.account_status_inactive')}
        </p>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={`text-sm px-4 py-2 border transition-colors disabled:opacity-50 ${
            user.active
              ? 'text-portal-accent border-portal-accent/50 hover:bg-portal-accent/10'
              : 'text-portal-success border-portal-success/50 hover:bg-portal-success/10'
          }`}
        >
          {busy ? '…' : user.active ? t('admin.user_form.account_deactivate') : t('admin.user_form.account_activate')}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-2 py-1.5">{error}</p>
      )}
    </div>
  )
}

// ── Subcomponent: Passwort zurücksetzen ───────────────────────────────────────
function ResetPasswordSection({ userId }) {
  const { t } = useTranslation()
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const handleReset = async () => {
    if (password.length < 10) {
      setError(t('admin.reset_password.err_min_length'))
      return
    }
    setError('')
    setSuccess(false)
    setBusy(true)
    try {
      await resetUserPassword(userId, password)
      setPassword('')
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
    } catch (err) {
      setError(err.response?.data?.detail ?? t('admin.reset_password.err_save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-gray-200 dark:border-zinc-700 pt-4">
      <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
        {t('admin.user_form.reset_pw_section')}
      </h3>
      <div className="space-y-2">
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder={t('admin.reset_password.label')}
            minLength={10}
            className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 pr-10 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent transition"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
            tabIndex={-1}
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
        <p className="text-xs text-gray-400 dark:text-zinc-600">{t('admin.reset_password.hint')}</p>
        {error && (
          <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-2 py-1.5">{error}</p>
        )}
        {success && (
          <p className="text-xs text-portal-success bg-portal-success/10 border border-portal-success/30 px-2 py-1.5">{t('admin.user_form.reset_pw_success')}</p>
        )}
        <button
          type="button"
          onClick={handleReset}
          disabled={busy || !password}
          className="btn-danger"
        >
          {busy ? '…' : t('admin.reset_password.submit')}
        </button>
      </div>
    </div>
  )
}

// Core-Permissions ohne Plus-only Einträge (manage_pools, manage_playbook_permissions wandern in Plus).
// Extra Plus-Permissions kommen zur Laufzeit via useCapabilityList('extra_portal_permissions').
const CORE_PORTAL_PERMISSIONS = [
  'manage_users',
  'manage_nodes',
  'manage_settings',
  'manage_api_keys',
  'manage_help',
  'manage_backup_jobs',
  'manage_networks',
  'manage_sdn',
  'manage_firewall',
  'view_logs',
]

// ── Subcomponent: Portal Permissions (edit mode, non-admin users only) ────────
function PortalPermissionsSection({ user }) {
  const { t } = useTranslation()
  const [perms, setPerms]     = useState(user.portal_permissions ?? [])
  const extraPerms = useCapabilityList('extra_portal_permissions')
  const allPortalPermissions = [...CORE_PORTAL_PERMISSIONS, ...extraPerms]
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState(false)

  const togglePerm = (perm) => {
    setPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm])
  }

  const handleSave = async () => {
    setError('')
    setSuccess(false)
    setSaving(true)
    try {
      await setPortalPermissions(user.id, perms)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 2500)
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('admin.user_form.portal_perms_save_error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 pt-1">
      <p className="text-xs text-gray-400 dark:text-zinc-500 mb-3">
        {t('admin.user_form.portal_perms_hint')}
      </p>
      {allPortalPermissions.map(perm => (
        <label key={perm} className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={perms.includes(perm)}
              onChange={() => togglePerm(perm)}
            />
            <div className="w-9 h-5 bg-gray-200 dark:bg-zinc-700 rounded-full peer-checked:bg-portal-accent transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
          </div>
          <span className="text-sm text-gray-700 dark:text-zinc-300">
            {t(`admin.user_form.perm_${perm}`)}
          </span>
        </label>
      ))}

      {error && (
        <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-2 py-1.5">{error}</p>
      )}
      {success && (
        <p className="text-xs text-portal-success bg-portal-success/10 border border-portal-success/30 px-2 py-1.5">
          {t('admin.user_form.portal_perms_saved')}
        </p>
      )}

      <p className="text-xs text-portal-warn/90 bg-portal-warn/10 border border-portal-warn/30 px-2 py-1.5">
        {t('admin.user_form.portal_perms_jwt_hint')}
      </p>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="btn-primary"
      >
        {saving ? t('admin.user_form.portal_perms_saving') : t('admin.user_form.portal_perms_save')}
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function UserForm({ user, onSuccess, onCancel }) {
  const { t } = useTranslation()
  const isEdit = !!user
  const [form, setForm] = useState({
    username: '',
    password: '',
    passwordConfirm: '',
    role: 'operator',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const ROLES = [
    { value: 'restricted', label: t('admin.user_form.role_restricted') },
    { value: 'viewer', label: t('admin.user_form.role_viewer') },
    { value: 'operator', label: t('admin.user_form.role_operator') },
    { value: 'admin', label: t('admin.user_form.role_admin') },
  ]

  useEffect(() => {
    if (user) {
      setForm({ username: user.username, password: '', passwordConfirm: '', role: user.role })
    }
  }, [user])

  const handleChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!isEdit && form.password !== form.passwordConfirm) {
      setError(t('admin.user_form.err_passwords_mismatch'))
      return
    }
    if (isEdit && form.password && form.password !== form.passwordConfirm) {
      setError(t('admin.user_form.err_passwords_mismatch'))
      return
    }

    setLoading(true)
    try {
      if (isEdit) {
        const payload = { role: form.role }
        if (form.password) payload.password = form.password
        await updateUser(user.id, payload)
      } else {
        await createUser({
          username: form.username,
          password: form.password,
          role: form.role,
        })
      }
      onSuccess()
    } catch (err) {
      const detail = err.response?.data?.detail
      if (err.response?.status === 409) {
        setError(detail ?? t('admin.user_form.err_username_taken'))
      } else if (err.response?.status === 422) {
        const msg = Array.isArray(detail)
          ? detail.map((d) => d.msg).join(', ')
          : (detail ?? t('admin.user_form.err_invalid_input'))
        setError(msg)
      } else {
        setError(detail ?? t('admin.user_form.err_save'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
          {t('admin.user_form.label_username')}
        </label>
        <input
          name="username"
          type="text"
          required={!isEdit}
          disabled={isEdit}
          value={form.username}
          onChange={handleChange}
          placeholder={t('admin.user_form.placeholder_username')}
          className={`${inputCls} ${isEdit ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        {!isEdit && (
          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">{t('admin.user_form.no_at_hint')}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
          {isEdit ? t('admin.user_form.label_password_edit') : t('admin.user_form.label_password')}
        </label>
        <div className="relative">
          <input
            name="password"
            type={showPassword ? 'text' : 'password'}
            required={!isEdit}
            value={form.password}
            onChange={handleChange}
            placeholder={t('admin.user_form.placeholder_password')}
            className={`${inputCls} pr-10`}
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
      </div>

      {(!isEdit || form.password) && (
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
            {t('admin.user_form.label_password_confirm')}
          </label>
          <div className="relative">
            <input
              name="passwordConfirm"
              type={showPassword ? 'text' : 'password'}
              required={!isEdit || !!form.password}
              value={form.passwordConfirm}
              onChange={handleChange}
              className={`${inputCls} pr-10`}
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
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
          {t('admin.user_form.label_role')}
        </label>
        <select name="role" value={form.role} onChange={handleChange} className={inputCls}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary flex-1"
        >
          {loading ? t('admin.user_form.saving') : isEdit ? t('admin.user_form.btn_save_changes') : t('admin.user_form.btn_create')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          {t('admin.user_form.btn_cancel')}
        </button>
      </div>
      <span className="rq hidden" aria-hidden="true" />

      {/* Aktivieren / Deaktivieren – nur im Edit-Mode */}
      {isEdit && (
        <AccountStatusSection user={user} onRefresh={onSuccess} />
      )}

      {/* Passwort zurücksetzen – nur im Edit-Mode */}
      {isEdit && (
        <ResetPasswordSection userId={user.id} />
      )}

      {/* Ressourcen-Zuweisungen – nur im Edit-Mode */}
      {isEdit && <AssignmentSection userId={user.id} />}

      {/* API Key Settings – nur im Edit-Mode */}
      {isEdit && (
        <div className="border-t border-gray-200 dark:border-zinc-700 pt-4">
          <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
            {t('admin.user_form.api_keys_section')}
          </h3>
          <ApiKeySettings userId={user.id} />
        </div>
      )}

      {/* Portal-Berechtigungen – nur im Edit-Mode, nur für Nicht-Admins */}
      {isEdit && user.role !== 'admin' && (
        <div className="border-t border-gray-200 dark:border-zinc-700 pt-4">
          <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
            {t('admin.user_form.portal_perms_section')}
          </h3>
          <PortalPermissionsSection user={user} />
        </div>
      )}
    </form>
  )
}
