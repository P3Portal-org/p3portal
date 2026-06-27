// p3portal.org
/**
 * PROJ-79: Node network management tab (Linux bridges & VLAN interfaces).
 * Lists interfaces, stages create/edit/delete as pending, then applies (reload)
 * or discards (revert) the staged changes. Proxmox is the single source of truth.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  listNetworkInterfaces,
  reloadNetwork,
  revertNetwork,
} from '../../api/networks'
import NetworkBridgeFormModal from './NetworkBridgeFormModal'
import NetworkVlanFormModal from './NetworkVlanFormModal'
import DeleteUsageConfirmModal from './DeleteUsageConfirmModal'
import ConfirmModal from '../common/ConfirmModal'

function apiErrMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('networks.err_403')
  if (s === 503) return t('networks.err_503')
  if (s === 502) return t('networks.err_502')
  return (typeof d === 'string' ? d : null) ?? t('networks.err_generic')
}

function ifaceIp(iface) {
  if (iface.cidr && iface.cidr6) return `${iface.cidr} · ${iface.cidr6}`
  return iface.cidr || iface.cidr6 || '–'
}

function StatusBadge({ iface, t }) {
  if (iface.pending) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-portal-warn/10 text-portal-warn">
        {t('networks.badge_pending')}
      </span>
    )
  }
  if (iface.active === false) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
        {t('networks.badge_inactive')}
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-portal-success/10 text-portal-success">
      {t('networks.badge_active')}
    </span>
  )
}

function RowActions({ iface, onEdit, onDelete, busy, t }) {
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <button onClick={() => onEdit(iface)} disabled={busy} className="btn-table" title={t('networks.btn_edit')}>
        {t('networks.btn_edit')}
      </button>
      <button onClick={() => onDelete(iface)} disabled={busy} className="btn-table-danger" title={t('networks.btn_delete')}>
        {t('networks.btn_delete')}
      </button>
    </div>
  )
}

export default function ComputeNetworkTab({ nodeName, active }) {
  const { t } = useTranslation()
  const [data, setData]       = useState(null)   // NetworkListResponse
  const [loading, setLoading] = useState(false)
  const [query, setQuery]     = useState('')
  const [typeFilter, setTypeFilter] = useState('all')   // all | bridge | vlan
  const [actionError, setActionError] = useState('')
  // Sticky pending hint: set after any create/edit/delete, cleared only after a
  // successful reload/revert. This survives load() overwriting data.has_pending,
  // which matters on PVE versions that don't expose a per-iface pending flag
  // (BUG-79-1: load() would otherwise clear the optimistic banner immediately).
  const [pendingHint, setPendingHint] = useState(false)

  // Modal states (undefined = closed, null = create, object = edit)
  const [bridgeModal, setBridgeModal] = useState(undefined)
  const [vlanModal, setVlanModal]     = useState(undefined)
  const [deleteIface, setDeleteIface] = useState(null)
  const [showReload, setShowReload]   = useState(false)
  const [showRevert, setShowRevert]   = useState(false)

  const load = useCallback(() => {
    if (!nodeName) return
    setLoading(true)
    listNetworkInterfaces(nodeName)
      .then(d => setData(d))
      .catch(err => setData({ interfaces: [], node_unreachable: true, detail: apiErrMsg(err, t) }))
      .finally(() => setLoading(false))
  }, [nodeName, t])

  useEffect(() => {
    if (!active) return
    load()
  }, [active, load])

  // Reset on node change
  useEffect(() => {
    setData(null)
    setQuery('')
    setTypeFilter('all')
    setActionError('')
    setBridgeModal(undefined)
    setVlanModal(undefined)
    setDeleteIface(null)
    setShowReload(false)
    setShowRevert(false)
    setPendingHint(false)
  }, [nodeName])

  // Refresh after a successful create/edit/delete. The sticky pendingHint keeps
  // the "apply changes" banner visible even if the backend list does not report
  // a per-iface pending flag (version-fragile); it is cleared on reload/revert.
  const afterMutation = () => {
    setPendingHint(true)
    load()
  }

  const handleReload = async () => {
    try {
      await reloadNetwork(nodeName)
      setPendingHint(false)   // staged changes are now applied
    } catch (err) {
      throw new Error(apiErrMsg(err, t))
    }
  }
  const handleRevert = async () => {
    try {
      await revertNetwork(nodeName)
      setPendingHint(false)   // staged changes discarded
    } catch (err) {
      throw new Error(apiErrMsg(err, t))
    }
  }

  // ── Render guards ───────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (data?.node_unreachable) {
    return (
      <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
        {t('networks.node_unreachable')}
        {data.detail && (
          <span className="block mt-1 text-xs text-portal-warn/90">
            {t('networks.node_unreachable_cause', { detail: data.detail })}
          </span>
        )}
      </div>
    )
  }

  if (data?.permission_denied) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">{t('networks.no_access_title')}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          {t('networks.no_access_body', { node: nodeName })}
        </p>
      </div>
    )
  }

  const interfaces = data?.interfaces ?? []
  const filtered = interfaces.filter(i => {
    if (typeFilter !== 'all' && i.type !== typeFilter) return false
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      if (!i.iface.toLowerCase().includes(q) && !i.type.toLowerCase().includes(q)) return false
    }
    return true
  })

  const hasPending = data?.has_pending || interfaces.some(i => i.pending) || pendingHint

  return (
    <div className="space-y-3">
      {/* Pending-changes banner */}
      {hasPending && (
        <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-portal-warn">
            {t('networks.pending_banner')}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setActionError(''); setShowReload(true) }} className="btn-primary text-xs">
              {t('networks.btn_apply')}
            </button>
            <button onClick={() => { setActionError(''); setShowRevert(true) }} className="btn-secondary text-xs">
              {t('networks.btn_revert')}
            </button>
          </div>
        </div>
      )}

      {/* Toolbar: search/filter + create buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('networks.search_ph')}
            className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent w-44"
          />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-2 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent"
          >
            <option value="all">{t('networks.filter_all')}</option>
            <option value="bridge">{t('networks.filter_bridges')}</option>
            <option value="vlan">{t('networks.filter_vlans')}</option>
          </select>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => { setActionError(''); setBridgeModal(null) }} className="btn-primary text-xs">
            {t('networks.btn_add_bridge')}
          </button>
          <button onClick={() => { setActionError(''); setVlanModal(null) }} className="btn-secondary text-xs">
            {t('networks.btn_add_vlan')}
          </button>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 underline text-xs">{t('networks.btn_close')}</button>
        </div>
      )}

      {/* Empty state */}
      {interfaces.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-400 dark:text-zinc-500">
          {t('networks.empty_node')}
        </div>
      )}

      {/* Interface table */}
      {interfaces.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('networks.col_name')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('networks.col_type')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('networks.col_ip_cidr')}</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('networks.col_autostart')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('networks.col_status')}</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('networks.col_comment')}</th>
                  <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">{t('networks.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {filtered.map(iface => (
                  <tr key={iface.iface} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">
                      {iface.iface}
                      {iface.bridge_vlan_aware && (
                        <span className="ml-1.5 text-[9px] text-gray-400 dark:text-zinc-500">{t('networks.vlan_aware')}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                      {iface.type === 'bridge' ? t('networks.type_bridge') : iface.type === 'vlan' ? t('networks.type_vlan') : iface.type}
                      {iface.type === 'vlan' && iface.vlan_id != null && (
                        <span className="block text-[10px] text-gray-400 dark:text-zinc-500">{t('networks.vlan_tag', { tag: iface.vlan_id })}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-300 font-mono whitespace-nowrap">
                      {ifaceIp(iface)}
                      {iface.gateway && (
                        <span className="block text-[10px] text-gray-400 dark:text-zinc-500">{t('networks.gateway_short', { gateway: iface.gateway })}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {iface.autostart
                        ? <span className="text-portal-success text-sm" title={t('networks.autostart_on')}>✓</span>
                        : <span className="text-gray-300 dark:text-zinc-600 text-sm" title={t('networks.autostart_off')}>–</span>}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge iface={iface} t={t} /></td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 max-w-[160px] truncate" title={iface.comments || ''}>
                      {iface.comments || '–'}
                    </td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        iface={iface}
                        t={t}
                        onEdit={i => {
                          setActionError('')
                          if (i.type === 'vlan') setVlanModal(i)
                          else setBridgeModal(i)
                        }}
                        onDelete={i => { setActionError(''); setDeleteIface(i) }}
                      />
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">
                      {t('networks.no_filter_match')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bridge modal: create (null) or edit (object) */}
      {bridgeModal !== undefined && (
        <NetworkBridgeFormModal
          node={nodeName}
          iface={bridgeModal}
          onClose={() => setBridgeModal(undefined)}
          onSuccess={afterMutation}
        />
      )}

      {/* VLAN modal */}
      {vlanModal !== undefined && (
        <NetworkVlanFormModal
          node={nodeName}
          iface={vlanModal}
          onClose={() => setVlanModal(undefined)}
          onSuccess={afterMutation}
        />
      )}

      {/* Delete-with-usage confirm */}
      {deleteIface && (
        <DeleteUsageConfirmModal
          node={nodeName}
          iface={deleteIface}
          onClose={() => setDeleteIface(null)}
          onSuccess={afterMutation}
        />
      )}

      {/* Reload (apply) warning */}
      {showReload && (
        <ConfirmModal
          title={t('networks.reload_title')}
          body={t('networks.reload_body')}
          confirmLabel={t('networks.reload_confirm')}
          variant="danger"
          onConfirm={handleReload}
          onClose={() => { setShowReload(false); load() }}
        />
      )}

      {/* Revert (discard) confirm */}
      {showRevert && (
        <ConfirmModal
          title={t('networks.revert_title')}
          body={t('networks.revert_body')}
          confirmLabel={t('networks.revert_confirm')}
          variant="primary"
          onConfirm={handleRevert}
          onClose={() => { setShowRevert(false); load() }}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
