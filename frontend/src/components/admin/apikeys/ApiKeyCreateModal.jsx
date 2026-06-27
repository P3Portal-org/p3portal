// p3portal.org
import { useState } from 'react'
import { createApiKey } from '../../../api/apikeys'
import ModalHelpButton from '../../../features/help/components/ModalHelpButton'

const ALL_SCOPES = [
  { id: 'jobs:start',   label: 'jobs:start',   desc: 'Ansible-Playbook-Jobs starten' },
  { id: 'jobs:read',    label: 'jobs:read',     desc: 'Job-Status und Logs lesen' },
  { id: 'cluster:read', label: 'cluster:read',  desc: 'Cluster-Status (Nodes, VMs) lesen' },
  { id: 'packer:start', label: 'packer:start',  desc: 'Packer-Builds starten' },
]

const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent focus:border-transparent'

export default function ApiKeyCreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '',
    description: '',
    expires_at: '',
    noExpiry: true,
    scopes: [],
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  const toggleScope = (scope) => {
    set('scopes', form.scopes.includes(scope)
      ? form.scopes.filter((s) => s !== scope)
      : [...form.scopes, scope]
    )
  }

  const canSubmit = form.name.trim() && form.scopes.length > 0

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        scopes: form.scopes,
        expires_at: (!form.noExpiry && form.expires_at) ? new Date(form.expires_at).toISOString() : null,
      }
      const result = await createApiKey(payload)
      onCreated(result)
    } catch (ex) {
      setError(ex.response?.data?.detail ?? 'Key konnte nicht erstellt werden.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Neuen API-Key erstellen</h2>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.api_key_create" />
            <button onClick={onClose} className="btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Name <span className="text-portal-danger">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputCls}
              placeholder="z.B. iTop-Integration"
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
              Beschreibung
            </label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className={inputCls}
              placeholder="Optional"
            />
          </div>

          {/* Scopes */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">
              Scopes <span className="text-portal-danger">*</span>
            </label>
            <div className="space-y-2">
              {ALL_SCOPES.map(({ id, label, desc }) => (
                <label key={id} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={form.scopes.includes(id)}
                    onChange={() => toggleScope(id)}
                    className="mt-0.5 h-4 w-4 rounded border-zinc-300 text-portal-accent focus:ring-portal-accent"
                  />
                  <div>
                    <span className="text-sm font-mono text-zinc-800 dark:text-zinc-200">{label}</span>
                    <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{desc}</span>
                  </div>
                </label>
              ))}
            </div>
            {form.scopes.length === 0 && (
              <p className="text-xs text-portal-danger mt-1">Mindestens ein Scope erforderlich.</p>
            )}
          </div>

          {/* Expiry */}
          <div>
            <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-2">Ablauf</label>
            <label className="flex items-center gap-2 cursor-pointer mb-2">
              <input
                type="checkbox"
                checked={form.noExpiry}
                onChange={(e) => set('noExpiry', e.target.checked)}
                className="h-4 w-4 rounded border-zinc-300 text-portal-accent focus:ring-portal-accent"
              />
              <span className="text-sm text-zinc-700 dark:text-zinc-300">Kein Ablaufdatum</span>
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
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={!canSubmit || busy}
              className="btn-primary"
            >
              {busy ? 'Erstelle…' : 'Key erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
