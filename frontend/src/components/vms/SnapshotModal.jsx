// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { getSnapshots, createSnapshot, rollbackSnapshot, deleteSnapshot } from '../../api/vms'
import ConfirmModal from '../common/ConfirmModal'
import { useDependencyImpactGuard } from './useDependencyImpactGuard'

const SNAP_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

function fmtTime(ts) {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function errMsg(err) {
  const s = err.response?.status
  const d = err.response?.data?.detail
  if (s === 409) return 'Ein Snapshot mit diesem Namen existiert bereits.'
  if (s === 422) return 'Ungültiger Snapshot-Name.'
  if (s === 503) return 'Service-Account nicht konfiguriert.'
  return d ?? 'Fehler beim Ausführen der Aktion.'
}

export default function SnapshotModal({ vm, onClose }) {
  const [snapshots, setSnapshots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', description: '' })
  const [nameError, setNameError] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(null)          // `rollback:name` | `delete:name`
  const [confirm, setConfirm] = useState(null)    // { type, name }
  const { guardedRun, impactModal } = useDependencyImpactGuard()  // PROJ-96

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setSnapshots(await getSnapshots(vm.vmid, vm.node))
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Snapshots konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [vm.vmid, vm.node])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setNameError('')
    if (!SNAP_NAME_RE.test(form.name)) {
      setNameError('Nur Buchstaben, Zahlen, _ und - erlaubt (max. 40 Zeichen).')
      return
    }
    setCreating(true)
    try {
      await createSnapshot(vm.vmid, form.name, form.description, vm.node)
      setForm({ name: '', description: '' })
      await load()
    } catch (err) {
      setNameError(errMsg(err))
    } finally {
      setCreating(false)
    }
  }

  const doAction = async (type, name) => {
    setBusy(`${type}:${name}`)
    setError('')
    setConfirm(null)
    try {
      // PROJ-96: Rollback durchläuft die Abhängigkeits-Impact-Warnung.
      if (type === 'rollback') await guardedRun((confirmFlag) => rollbackSnapshot(vm.vmid, name, vm.node, { confirm: confirmFlag }), 'Rollback')
      if (type === 'delete')   await deleteSnapshot(vm.vmid, name, vm.node)
      await load()
    } catch (err) {
      if (err?.cancelled) { setBusy(null); return }
      setError(errMsg(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Snapshots – VM {vm.vmid}
            </h2>
            {vm.name && (
              <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">{vm.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-5">

          {error && (
            <p className="text-sm text-red-400 bg-red-950/40 border border-red-800 px-3 py-2">{error}</p>
          )}

          {/* Snapshot list */}
          <div>
            <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-2">
              Vorhandene Snapshots
            </h3>

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="h-12 bg-gray-100 dark:bg-zinc-800 animate-pulse" />
                ))}
              </div>
            ) : snapshots.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-zinc-500">Keine Snapshots vorhanden.</p>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-zinc-700/50 border border-gray-200 dark:border-zinc-700">
                {snapshots.map((snap) => (
                  <div key={snap.name} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-zinc-900">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 dark:text-white font-mono truncate">{snap.name}</p>
                      <p className="text-xs text-gray-500 dark:text-zinc-500">
                        {fmtTime(snap.snaptime)}
                        {snap.description ? ` · ${snap.description}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => setConfirm({ type: 'rollback', name: snap.name })}
                        disabled={busy != null}
                        className="btn-table"
                      >
                        {busy === `rollback:${snap.name}` ? '…' : 'Rollback'}
                      </button>
                      <button
                        onClick={() => setConfirm({ type: 'delete', name: snap.name })}
                        disabled={busy != null}
                        className="btn-table-danger"
                      >
                        {busy === `delete:${snap.name}` ? '…' : 'Löschen'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create snapshot form */}
          <div>
            <h3 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-3">
              Neuer Snapshot
            </h3>
            <form onSubmit={handleCreate} className="space-y-2.5">
              <div>
                <input
                  type="text"
                  placeholder="snapshot-name"
                  value={form.name}
                  onChange={(e) => { setNameError(''); setForm((f) => ({ ...f, name: e.target.value })) }}
                  className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 font-mono"
                />
                {nameError
                  ? <p className="mt-1 text-xs text-red-400">{nameError}</p>
                  : <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">Buchstaben, Zahlen, _ und - · max. 40 Zeichen</p>
                }
              </div>
              <input
                type="text"
                placeholder="Beschreibung (optional)"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
              />
              <button
                type="submit"
                disabled={creating || !form.name}
                className="btn-primary w-full"
              >
                {creating ? 'Erstelle Snapshot…' : 'Snapshot erstellen'}
              </button>
            </form>
          </div>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>

    {impactModal /* PROJ-96: Abhängigkeits-Impact-Dialog beim Rollback */}

    {confirm && (
      <ConfirmModal
        title={confirm.type === 'rollback' ? `Rollback auf „${confirm.name}"?` : `Snapshot „${confirm.name}" löschen?`}
        body={confirm.type === 'rollback'
          ? `Der aktuelle Zustand der VM wird auf den Snapshot „${confirm.name}" zurückgesetzt.`
          : `Snapshot „${confirm.name}" wird unwiderruflich gelöscht.`}
        confirmLabel={confirm.type === 'rollback' ? 'Rollback' : 'Löschen'}
        variant={confirm.type === 'delete' ? 'danger' : 'primary'}
        onConfirm={() => doAction(confirm.type, confirm.name)}
        onClose={() => setConfirm(null)}
      />
    )}
    </>
  )
}
