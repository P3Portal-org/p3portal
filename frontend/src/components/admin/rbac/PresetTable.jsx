// p3portal.org
import { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchPresets, deletePreset } from '../../../api/rbac'
import PresetForm from './PresetForm'
import ConfirmModal from '../../common/ConfirmModal'
import { useLicenseLimits } from '../../../hooks/useLicenseLimits'

const ACTION_LABELS = {
  view: 'Anzeigen', start: 'Starten', stop: 'Stoppen', reboot: 'Neustarten',
  snapshot: 'Snapshots', configure: 'Konfigurieren', delete: 'Löschen', clone: 'Klonen',
}

const NODE_ACTION_LABELS = {
  'node:view_tasks':      'Events',
  'node:view_backups':    'Backups',
  'node:upload_iso':      'ISO-Upload',
  'node:view_updates':    'Updates ansehen',
  'node:refresh_updates': 'Updates aktualisieren',
}

function ActionPill({ action }) {
  return (
    <span className="inline-block text-xs bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5 mr-1 mb-0.5">
      {ACTION_LABELS[action] ?? action}
    </span>
  )
}

function NodeActionPill({ action }) {
  return (
    <span className="inline-block text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 px-1.5 py-0.5 mr-1 mb-0.5 rounded">
      {NODE_ACTION_LABELS[action] ?? action}
    </span>
  )
}

export default function PresetTable() {
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const [panel, setPanel] = useState(null) // null | 'create' | preset-object
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null) // null | preset-Objekt
  const [inUseError, setInUseError]     = useState('')
  const { presetLimit, presetAtLimit, reload: reloadLimits } = useLicenseLimits()

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return presets
    return presets.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.description ?? '').toLowerCase().includes(q)
    )
  }, [presets, search])

  const load = useCallback(async () => {
    setFetchError('')
    try {
      const data = await fetchPresets()
      setPresets(data)
    } catch {
      setFetchError('Presets konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSuccess = () => {
    setPanel(null)
    load()
    reloadLimits()
  }

  useEffect(() => {
    if (panel === null) return
    const onKey = (e) => { if (e.key === 'Escape') setPanel(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])

  const handleDeleteClick = (p) => {
    setInUseError('')
    if (p.assignment_count > 0) {
      setInUseError(`Preset „${p.name}" wird noch von ${p.assignment_count} Zuweisung(en) verwendet. Bitte zuerst alle Zuweisungen entfernen.`)
      return
    }
    setDeleteTarget(p)
  }

  const executeDelete = async () => {
    try {
      await deletePreset(deleteTarget.id)
      setDeleteTarget(null)
      load()
      reloadLimits()
    } catch (err) {
      const s = err.response?.status
      const d = err.response?.data?.detail
      throw new Error(s === 409 ? d : (d ?? 'Fehler beim Löschen.'))
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-gray-500 dark:text-zinc-500">
          Wiederverwendbare Berechtigungs-Vorlagen für VM/LXC-Zuweisungen.
        </p>
        <div className="relative group">
          <button
            onClick={() => !presetAtLimit && setPanel('create')}
            disabled={presetAtLimit}
            className="btn-primary flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Preset anlegen
          </button>
          {presetAtLimit && (
            <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block w-52 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2.5 py-1.5 shadow-lg pointer-events-none">
              Limit erreicht – Upgrade auf P3 Plus
            </div>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Preset suchen…"
          className="w-full text-xs px-2.5 py-1.5 border border-gray-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
      </div>

      {/* In-Use-Error Banner */}
      {inUseError && (
        <div className="mb-3 text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded px-3 py-2 flex items-center justify-between">
          <span>{inUseError}</span>
          <button onClick={() => setInUseError('')} className="btn-ghost ml-2">✕</button>
        </div>
      )}

      {/* Create / Edit Modal */}
      {panel !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {panel === 'create' ? 'Neues Preset' : `Preset bearbeiten – ${panel.name}`}
                </h2>
                {panel === 'create' && presetLimit && !presetLimit.unlimited && (
                  <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                    presetAtLimit
                      ? 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                      : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
                  }`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 shrink-0">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {presetLimit.current} / {presetLimit.max} Presets
                  </span>
                )}
              </div>
              <button onClick={() => setPanel(null)} className="btn-ghost">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="p-6">
              <PresetForm
                preset={panel === 'create' ? null : panel}
                onSuccess={handleSuccess}
                onCancel={() => setPanel(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-zinc-500 py-8 text-center">Lade Presets…</p>
        ) : fetchError ? (
          <p className="text-sm text-red-400 py-8 text-center">{fetchError}</p>
        ) : presets.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-zinc-500 py-8 text-center">
            Noch keine Presets angelegt.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-zinc-500 py-8 text-center">
            Keine Presets gefunden.
          </p>
        ) : (
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700 text-xs text-gray-500 dark:text-zinc-500 uppercase tracking-wider bg-gray-50 dark:bg-zinc-900">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Beschreibung</th>
                <th className="px-4 py-2.5">Aktionen</th>
                <th className="px-4 py-2.5 text-center">Zuweisungen</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-700/50">
              {filtered.map((p) => (
                <tr key={p.id} className="bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{p.name}</td>
                  <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 text-xs">{p.description || '–'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap">
                      {p.permissions.map((a) => <ActionPill key={a} action={a} />)}
                    </div>
                    {p.node_actions?.length > 0 && (
                      <div className="flex flex-wrap mt-1">
                        {p.node_actions.map((a) => <NodeActionPill key={a} action={a} />)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 ${
                      p.assignment_count > 0
                        ? 'bg-orange-100 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400'
                        : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
                    }`}>
                      {p.assignment_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setPanel(p)}
                        className="btn-table"
                      >
                        Bearbeiten
                      </button>
                      <button
                        onClick={() => handleDeleteClick(p)}
                        className="btn-table-danger"
                      >
                        Löschen
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="Preset löschen"
          body={`Preset „${deleteTarget.name}" wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.`}
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={executeDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
