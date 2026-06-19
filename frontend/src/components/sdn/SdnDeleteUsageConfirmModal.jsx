// p3portal.org
/**
 * PROJ-80: Delete-with-usage-check modal for SDN objects (AC-DEL-1/2).
 * On open it fetches what still references the object (cluster-wide for VNets):
 *   - zone   → which VNets live in it
 *   - vnet   → which guests (cluster-wide) + which subnets reference it
 *   - subnet → no usage lookup, plain confirm
 * Deletion is always permitted (user's decision) but never without the warning.
 * The deletion is staged as pending – it only becomes real after the cluster-wide
 * Apply. Subnet/VNet ids: subnet delete needs (vnet, subnet-id).
 */
import { useState, useEffect } from 'react'
import {
  checkSdnZoneUsage,
  checkSdnVnetUsage,
  deleteSdnZone,
  deleteSdnVnet,
  deleteSdnSubnet,
} from '../../api/sdn'

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien (SDN.Allocate auf /sdn erforderlich).'
  if (s === 503) return 'Admin-Token (SDN.Allocate) für diesen Cluster nicht konfiguriert.'
  if (s === 502) return 'Proxmox-API nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Löschen.'
}

const KIND_LABEL = { zone: 'Zone', vnet: 'VNet', subnet: 'Subnet' }

export default function SdnDeleteUsageConfirmModal({ kind, item, portalNodeId = null, onClose, onSuccess }) {
  const hasUsageCheck = kind === 'zone' || kind === 'vnet'
  const [usage, setUsage]       = useState(null)
  const [loading, setLoading]   = useState(hasUsageCheck)
  const [deleting, setDeleting] = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => {
    if (!hasUsageCheck) return
    setLoading(true)
    const fetch = kind === 'zone'
      ? checkSdnZoneUsage(item.id, portalNodeId)
      : checkSdnVnetUsage(item.id, portalNodeId)
    fetch
      .then(d => setUsage(d))
      .catch(() => setUsage({ in_use: false, incomplete: true }))
      .finally(() => setLoading(false))
  }, [kind, item, hasUsageCheck, portalNodeId])

  const handleDelete = async () => {
    setDeleting(true)
    setError('')
    try {
      if (kind === 'zone') await deleteSdnZone(item.id, portalNodeId)
      else if (kind === 'vnet') await deleteSdnVnet(item.id, portalNodeId)
      else await deleteSdnSubnet(item.vnet, item.id, portalNodeId)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errMsg(err))
      setDeleting(false)
    }
  }

  const vms = usage?.vms ?? []
  const subnets = usage?.subnets ?? []
  const vnets = usage?.vnets ?? []
  const inUse = Boolean(usage?.in_use)
  const label = KIND_LABEL[kind] ?? 'Objekt'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sdn-delete-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 id="sdn-delete-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {label} löschen – {item?.cidr || item?.id}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          {loading && (
            <p className="text-sm text-gray-500 dark:text-zinc-400">Nutzungsprüfung läuft …</p>
          )}

          {/* Zone usage: vnets in the zone */}
          {!loading && kind === 'zone' && inUse && (
            <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3">
              <p className="text-sm font-medium text-portal-danger">
                ⚠ Diese Zone enthält noch {vnets.length} VNet(s):
              </p>
              <ul className="mt-2 text-xs text-portal-danger/90 space-y-0.5 max-h-40 overflow-y-auto font-mono">
                {vnets.map(v => <li key={v}>{v}</li>)}
              </ul>
              <p className="mt-2 text-xs text-portal-danger/80">
                Proxmox lehnt das Löschen einer Zone mit VNets ggf. ab – zuerst die VNets entfernen.
              </p>
            </div>
          )}

          {/* VNet usage: VMs + subnets */}
          {!loading && kind === 'vnet' && inUse && (
            <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 space-y-2">
              {vms.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-portal-danger">
                    ⚠ Dieses VNet wird von {vms.length} Gast/Gästen als Bridge genutzt:
                  </p>
                  <ul className="mt-1 text-xs text-portal-danger/90 space-y-0.5 max-h-32 overflow-y-auto">
                    {vms.map(u => (
                      <li key={`${u.kind}-${u.node}-${u.vmid}`}>
                        <span className="font-mono">{u.vmid}</span> {u.name}{' '}
                        <span className="text-[10px] uppercase opacity-70">({u.kind} · {u.node})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {subnets.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-portal-danger">
                    Es hängen noch {subnets.length} Subnet(s) daran:
                  </p>
                  <ul className="mt-1 text-xs text-portal-danger/90 space-y-0.5 max-h-24 overflow-y-auto font-mono">
                    {subnets.map(s => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs text-portal-danger/80">
                Nach Löschen + Apply hängen die Netzwerkkarten dieser Gäste ins Leere.
              </p>
            </div>
          )}

          {/* No usage found */}
          {!loading && hasUsageCheck && !inUse && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              Keine bekannte Nutzung dieses {label}s{usage?.incomplete ? ' (Prüfung war unvollständig).' : '.'}
            </p>
          )}

          {/* Subnet: plain confirm */}
          {kind === 'subnet' && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              Subnet <span className="font-mono">{item?.cidr || item?.id}</span> (VNet {item?.vnet}) wirklich löschen?
            </p>
          )}

          <p className="text-xs text-gray-400 dark:text-zinc-500">
            Die Löschung wird zunächst nur vorgemerkt (pending) und erst beim cluster-weiten Übernehmen aktiv.
          </p>

          {usage?.incomplete && hasUsageCheck && (
            <p className="text-[11px] text-portal-warn">
              Hinweis: Die Nutzungsprüfung war unvollständig – die Liste ist evtl. nicht vollständig.
            </p>
          )}

          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={deleting} className="btn-secondary">Abbrechen</button>
          <button type="button" onClick={handleDelete} disabled={deleting || loading} className="btn-danger">
            {deleting ? '…' : 'Löschen'}
          </button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
