// p3portal.org
/**
 * PROJ-79: Delete-with-usage-check modal (AC-DEL-1/2).
 * On open it fetches which VMs/LXC on the node reference the bridge and shows a
 * clear warning before the user confirms. Deletion is always permitted (user's
 * decision) but never without the warning. The deletion is staged as pending –
 * it only becomes real after the user applies the network reload.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { checkNetworkInterfaceUsage, deleteNetworkInterface } from '../../api/networks'

function errMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('networks.del.err_403')
  if (s === 503) return t('networks.del.err_503')
  if (s === 502) return t('networks.del.err_502')
  return (typeof d === 'string' ? d : null) ?? t('networks.del.err_generic')
}

export default function DeleteUsageConfirmModal({ node, iface, onClose, onSuccess }) {
  const { t } = useTranslation()
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
      setError(errMsg(err, t))
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
            {t('networks.delete.title', { name: iface?.iface })}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto">
          {loading && (
            <p className="text-sm text-gray-500 dark:text-zinc-400">{t('networks.delete.checking')}</p>
          )}

          {!loading && isBridge && inUse && (
            <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3">
              <p className="text-sm font-medium text-portal-danger">
                {t('networks.delete.in_use', { count: usages.length })}
              </p>
              <ul className="mt-2 text-xs text-portal-danger/90 space-y-0.5 max-h-40 overflow-y-auto">
                {usages.map(u => (
                  <li key={`${u.kind}-${u.vmid}`}>
                    <span className="font-mono">{u.vmid}</span> {u.name}{' '}
                    <span className="text-[10px] uppercase opacity-70">({u.kind})</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-portal-danger/80">
                {t('networks.delete.in_use_warn')}
              </p>
            </div>
          )}

          {!loading && isBridge && !inUse && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              {usage?.incomplete ? t('networks.delete.not_in_use_incomplete') : t('networks.delete.not_in_use')}
            </p>
          )}

          {!isBridge && (
            <p className="text-sm text-gray-700 dark:text-zinc-300">
              {t('networks.delete.vlan_confirm', { name: iface?.iface })}
            </p>
          )}

          <p className="text-xs text-gray-400 dark:text-zinc-500">
            {t('networks.delete.staged_hint')}
          </p>

          {usage?.incomplete && isBridge && (
            <p className="text-[11px] text-portal-warn">
              {t('networks.delete.incomplete_hint')}
            </p>
          )}

          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={deleting} className="btn-secondary">
            {t('networks.delete.cancel')}
          </button>
          <button type="button" onClick={handleDelete} disabled={deleting || loading} className="btn-danger">
            {deleting ? '…' : t('networks.delete.confirm')}
          </button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
