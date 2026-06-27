// p3portal.org
import { useState, useEffect } from 'react'
import TestWebhookButton, {
  WEBHOOK_RECEIVERS,
  WEBHOOK_URL_LABELS,
  WEBHOOK_URL_PLACEHOLDERS,
  WEBHOOK_TOKEN_LABELS,
  WEBHOOK_TOKEN_PLACEHOLDERS,
  WEBHOOK_TOKEN_IN_URL,
} from '../common/TestWebhookButton'

const METRIC_OPTIONS = [
  { value: 'cpu_percent', label: 'CPU (%)' },
  { value: 'mem_percent', label: 'RAM (%)' },
  { value: 'disk_percent', label: 'Disk (%)' },
  { value: 'status', label: 'VM-Status (gestoppt)' },
]

const EMPTY = {
  name: '',
  metric: 'cpu_percent',
  warning_threshold: '',
  critical_threshold: '',
  sustained_polls: 1,
  enabled: true,
  notify_recovery: true,
  filesystem: '',
  webhook_url: '',
  webhook_token: '',
  webhook_receiver_type: 'custom',
  email_recipients: '',
}

function field(label, children, hint) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">{hint}</p>}
    </div>
  )
}

const inputCls = "w-full text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-portal-accent"
const checkCls = "w-4 h-4 rounded border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent focus:ring-offset-0 bg-white dark:bg-zinc-800"

export default function AlertRuleFormModal({ rule, onSave, onClose, loading, error, plusEnabled }) {
  const [form, setForm] = useState(EMPTY)

  useEffect(() => {
    if (rule) {
      setForm({
        name: rule.name ?? '',
        metric: rule.metric ?? 'cpu_percent',
        warning_threshold: rule.warning_threshold ?? '',
        critical_threshold: rule.critical_threshold ?? '',
        sustained_polls: rule.sustained_polls ?? 1,
        enabled: rule.enabled ?? true,
        notify_recovery: rule.notify_recovery ?? true,
        filesystem: rule.filesystem ?? '',
        webhook_url: rule.webhook_url ?? '',
        webhook_token: rule.webhook_token ?? '',
        webhook_receiver_type: rule.webhook_receiver_type ?? 'custom',
        email_recipients: rule.email_recipients ?? '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [rule])

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))

  const handleSubmit = (e) => {
    e.preventDefault()
    const payload = {
      name: form.name.trim(),
      metric: form.metric,
      warning_threshold: form.metric === 'status' ? null : (form.warning_threshold !== '' ? Number(form.warning_threshold) : null),
      critical_threshold: form.metric === 'status' ? 1 : (form.critical_threshold !== '' ? Number(form.critical_threshold) : null),
      sustained_polls: Number(form.sustained_polls) || 1,
      enabled: form.enabled,
      notify_recovery: form.notify_recovery,
      filesystem: form.metric === 'disk_percent' && form.filesystem.trim() ? form.filesystem.trim() : null,
      webhook_url: plusEnabled && form.webhook_url.trim() ? form.webhook_url.trim() : null,
      webhook_token: plusEnabled && form.webhook_token.trim() ? form.webhook_token.trim() : null,
      webhook_receiver_type: form.webhook_receiver_type || 'custom',
      email_recipients: plusEnabled && form.email_recipients.trim() ? form.email_recipients.trim() : null,
    }
    onSave(payload)
  }

  const isStatus = form.metric === 'status'
  const isDisk = form.metric === 'disk_percent'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            {rule ? 'Regel bearbeiten' : 'Neue Regel erstellen'}
          </h2>
          <button onClick={onClose} className="btn-ghost transition-colors">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger rounded">
              {error}
            </div>
          )}

          {field('Name', (
            <input
              className={inputCls}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="z. B. CPU-Auslastung hoch"
              required
            />
          ))}

          {field('Metrik', (
            <select className={inputCls} value={form.metric} onChange={e => set('metric', e.target.value)}>
              {METRIC_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ))}

          {isDisk && field('Dateisystem (optional)', (
            <input
              className={inputCls}
              value={form.filesystem}
              onChange={e => set('filesystem', e.target.value)}
              placeholder="z. B. / oder /data (leer = alle)"
            />
          ))}

          {!isStatus && (
            <div className="grid grid-cols-2 gap-3">
              {field('Warnung (%)', (
                <input
                  type="number"
                  className={inputCls}
                  value={form.warning_threshold}
                  onChange={e => set('warning_threshold', e.target.value)}
                  min={0} max={100} step={0.1}
                  placeholder="z. B. 80"
                />
              ))}
              {field('Kritisch (%)', (
                <input
                  type="number"
                  className={inputCls}
                  value={form.critical_threshold}
                  onChange={e => set('critical_threshold', e.target.value)}
                  min={0} max={100} step={0.1}
                  placeholder="z. B. 95"
                  required={isStatus}
                />
              ))}
            </div>
          )}

          {isStatus && field('Kritischer Status-Schwellwert', (
            <input
              type="number"
              className={inputCls}
              value={form.critical_threshold}
              onChange={e => set('critical_threshold', e.target.value)}
              placeholder="(ignoriert – löst bei 'gestoppt' aus)"
              disabled
            />
          ))}

          {field('Auslösung nach N Polls (sustained)', (
            <input
              type="number"
              className={inputCls}
              value={form.sustained_polls}
              onChange={e => set('sustained_polls', e.target.value)}
              min={1} max={100}
            />
          ), 'Wie viele aufeinanderfolgende Messungen den Schwellwert überschreiten müssen.')}

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
              <input type="checkbox" className={checkCls} checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />
              Regel aktiv
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
              <input type="checkbox" className={checkCls} checked={form.notify_recovery} onChange={e => set('notify_recovery', e.target.checked)} />
              Recovery benachrichtigen
            </label>
          </div>

          {plusEnabled && (
            <div className="border-t border-gray-100 dark:border-zinc-800 pt-4 space-y-4">
              <p className="text-xs font-semibold text-portal-accent uppercase tracking-wide">Plus – Benachrichtigungen</p>
              {field('Empfänger', (
                <select
                  className={inputCls}
                  value={form.webhook_receiver_type}
                  onChange={e => set('webhook_receiver_type', e.target.value)}
                >
                  {WEBHOOK_RECEIVERS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              ))}
              {field(
                WEBHOOK_URL_LABELS[form.webhook_receiver_type] ?? 'Webhook-URL',
                <>
                  <input
                    className={inputCls}
                    value={form.webhook_url}
                    onChange={e => set('webhook_url', e.target.value)}
                    placeholder={WEBHOOK_URL_PLACEHOLDERS[form.webhook_receiver_type] ?? 'https://...'}
                    type="url"
                  />
                  {form.webhook_receiver_type === 'gotify' && form.webhook_url && (
                    <p className="mt-1 text-xs text-portal-info">
                      Sendet an: <code>{form.webhook_url.replace(/\/$/, '')}/message?token=…</code>
                    </p>
                  )}
                </>
              )}
              {WEBHOOK_TOKEN_IN_URL.includes(form.webhook_receiver_type) ? (
                <p className="text-xs text-portal-info">
                  Token ist in der Webhook-URL enthalten – kein separates Token-Feld nötig.
                </p>
              ) : field(
                WEBHOOK_TOKEN_LABELS[form.webhook_receiver_type] ?? 'Token (optional)',
                <input
                  className={inputCls}
                  value={form.webhook_token}
                  onChange={e => set('webhook_token', e.target.value)}
                  placeholder={WEBHOOK_TOKEN_PLACEHOLDERS[form.webhook_receiver_type] ?? ''}
                  type="password"
                />
              )}
              <TestWebhookButton
                url={form.webhook_url}
                token={form.webhook_token}
                receiverType={form.webhook_receiver_type}
                ruleId={rule?.id ?? null}
              />
              {field('E-Mail-Empfänger', (
                <input
                  className={inputCls}
                  value={form.email_recipients}
                  onChange={e => set('email_recipients', e.target.value)}
                  placeholder="a@x.de, b@x.de"
                />
              ), 'Kommagetrennte Adressen.')}
            </div>
          )}
        </form>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="btn-primary"
          >
            {loading ? 'Speichern…' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  )
}
