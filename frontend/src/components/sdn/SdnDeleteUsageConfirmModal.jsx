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
import { useTranslation } from 'react-i18next'
import {
  checkSdnZoneUsage,
  checkSdnVnetUsage,
  deleteSdnZone,
  deleteSdnVnet,
  deleteSdnSubnet,
} from '../../api/sdn'

function errMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('sdn.delete.err_403')
  if (s === 503) return t('sdn.delete.err_503')
  if (s === 502) return t('sdn.delete.err_502')
  return (typeof d === 'string' ? d : null) ?? t('sdn.delete.err_generic')
}

export default function SdnDeleteUsageConfirmModal({ kind, item, portalNodeId = null, onClose, onSuccess }) {
  const { t } = useTranslation()
  const KIND_LABEL = { zone: t('sdn.delete.kind_zone'), vnet: t('sdn.delete.kind_vnet'), subnet: t('sdn.delete.kind_subnet') }
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
      setError(errMsg(err, t))
      setDeleting(false)
    }
  }

  const vms = usage?.vms ?? []
  const subnets = usage?.subnets ?? []
  const vnets = usage?.vnets ?? []
  const inUse = Boolean(usage?.in_use)
  const label = KIND_LABEL[kind] ?? t('sdn.delete.kind_object')

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
            {t('sdn.delete.title', { label, name: item?.cidr || item?.id })}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          {loading && (
            <p className="text-sm text-gray-500 dark:text-zinc-400">{t('sdn.delete.checking')}</p>
          )}

          {/* Zone usage: vnets in the zone */}
          {!loading && kind === 'zone' && inUse && (
            <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3">
              <p className="text-sm font-medium text-portal-danger">
                {t('sdn.delete.zone_in_use', { count: vnets.length })}
              </p>
              <ul className="mt-2 text-xs text-portal-danger/90 space-y-0.5 max-h-40 overflow-y-auto font-mono">
                {vnets.map(v => <li key={v}>{v}</li>)}
              </ul>
              <p className="mt-2 text-xs text-portal-danger/80">
                {t('sdn.delete.zone_in_use_hint')}
              </p>
            </div>
          )}

          {/* VNet usage: VMs + subnets */}
          {!loading && kind === 'vnet' && inUse && (
            <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 space-y-2">
              {vms.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-portal-danger">
                    {t('sdn.delete.vnet_vms_in_use', { count: vms.length })}
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
                    {t('sdn.delete.vnet_subnets_in_use', { count: subnets.length })}
                  </p>
                  <ul className="mt-1 text-xs text-portal-danger/90 space-y-0.5 max-h-24 overflow-y-auto font-mono">
                    {subnets.map(s => <li key={s}>{s}</li>)}
                  </ul>
                </div>
              )}
              <p className="text-xs text-portal-danger/80">
                {t('sdn.delete.vnet_in_use_hint')}
              </p>
            </div>
          )}

          {/* No usage found */}
          {!loading && hasUsageCheck && !inUse && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              {t('sdn.delete.no_usage', {
                label,
                suffix: usage?.incomplete ? t('sdn.delete.no_usage_incomplete') : t('sdn.delete.no_usage_dot'),
              })}
            </p>
          )}

          {/* Subnet: plain confirm */}
          {kind === 'subnet' && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              {t('sdn.delete.subnet_confirm')}{' '}
              <span className="font-mono">{item?.cidr || item?.id}</span> (VNet {item?.vnet})
            </p>
          )}

          <p className="text-xs text-gray-400 dark:text-zinc-500">
            {t('sdn.delete.staged_hint')}
          </p>

          {usage?.incomplete && hasUsageCheck && (
            <p className="text-[11px] text-portal-warn">
              {t('sdn.delete.incomplete_hint')}
            </p>
          )}

          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={deleting} className="btn-secondary">{t('sdn.delete.cancel')}</button>
          <button type="button" onClick={handleDelete} disabled={deleting || loading} className="btn-danger">
            {deleting ? '…' : t('sdn.delete.confirm')}
          </button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
