// p3portal.org
import { Suspense, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createSnapshot, rollbackSnapshot, deleteSnapshot } from '../../api/vms'
import ConfirmModal from '../common/ConfirmModal'
import { useDependencyImpactGuard } from './useDependencyImpactGuard'
// PROJ-77: Auto-Badge für p3auto_*-Snapshots (Plus-only Bulk-Lookup via Registry)
import { PlusComponents } from '../../plus'
import { useCapability } from '../../hooks/useCapability'

function SnapshotList({ snapshots, fmtTime, isOperator, isTemplate, busy, setConfirmTarget, autoLookup }) {
  return (
    <div className="divide-y divide-gray-100 dark:divide-zinc-800 border border-gray-200 dark:border-zinc-700 rounded overflow-hidden flex-1">
      {snapshots.map((snap) => {
        const isAuto = snap.name?.startsWith('p3auto_')
        const jobId = isAuto ? autoLookup[snap.name] : null
        return (
          <div key={snap.name} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-gray-900 dark:text-white font-mono truncate">
                {snap.name}
                {isAuto && <InlineAutoBadge jobId={jobId} />}
              </p>
              <p className="text-xs text-gray-400 dark:text-zinc-600">
                {fmtTime(snap.snaptime)}
                {snap.description ? ` · ${snap.description}` : ''}
              </p>
            </div>

            {isOperator && !isTemplate && (
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => setConfirmTarget({ type: 'rollback', name: snap.name })}
                  disabled={busy != null}
                  className="btn-table"
                >
                  {busy === `rollback:${snap.name}` ? '…' : 'Rollback'}
                </button>
                <button
                  onClick={() => setConfirmTarget({ type: 'delete', name: snap.name })}
                  disabled={busy != null}
                  className="btn-table-danger"
                >
                  {busy === `delete:${snap.name}` ? '…' : 'Löschen'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InlineAutoBadge({ jobId }) {
  const navigate = useNavigate()
  if (!jobId) return null
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigate(`/automation?tab=scheduled&openJob=${jobId}`) }}
      title="Erstellt durch geplanten Job"
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-portal-info/10 text-portal-info border border-portal-info/30 hover:bg-portal-info/20 transition-colors ml-1"
    >
      auto
    </button>
  )
}

const SNAP_NAME_RE = /^[a-zA-Z0-9_-]{1,40}$/

function fmtTime(ts) {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 409) return 'Ein Snapshot mit diesem Namen existiert bereits.'
  if (s === 422) return 'Ungültiger Snapshot-Name.'
  if (s === 503) return 'Service-Account nicht konfiguriert.'
  if (s === 400) return d ?? 'Rollback nicht möglich (VM läuft?).'
  return d ?? 'Fehler beim Ausführen der Aktion.'
}

export default function VmSnapshotSection({ vmid, node, snapshots, isOperator, isTemplate, onReload, portalNodeId, kind }) {
  const hasAutoSnapshots = useCapability('auto_snapshots')
  const NativeSnapshotBadgeMap = PlusComponents.NativeSnapshotBadgeMap
  const [form, setForm]           = useState({ name: '', description: '' })
  const [nameError, setNameError] = useState('')
  const [creating, setCreating]   = useState(false)
  const [busy, setBusy]                 = useState(null)   // 'rollback:name' | 'delete:name'
  const [confirmTarget, setConfirmTarget] = useState(null) // { type: 'rollback'|'delete', name: string }
  const [actionErr, setActionErr]       = useState('')
  const [showForm, setShowForm]         = useState(false)
  const { guardedRun, impactModal }     = useDependencyImpactGuard()  // PROJ-96

  const handleCreate = async (e) => {
    e.preventDefault()
    setNameError('')
    if (!SNAP_NAME_RE.test(form.name)) {
      setNameError('Nur a–z, A–Z, 0–9, _ und - erlaubt (max. 40 Zeichen).')
      return
    }
    setCreating(true)
    try {
      await createSnapshot(vmid, form.name, form.description, node)
      setForm({ name: '', description: '' })
      setShowForm(false)
      await onReload()
    } catch (err) {
      setNameError(errMsg(err))
    } finally {
      setCreating(false)
    }
  }

  const doAction = async (type, name) => {
    setBusy(`${type}:${name}`)
    setActionErr('')
    try {
      // PROJ-96: Rollback durchläuft die Abhängigkeits-Impact-Warnung.
      if (type === 'rollback') await guardedRun((confirm) => rollbackSnapshot(vmid, name, node, { confirm }), 'Rollback')
      if (type === 'delete')   await deleteSnapshot(vmid, name, node)
      await onReload()
    } catch (err) {
      if (err?.cancelled) { setBusy(null); return }
      setActionErr(errMsg(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4 flex flex-col">

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
          Snapshots {snapshots != null ? `(${snapshots.length})` : ''}
        </h2>
        {isOperator && !isTemplate && (
          <button
            onClick={() => { setShowForm(f => !f); setNameError('') }}
            className="btn-primary"
          >
            {showForm ? '✕ Abbrechen' : '+ Snapshot'}
          </button>
        )}
      </div>

      {actionErr && (
        <div className="mb-3 text-xs text-red-400 bg-red-950/40 border border-red-800 px-3 py-2 rounded">
          {actionErr}
          <button onClick={() => setActionErr('')} className="btn-ghost ml-2">✕</button>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleCreate} className="mb-4 space-y-2 border border-gray-100 dark:border-zinc-800 rounded p-3 bg-gray-50 dark:bg-zinc-950/40">
          <div>
            <input
              type="text"
              placeholder="snapshot-name"
              value={form.name}
              onChange={(e) => { setNameError(''); setForm(f => ({ ...f, name: e.target.value })) }}
              className="w-full bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 font-mono rounded"
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
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
            className="w-full bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 rounded"
          />
          <button
            type="submit"
            disabled={creating || !form.name}
            className="btn-primary w-full text-xs py-1.5"
          >
            {creating ? 'Erstelle…' : 'Snapshot erstellen'}
          </button>
        </form>
      )}

      {/* Snapshot list */}
      {snapshots == null ? (
        <div className="space-y-2">
          {[1, 2].map(i => <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />)}
        </div>
      ) : snapshots.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-zinc-600">Keine Snapshots vorhanden.</p>
      ) : hasAutoSnapshots && NativeSnapshotBadgeMap && portalNodeId && kind ? (
        <Suspense fallback={<SnapshotList snapshots={snapshots} fmtTime={fmtTime} isOperator={isOperator} isTemplate={isTemplate} busy={busy} setConfirmTarget={setConfirmTarget} autoLookup={{}} />}>
          <NativeSnapshotBadgeMap
            portalNodeId={portalNodeId}
            proxmoxNode={node}
            vmid={vmid}
            kind={kind}
          >
            {(lookup) => (
              <SnapshotList
                snapshots={snapshots}
                fmtTime={fmtTime}
                isOperator={isOperator}
                isTemplate={isTemplate}
                busy={busy}
                setConfirmTarget={setConfirmTarget}
                autoLookup={lookup}
              />
            )}
          </NativeSnapshotBadgeMap>
        </Suspense>
      ) : (
        <SnapshotList snapshots={snapshots} fmtTime={fmtTime} isOperator={isOperator} isTemplate={isTemplate} busy={busy} setConfirmTarget={setConfirmTarget} autoLookup={{}} />
      )}

      {impactModal /* PROJ-96: Abhängigkeits-Impact-Dialog beim Rollback */}

      {confirmTarget && (
        <ConfirmModal
          title={confirmTarget.type === 'delete' ? 'Snapshot löschen' : 'Rollback durchführen'}
          body={confirmTarget.type === 'delete'
            ? `Snapshot „${confirmTarget.name}" wirklich löschen?`
            : `Rollback auf Snapshot „${confirmTarget.name}"? Die aktuelle VM-Konfiguration wird überschrieben.`}
          confirmLabel={confirmTarget.type === 'delete' ? 'Löschen' : 'Rollback'}
          variant={confirmTarget.type === 'delete' ? 'danger' : 'primary'}
          onConfirm={async () => {
            const { type, name } = confirmTarget
            setConfirmTarget(null)
            await doAction(type, name)
          }}
          onClose={() => setConfirmTarget(null)}
        />
      )}
    </div>
  )
}
