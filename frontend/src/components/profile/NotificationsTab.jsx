// p3portal.org
import { useState, useEffect } from 'react'
import { getNotificationSettings, setNotificationSettings } from '../../api/profile'
import TestWebhookButton, {
  WEBHOOK_RECEIVERS,
  WEBHOOK_URL_LABELS,
  WEBHOOK_URL_PLACEHOLDERS,
  WEBHOOK_TOKEN_LABELS,
  WEBHOOK_TOKEN_PLACEHOLDERS,
  WEBHOOK_TOKEN_IN_URL,
} from '../common/TestWebhookButton'

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Niedrig (alle Alerts)' },
  { value: 'medium', label: 'Mittel' },
  { value: 'high', label: 'Hoch' },
  { value: 'critical', label: 'Kritisch (nur kritische Alerts)' },
]

export default function NotificationsTab() {
  const [settings, setSettings] = useState({
    email_enabled: false,
    email_address: '',
    webhook_url: '',
    webhook_token: '',
    webhook_receiver_type: 'custom',
    min_severity: 'high',
  })
  // Server tells us whether a token is already stored. We keep the input
  // empty by default so the user must type to overwrite (placeholder hint).
  const [tokenAlreadySet, setTokenAlreadySet] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    getNotificationSettings()
      .then(data => {
        setSettings({
          email_enabled: data.email_enabled ?? false,
          email_address: data.email_address ?? '',
          webhook_url: data.webhook_url ?? '',
          webhook_token: '',
          webhook_receiver_type: data.webhook_receiver_type ?? 'custom',
          min_severity: data.min_severity ?? 'high',
        })
        setTokenAlreadySet(!!data.webhook_token_set)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMsg(null)
    try {
      // Only send webhook_token when the user actually typed something;
      // omitting the key keeps the previously stored token untouched.
      const { webhook_token, ...rest } = settings
      const payload = webhook_token
        ? { ...rest, webhook_token }
        : rest
      await setNotificationSettings(payload)
      if (webhook_token) setTokenAlreadySet(true)
      setSettings(s => ({ ...s, webhook_token: '' }))
      setMsg({ type: 'success', text: 'Einstellungen gespeichert.' })
    } catch {
      setMsg({ type: 'error', text: 'Fehler beim Speichern.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleClearToken() {
    setSaving(true)
    setMsg(null)
    try {
      const rest = { ...settings }
      delete rest.webhook_token
      await setNotificationSettings({ ...rest, webhook_token: null })
      setTokenAlreadySet(false)
      setSettings(s => ({ ...s, webhook_token: '' }))
      setMsg({ type: 'success', text: 'Webhook-Token entfernt.' })
    } catch {
      setMsg({ type: 'error', text: 'Token konnte nicht entfernt werden.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="h-32 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 mb-1">
          Alert-Benachrichtigungen
        </h2>
        <p className="text-xs text-gray-500 dark:text-zinc-400">
          Persönliche Einstellungen für E-Mail- und Webhook-Benachrichtigungen bei Alerts.
        </p>
      </div>

      {/* E-Mail */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">E-Mail-Benachrichtigungen</p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Alerts per E-Mail erhalten
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.email_enabled}
            onClick={() => setSettings(s => ({ ...s, email_enabled: !s.email_enabled }))}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              settings.email_enabled ? 'bg-portal-accent' : 'bg-gray-200 dark:bg-zinc-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                settings.email_enabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
        {settings.email_enabled && (
          <div>
            <label className="text-xs font-medium text-gray-700 dark:text-zinc-300 block mb-1">
              E-Mail-Adresse
            </label>
            <input
              type="email"
              value={settings.email_address}
              onChange={e => setSettings(s => ({ ...s, email_address: e.target.value }))}
              placeholder="alert@example.com"
              className="w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-portal-accent"
            />
          </div>
        )}
      </div>

      {/* Webhook */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">Webhook-Benachrichtigung</p>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Leer lassen um Webhook zu deaktivieren
          </p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">Empfänger</p>
          <select
            value={settings.webhook_receiver_type}
            onChange={e => setSettings(s => ({ ...s, webhook_receiver_type: e.target.value }))}
            className="w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-portal-accent"
          >
            {WEBHOOK_RECEIVERS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
            {WEBHOOK_URL_LABELS[settings.webhook_receiver_type] ?? 'Webhook-URL'} (optional)
          </p>
          <input
            type="url"
            value={settings.webhook_url}
            onChange={e => setSettings(s => ({ ...s, webhook_url: e.target.value }))}
            placeholder={WEBHOOK_URL_PLACEHOLDERS[settings.webhook_receiver_type] ?? 'https://...'}
            className="w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-portal-accent"
          />
          {settings.webhook_receiver_type === 'gotify' && settings.webhook_url && (
            <p className="mt-1 text-xs text-portal-info">
              Sendet an: <code>{settings.webhook_url.replace(/\/$/, '')}/message?token=…</code>
            </p>
          )}
        </div>
        {WEBHOOK_TOKEN_IN_URL.includes(settings.webhook_receiver_type) ? (
          <p className="text-xs text-portal-info">
            Token ist in der Webhook-URL enthalten – kein separates Token-Feld nötig.
          </p>
        ) : (
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {WEBHOOK_TOKEN_LABELS[settings.webhook_receiver_type] ?? 'Token'} (optional)
            </p>
            <input
              type="password"
              autoComplete="new-password"
              value={settings.webhook_token}
              onChange={e => setSettings(s => ({ ...s, webhook_token: e.target.value }))}
              placeholder={
                tokenAlreadySet
                  ? '•••• gespeichert – zum Überschreiben tippen'
                  : (WEBHOOK_TOKEN_PLACEHOLDERS[settings.webhook_receiver_type] ?? '')
              }
              className="w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-portal-accent"
            />
            {tokenAlreadySet && (
              <button
                type="button"
                onClick={handleClearToken}
                disabled={saving}
                className="mt-1 text-xs text-portal-danger hover:underline disabled:opacity-50"
              >
                Token entfernen
              </button>
            )}
          </div>
        )}
        <TestWebhookButton
          url={settings.webhook_url}
          token={settings.webhook_token}
          receiverType={settings.webhook_receiver_type}
        />
      </div>

      {/* Schweregrad */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">Mindest-Schweregrad</p>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Nur Alerts ab diesem Schweregrad benachrichtigen
          </p>
        </div>
        <select
          value={settings.min_severity}
          onChange={e => setSettings(s => ({ ...s, min_severity: e.target.value }))}
          className="text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        >
          {SEVERITY_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {msg && (
        <p className={`text-sm ${msg.type === 'success' ? 'text-portal-success' : 'text-portal-danger'}`}>
          {msg.text}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="btn-primary"
      >
        {saving ? 'Speichert…' : 'Einstellungen speichern'}
      </button>
    </form>
  )
}
