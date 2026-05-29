// p3portal.org
import { useState, useEffect } from 'react'
import { createPreset, updatePreset } from '../../../api/rbac'

const ALL_ACTIONS = [
  { id: 'view',      label: 'Anzeigen',      group: 'basis' },
  { id: 'start',     label: 'Starten',       group: 'betrieb' },
  { id: 'stop',      label: 'Stoppen',       group: 'betrieb' },
  { id: 'reboot',    label: 'Neustarten',    group: 'betrieb' },
  { id: 'snapshot',  label: 'Snapshots',     group: 'betrieb' },
  { id: 'configure', label: 'Konfigurieren', group: 'admin' },
  { id: 'delete',    label: 'Löschen',       group: 'admin' },
  { id: 'clone',     label: 'Klonen',        group: 'admin' },
]

const ALL_NODE_ACTIONS = [
  { id: 'node:view_tasks',      label: 'Aufgaben/Events ansehen' },
  { id: 'node:view_backups',    label: 'Backups ansehen' },
  { id: 'node:upload_iso',      label: 'ISO hochladen' },
  { id: 'node:view_updates',    label: 'Update-Liste ansehen' },
  { id: 'node:refresh_updates', label: 'Update-Liste aktualisieren' },
]

const GROUP_LABELS = { basis: 'Basis', betrieb: 'Betrieb', admin: 'Admin' }

const inputCls =
  'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 transition'

export default function PresetForm({ preset, onSuccess, onCancel }) {
  const isEdit = !!preset
  const [form, setForm] = useState({ name: '', description: '' })
  const [permissions, setPermissions] = useState([])
  const [nodeActions, setNodeActions] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (preset) {
      setForm({ name: preset.name, description: preset.description ?? '' })
      setPermissions(preset.permissions ?? [])
      setNodeActions(preset.node_actions ?? [])
    } else {
      setForm({ name: '', description: '' })
      setPermissions([])
      setNodeActions([])
    }
  }, [preset])

  const toggleAction = (id) => {
    setPermissions((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    )
  }

  const toggleNodeAction = (id) => {
    setNodeActions((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (permissions.length === 0 && nodeActions.length === 0) {
      setError('Mindestens eine VM- oder Node-Aktion muss ausgewählt sein.')
      return
    }
    setLoading(true)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        permissions,
        node_actions: nodeActions,
      }
      if (isEdit) {
        await updatePreset(preset.id, payload)
      } else {
        await createPreset(payload)
      }
      onSuccess()
    } catch (err) {
      const detail = err.response?.data?.detail
      if (err.response?.status === 422) {
        const msg = Array.isArray(detail)
          ? detail.map((d) => d.msg).join(', ')
          : (detail ?? 'Ungültige Eingabe.')
        setError(msg)
      } else {
        setError(detail ?? 'Fehler beim Speichern.')
      }
    } finally {
      setLoading(false)
    }
  }

  const groups = [...new Set(ALL_ACTIONS.map((a) => a.group))]

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
          Name
        </label>
        <input
          type="text"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="z.B. VM Betreiber"
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5">
          Beschreibung (optional)
        </label>
        <input
          type="text"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Kurze Beschreibung des Presets"
          className={inputCls}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
          Erlaubte Aktionen
        </label>
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group}>
              <p className="text-xs text-gray-400 dark:text-zinc-600 uppercase tracking-wider mb-1.5">
                {GROUP_LABELS[group]}
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_ACTIONS.filter((a) => a.group === group).map((action) => {
                  const active = permissions.includes(action.id)
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => toggleAction(action.id)}
                      className={`text-xs px-3 py-1.5 border transition-colors ${
                        active
                          ? 'bg-orange-600 border-orange-600 text-white'
                          : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:border-orange-400 dark:hover:border-orange-600 hover:text-orange-600 dark:hover:text-orange-400'
                      }`}
                    >
                      {action.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Node-Aktionen (PROJ-47) */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <label className="block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
            Node-Aktionen
          </label>
          <span className="text-xs text-gray-400 dark:text-zinc-500">(nur für Node-Scope-Zuweisungen)</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {ALL_NODE_ACTIONS.map((action) => {
            const active = nodeActions.includes(action.id)
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => toggleNodeAction(action.id)}
                className={`text-xs px-3 py-1.5 border transition-colors ${
                  active
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:border-blue-400 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400'
                }`}
              >
                {action.label}
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-400 bg-red-950/40 border border-red-800 px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={loading}
          className="btn-primary flex-1"
        >
          {loading ? 'Speichern…' : isEdit ? 'Änderungen speichern' : 'Preset anlegen'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-secondary"
        >
          Abbrechen
        </button>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </form>
  )
}
