// p3portal.org
/**
 * PROJ-79: Delete-with-usage-check modal (AC-DEL-1/2).
 * On open it fetches which VMs/LXC on the node reference the bridge and shows a
 * clear warning before the user confirms. Deletion is always permitted (user's
 * decision) but never without the warning. The deletion is staged as pending –
 * it only becomes real after the user applies the network reload.
 */
import { useState, useEffect } from 'react'
import { checkNetworkInterfaceUsage, deleteNetworkInterface } from '../../api/networks'

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien (Sys.Modify auf /nodes erforderlich).'
  if (s === 503) return 'Admin-Token für diese Node nicht konfiguriert.'
  if (s === 502) return 'Proxmox-API nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Löschen des Interfaces.'
}

export default function DeleteUsageConfirmModal({ node, iface, onClose, onSuccess }) {
  const isBridge = iface?.type === 'bridge'
  const [usage, setUsage]     = useState(null)   // { in_use, usages, incomplete }
  const [loading, setLoading] = useState(isBridge)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]     = useState('')

  // Usage check only makes sense for bridges (VMs reference bridges, not VLAN ifaces directly).
  useEffect(() => {
    if (!isBridge) return
    setLoading(true)
    checkNetworkInterfaceUsage(node, iface.iface)
      .then(d => setUsage(d))
      .catch(() => setUsage({ in_use: false, usages: [], incomplete: true }))
      .finally(() => setLoading(false))
  }, [node, iface, isBridge])

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      await deleteNetworkInterface(node, iface.iface)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errMsg(err))
      setDeleting(false)
    }
  }

  const usages = usage?.usages ?? []
  const inUse = Boolean(usage?.in_use)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="net-delete-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 id="net-delete-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            Interface löschen – {iface?.iface}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          {loading && (
            <p className="text-sm text-gray-500 dark:text-zinc-400">Nutzungsprüfung läuft …</p>
          )}

          {!loading && isBridge && inUse && (
            <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3">
              <p className="text-sm font-medium text-red-700 dark:text-red-400">
                ⚠ Diese Bridge wird noch von {usages.length} Gast/Gästen genutzt:
              </p>
              <ul className="mt-2 text-xs text-red-700/90 dark:text-red-400/90 space-y-0.5 max-h-40 overflow-y-auto">
                {usages.map(u => (
                  <li key={`${u.kind}-${u.vmid}`}>
                    <span className="font-mono">{u.vmid}</span> {u.name}{' '}
                    <span className="text-[10px] uppercase opacity-70">({u.kind})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-red-600/80 dark:text-red-400/80">
                Nach dem Löschen + Reload hängen die Netzwerkkarten dieser Gäste ins Leere.
              </p>
            </div>
          )}

          {!loading && isBridge && !inUse && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              Keine VM/LXC dieses Nodes referenziert die Bridge{usage?.incomplete ? ' (Prüfung war unvollständig).' : '.'}
            </p>
          )}

          {!isBridge && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              VLAN-Interface <span className="font-mono">{iface?.iface}</span> wirklich löschen?
            </p>
          )}

          <p className="text-xs text-gray-400 dark:text-zinc-500">
            Die Löschung wird zunächst nur vorgemerkt (pending) und erst beim nächsten Reload aktiv.
          </p>

          {usage?.incomplete && isBridge && (
            <p className="text-[11px] text-yellow-600 dark:text-yellow-400">
              Hinweis: Einige VM-Konfigurationen konnten nicht geprüft werden – die Liste ist evtl. unvollständig.
            </p>
          )}

          {error && (
            <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={deleting} className="btn-secondary">
            Abbrechen
          </button>
          <button type="button" onClick={handleDelete} disabled={deleting || loading} className="btn-danger">
            {deleting ? '…' : 'Löschen'}
          </button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
