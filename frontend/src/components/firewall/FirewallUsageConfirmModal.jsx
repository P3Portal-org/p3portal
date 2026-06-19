// p3portal.org
/**
 * PROJ-90: Delete a security group / IPSet / alias with a usage check
 * (AC-SG-4 / AC-IPSET-3 / AC-ALIAS-3). On open it asks the cluster-wide usage
 * fan-out which rules still reference the object; deletion is always allowed
 * (user's decision) but never without the warning. Datacenter objects run the
 * usage check; per-guest IPSets/aliases use a plain confirm (no `usageCheck`).
 */
import { useState, useEffect } from 'react'
import { firewallErrMsg } from '../../api/firewall'

const KIND_LABEL = { group: 'Security-Group', ipset: 'IPSet', alias: 'Alias' }

function UsageRow({ u }) {
  const where =
    u.level === 'datacenter' ? (u.group ? `Datacenter · Gruppe ${u.group}` : 'Datacenter')
      : u.level === 'node' ? `Node ${u.node}`
        : `Gast ${u.vmid}${u.kind ? ` (${u.kind})` : ''}${u.node ? ` · ${u.node}` : ''}`
  return (
    <li className="text-xs text-portal-danger/90">
      <span className="font-medium">{where}</span> · Pos. {u.pos}: <span className="font-mono">{u.rule}</span>
    </li>
  )
}

export default function FirewallUsageConfirmModal({ kind, name, usageCheck, onDelete, onClose, onSuccess }) {
  const hasUsage = typeof usageCheck === 'function'
  const [usage, setUsage]     = useState(null)
  const [loading, setLoading] = useState(hasUsage)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]     = useState('')

  useEffect(() => {
    if (!hasUsage) return
    setLoading(true)
    usageCheck()
      .then(d => setUsage(d))
      .catch(() => setUsage({ in_use: false, incomplete: true, usages: [] }))
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      await onDelete()
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(firewallErrMsg(err))
      setDeleting(false)
    }
  }

  const usages = usage?.usages ?? []
  const inUse = Boolean(usage?.in_use)
  const label = KIND_LABEL[kind] ?? 'Objekt'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="fw-usage-title">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 id="fw-usage-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {label} löschen – <span className="font-mono">{name}</span>
          </h2>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          {loading && <p className="text-sm text-gray-500 dark:text-zinc-400">Nutzungsprüfung läuft …</p>}

          {!loading && hasUsage && inUse && (
            <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3">
              <p className="text-sm font-medium text-portal-danger">
                ⚠ Dieses {label} wird von {usages.length} Regel(n) referenziert:
              </p>
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {usages.map((u, i) => <UsageRow key={`${u.level}-${u.node}-${u.vmid}-${u.group}-${u.pos}-${i}`} u={u} />)}
              </ul>
              <p className="mt-2 text-xs text-portal-danger/80">
                Nach dem Löschen laufen diese Regeln ins Leere (Proxmox-Verhalten).
              </p>
            </div>
          )}

          {!loading && hasUsage && !inUse && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              Keine bekannte Nutzung dieses {label}s{usage?.incomplete ? ' (Prüfung war unvollständig).' : '.'}
            </p>
          )}

          {!hasUsage && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              {label} <span className="font-mono">{name}</span> wirklich löschen?
            </p>
          )}

          {usage?.incomplete && hasUsage && (
            <p className="text-[11px] text-portal-warn">
              Hinweis: Die Nutzungsprüfung war unvollständig – die Liste ist evtl. nicht vollständig.
            </p>
          )}

          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={deleting} className="btn-secondary">Abbrechen</button>
          <button type="button" onClick={handleDelete} disabled={deleting || loading} className="btn-danger">{deleting ? '…' : 'Löschen'}</button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
