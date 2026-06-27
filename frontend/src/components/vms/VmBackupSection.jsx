// p3portal.org
import { useState } from 'react'
import { deleteVmBackup } from '../../api/vms'
import BackupCreateModal from './BackupCreateModal'
import ConfirmModal from '../common/ConfirmModal'

function fmtBytes(bytes) {
  if (!bytes) return '–'
  const gb = bytes / (1024 ** 3)
  if (gb >= 1) return `${gb.toFixed(2)} GB`
  const mb = bytes / (1024 ** 2)
  return `${mb.toFixed(0)} MB`
}

function fmtDate(ts) {
  if (!ts) return '–'
  return new Date(ts * 1000).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Keine Berechtigung zum Löschen von Backups.'
  if (s === 503) return 'Service-Account nicht konfiguriert.'
  if (s === 404) return 'Backup nicht gefunden.'
  return d ?? 'Fehler beim Löschen des Backups.'
}

export default function VmBackupSection({ node, vmType, vmid, backupsData, backupsErr, isOperator, isTemplate, onReload }) {
  const [deleteBusy, setDeleteBusy]     = useState(null)   // volid being deleted
  const [deleteTarget, setDeleteTarget] = useState(null)   // backup object to confirm
  const [actionErr, setActionErr]       = useState('')
  const [showModal, setShowModal]       = useState(false)

  const backups   = backupsData?.backups   ?? []
  const schedules = backupsData?.schedules ?? []
  const storages  = backupsData?.storages  ?? []

  const handleDelete = async (backup) => {
    setDeleteBusy(backup.volid)
    setActionErr('')
    try {
      await deleteVmBackup(node, vmType, vmid, backup.volid, backup.storage)
      await onReload()
    } catch (err) {
      setActionErr(errMsg(err))
    } finally {
      setDeleteBusy(null)
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4 flex flex-col">

      {/* Backups header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
          Backups {backupsData ? `(${backups.length})` : ''}
        </h2>
        {isOperator && !isTemplate && (
          <button
            onClick={() => setShowModal(true)}
            className="btn-primary"
          >
            + Backup erstellen
          </button>
        )}
      </div>

      {actionErr && (
        <div className="mb-3 text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">
          {actionErr}
          <button onClick={() => setActionErr('')} className="btn-ghost ml-2">✕</button>
        </div>
      )}

      {/* Backup file list */}
      {backupsErr ? (
        <p className="text-xs text-portal-warn mb-3">
          Backups konnten nicht geladen werden.
        </p>
      ) : backupsData == null ? (
        <div className="space-y-2 mb-4">
          {[1, 2].map(i => <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />)}
        </div>
      ) : backups.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-zinc-600 mb-4">Keine Backups gefunden.</p>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-zinc-800 border border-gray-200 dark:border-zinc-700 rounded overflow-hidden mb-4">
          {backups.map((bk) => (
            <div key={bk.volid} className="flex items-center gap-3 px-3 py-2.5 bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
              <div className="min-w-0 flex-1">
                <p
                  className="text-xs text-gray-700 dark:text-zinc-300 font-mono truncate"
                  title={bk.filename}
                >
                  {bk.filename}
                </p>
                <p className="text-xs text-gray-400 dark:text-zinc-600">
                  {fmtDate(bk.created_at)} · {fmtBytes(bk.size)} · {bk.storage}
                </p>
              </div>

              {isOperator && (
                <button
                  onClick={() => setDeleteTarget(bk)}
                  disabled={deleteBusy != null}
                  className="btn-table-danger shrink-0"
                >
                  {deleteBusy === bk.volid ? '…' : 'Löschen'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Datacenter backup schedules */}
      {backupsData != null && (
        <>
          <h3 className="text-xs font-medium text-gray-400 dark:text-zinc-600 uppercase tracking-wider mb-2">
            Backup-Jobs ({schedules.length})
          </h3>
          {schedules.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-zinc-600">
              Keine Datacenter-Backup-Jobs für diese VM.
            </p>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-zinc-800 border border-gray-200 dark:border-zinc-700 rounded overflow-hidden">
              {schedules.map((job) => (
                <div key={job.id} className="px-3 py-2.5 bg-white dark:bg-zinc-900">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-gray-700 dark:text-zinc-300 font-mono">{job.schedule || '–'}</span>
                    <span className={`text-xs ${job.enabled ? 'text-portal-success' : 'text-gray-400 dark:text-zinc-600'}`}>
                      {job.enabled ? 'aktiv' : 'inaktiv'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 dark:text-zinc-600">
                    {job.storage}{job.mode ? ` · ${job.mode}` : ''}{job.compress && job.compress !== '0' ? ` · ${job.compress}` : ''}
                    {job.comment ? ` · ${job.comment}` : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Backup create modal */}
      {showModal && (
        <BackupCreateModal
          node={node}
          vmType={vmType}
          vmid={vmid}
          storages={storages}
          onClose={() => setShowModal(false)}
          onSuccess={onReload}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Backup löschen"
          body={`Backup „${deleteTarget.filename}" wirklich löschen?`}
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={async () => {
            const bk = deleteTarget
            setDeleteTarget(null)
            await handleDelete(bk) // handleDelete setzt actionErr intern
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}
