// p3portal.org
import { useState } from 'react'
import { createVmBackup } from '../../api/vms'

const MODE_OPTIONS = [
  { value: 'snapshot', label: 'Snapshot (VM läuft weiter)' },
  { value: 'stop',     label: 'Stop (VM wird gestoppt)' },
  { value: 'suspend',  label: 'Suspend (VM wird pausiert)' },
]

const COMPRESS_OPTIONS = [
  { value: 'zstd', label: 'zstd (Standard, schnell)' },
  { value: 'lzo',  label: 'lzo (schnell, weniger Kompression)' },
  { value: 'gzip', label: 'gzip (langsam, beste Kompression)' },
  { value: '0',    label: 'Keine Kompression' },
]

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Keine Berechtigung zum Erstellen von Backups.'
  if (s === 503) return 'Service-Account nicht konfiguriert.'
  if (s === 422) return d ?? 'Ungültige Backup-Parameter.'
  return d ?? 'Fehler beim Erstellen des Backups.'
}

export default function BackupCreateModal({ node, vmType, vmid, storages, onClose, onSuccess }) {
  const [storage, setStorage]   = useState(storages[0] ?? '')
  const [mode, setMode]         = useState('snapshot')
  const [compress, setCompress] = useState('zstd')
  const [creating, setCreating] = useState(false)
  const [error, setError]       = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!storage) { setError('Bitte einen Storage auswählen.'); return }
    setCreating(true)
    setError('')
    try {
      await createVmBackup(node, vmType, vmid, storage, mode, compress)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setCreating(false)
    }
  }

  const selectClass = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-md rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
            Backup erstellen – VM {vmid}
          </h2>
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

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">
              {error}
            </p>
          )}

          {/* Storage */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1.5">Storage</label>
            {storages.length === 0 ? (
              <p className="text-xs text-portal-warn">
                Keine Backup-Storages auf diesem Node konfiguriert.
              </p>
            ) : (
              <select
                value={storage}
                onChange={(e) => setStorage(e.target.value)}
                className={selectClass}
              >
                {storages.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            )}
          </div>

          {/* Mode */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1.5">Modus</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={selectClass}>
              {MODE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Compression */}
          <div>
            <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1.5">Kompression</label>
            <select value={compress} onChange={(e) => setCompress(e.target.value)} className={selectClass}>
              {COMPRESS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={creating || storages.length === 0}
            className="btn-primary w-full"
          >
            {creating ? 'Backup wird gestartet…' : 'Backup starten'}
          </button>
        </form>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
