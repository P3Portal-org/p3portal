// p3portal.org
/**
 * PROJ-80: Cluster-wide SDN management (zones / vnets / subnets).
 * Lists the three SDN entity classes, stages create/edit/delete as pending, then
 * applies them CLUSTER-WIDE (PUT /cluster/sdn = reload on ALL nodes) or discards
 * them (revert). Proxmox is the single source of truth – no DB, last writer wins.
 *
 * Cluster-wide vs PROJ-79: no node selector, the Apply warns explicitly that it
 * affects every node. Read goes through admin→operator→viewer (BUG-79-4 lesson),
 * list endpoints never 500 → flags (sdn_unavailable / permission_denied /
 * cluster_unreachable). Sticky pendingHint keeps the apply banner visible on PVE
 * versions without a reliable per-object state field (BUG-79-1 lesson).
 */
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  listSdnZones,
  listSdnVnets,
  listSdnSubnets,
  applySdn,
  revertSdn,
} from '../../api/sdn'
import SdnZoneFormModal from './SdnZoneFormModal'
import SdnVnetFormModal from './SdnVnetFormModal'
import SdnSubnetFormModal from './SdnSubnetFormModal'
import SdnDeleteUsageConfirmModal from './SdnDeleteUsageConfirmModal'
import ConfirmModal from '../common/ConfirmModal'

function apiErrMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('sdn.err_403')
  if (s === 503) return t('sdn.err_503')
  if (s === 502) return t('sdn.err_502')
  return (typeof d === 'string' ? d : null) ?? t('sdn.err_generic')
}

function StateBadge({ pending, state, t }) {
  if (!pending) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-portal-success/10 text-portal-success">
        {t('sdn.badge_active')}
      </span>
    )
  }
  const label = state === 'deleted' ? t('sdn.badge_deleted') : state === 'changed' ? t('sdn.badge_changed') : state === 'new' ? t('sdn.badge_new') : t('sdn.badge_pending')
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-portal-warn/10 text-portal-warn">
      {label}
    </span>
  )
}

function SectionHeader({ title, count, onCreate, createLabel, createDisabled }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
        {title} <span className="text-gray-400 dark:text-zinc-600">({count})</span>
      </h3>
      <button onClick={onCreate} disabled={createDisabled} className="btn-primary text-xs">
        {createLabel}
      </button>
    </div>
  )
}

function RowActions({ onEdit, onDelete, busy, t }) {
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <button onClick={onEdit} disabled={busy} className="btn-table" title={t('sdn.btn_edit')}>{t('sdn.btn_edit')}</button>
      <button onClick={onDelete} disabled={busy} className="btn-table-danger" title={t('sdn.btn_delete')}>{t('sdn.btn_delete')}</button>
    </div>
  )
}

function thCls() {
  return 'px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider'
}

export default function SdnManagementTab({ portalNodeId = null } = {}) {
  const { t } = useTranslation()
  const [zones, setZones]     = useState(null)   // SdnZoneListResponse
  const [vnets, setVnets]     = useState(null)
  const [subnets, setSubnets] = useState(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery]     = useState('')
  const [actionError, setActionError] = useState('')
  const [pendingHint, setPendingHint] = useState(false)

  // Modal states (undefined = closed, null = create, object = edit)
  const [zoneModal, setZoneModal]     = useState(undefined)
  const [vnetModal, setVnetModal]     = useState(undefined)
  const [subnetModal, setSubnetModal] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)   // { kind, item }
  const [showApply, setShowApply]     = useState(false)
  const [showRevert, setShowRevert]   = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      listSdnZones(portalNodeId).catch(err => ({ items: [], cluster_unreachable: true, detail: apiErrMsg(err, t) })),
      listSdnVnets(portalNodeId).catch(() => ({ items: [] })),
      listSdnSubnets(portalNodeId).catch(() => ({ items: [] })),
    ])
      .then(([z, v, s]) => { setZones(z); setVnets(v); setSubnets(s) })
      .finally(() => setLoading(false))
  }, [portalNodeId, t])

  // Reset stale state when the selected installation changes, then reload.
  useEffect(() => { setPendingHint(false); setActionError(''); load() }, [load])

  const afterMutation = () => { setPendingHint(true); load() }

  const handleApply = async () => {
    try {
      await applySdn(portalNodeId)
      setPendingHint(false)
    } catch (err) {
      throw new Error(apiErrMsg(err, t))
    }
  }
  const handleRevert = async () => {
    try {
      await revertSdn(portalNodeId)
      setPendingHint(false)
    } catch (err) {
      throw new Error(apiErrMsg(err, t))
    }
  }

  // ── Render guards (any list flagging the feature/availability state) ──────────
  if (loading && !zones) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />)}
      </div>
    )
  }

  if (zones?.sdn_unavailable) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">{t('sdn.unavailable_title')}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          {t('sdn.unavailable_body')}
        </p>
      </div>
    )
  }

  if (zones?.permission_denied) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">{t('sdn.no_access_title')}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          {t('sdn.no_access_body')}
        </p>
      </div>
    )
  }

  if (zones?.cluster_unreachable) {
    return (
      <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
        {t('sdn.cluster_unreachable')}
        {zones.detail && (
          <span className="block mt-1 text-xs text-portal-warn/90">{t('sdn.cluster_unreachable_cause', { detail: zones.detail })}</span>
        )}
      </div>
    )
  }

  const zoneItems   = zones?.items ?? []
  const vnetItems   = vnets?.items ?? []
  const subnetItems = subnets?.items ?? []

  const q = query.trim().toLowerCase()
  const matchZone   = (z) => !q || z.id.toLowerCase().includes(q) || (z.type || '').toLowerCase().includes(q)
  const matchVnet   = (v) => !q || v.id.toLowerCase().includes(q) || (v.zone || '').toLowerCase().includes(q)
  const matchSubnet = (s) => !q || (s.cidr || s.id || '').toLowerCase().includes(q) || (s.vnet || '').toLowerCase().includes(q)

  const fZones   = zoneItems.filter(matchZone)
  const fVnets   = vnetItems.filter(matchVnet)
  const fSubnets = subnetItems.filter(matchSubnet)

  const hasPending =
    zones?.has_pending || vnets?.has_pending || subnets?.has_pending ||
    zoneItems.some(z => z.pending) || vnetItems.some(v => v.pending) || subnetItems.some(s => s.pending) ||
    pendingHint

  return (
    <div className="space-y-5">
      {/* Cluster-wide pending banner */}
      {hasPending && (
        <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-portal-warn">
            {t('sdn.pending_banner')}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setActionError(''); setShowApply(true) }} className="btn-primary text-xs">
              {t('sdn.btn_apply')}
            </button>
            <button onClick={() => { setActionError(''); setShowRevert(true) }} className="btn-secondary text-xs">
              {t('sdn.btn_revert')}
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('sdn.search_ph')}
          className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent w-56"
        />
      </div>

      {actionError && (
        <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 underline text-xs">{t('sdn.btn_close')}</button>
        </div>
      )}

      {/* ── Zones ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title={t('sdn.section_zones')}
          count={zoneItems.length}
          createLabel={t('sdn.btn_add_zone')}
          onCreate={() => { setActionError(''); setZoneModal(null) }}
        />
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <th className={thCls()}>{t('sdn.col_name')}</th>
                  <th className={thCls()}>{t('sdn.col_type')}</th>
                  <th className={thCls()}>{t('sdn.col_bridge_nodes')}</th>
                  <th className={thCls()}>{t('sdn.col_mtu')}</th>
                  <th className={thCls()}>{t('sdn.col_status')}</th>
                  <th className={`${thCls()} text-right`}>{t('sdn.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {fZones.map(z => (
                  <tr key={z.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">{z.id}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400">{z.type}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{z.bridge || z.nodes || '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400">{z.mtu ?? '–'}</td>
                    <td className="px-3 py-2.5"><StateBadge pending={z.pending} state={z.state} t={t} /></td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        onEdit={() => { setActionError(''); setZoneModal(z) }}
                        onDelete={() => { setActionError(''); setDeleteTarget({ kind: 'zone', item: z }) }}
                        t={t}
                      />
                    </td>
                  </tr>
                ))}
                {fZones.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">{t('sdn.empty_zones')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── VNets ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title={t('sdn.section_vnets')}
          count={vnetItems.length}
          createLabel={t('sdn.btn_add_vnet')}
          createDisabled={zoneItems.length === 0}
          onCreate={() => { setActionError(''); setVnetModal(null) }}
        />
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <th className={thCls()}>{t('sdn.col_name')}</th>
                  <th className={thCls()}>{t('sdn.col_zone')}</th>
                  <th className={thCls()}>{t('sdn.col_tag')}</th>
                  <th className={thCls()}>{t('sdn.col_alias')}</th>
                  <th className={thCls()}>{t('sdn.col_status')}</th>
                  <th className={`${thCls()} text-right`}>{t('sdn.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {fVnets.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">
                      {v.id}
                      {v.vlanaware && <span className="ml-1.5 text-[9px] text-gray-400 dark:text-zinc-500">{t('sdn.vlan_aware')}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{v.zone || '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400">{v.tag ?? '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 max-w-[160px] truncate" title={v.alias || ''}>{v.alias || '–'}</td>
                    <td className="px-3 py-2.5"><StateBadge pending={v.pending} state={v.state} t={t} /></td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        onEdit={() => { setActionError(''); setVnetModal(v) }}
                        onDelete={() => { setActionError(''); setDeleteTarget({ kind: 'vnet', item: v }) }}
                        t={t}
                      />
                    </td>
                  </tr>
                ))}
                {fVnets.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">{t('sdn.empty_vnets')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Subnets ───────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title={t('sdn.section_subnets')}
          count={subnetItems.length}
          createLabel={t('sdn.btn_add_subnet')}
          createDisabled={vnetItems.length === 0}
          onCreate={() => { setActionError(''); setSubnetModal(null) }}
        />
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <th className={thCls()}>{t('sdn.col_cidr')}</th>
                  <th className={thCls()}>{t('sdn.col_vnet')}</th>
                  <th className={thCls()}>{t('sdn.col_gateway')}</th>
                  <th className={thCls()}>{t('sdn.col_snat')}</th>
                  <th className={thCls()}>{t('sdn.col_status')}</th>
                  <th className={`${thCls()} text-right`}>{t('sdn.col_actions')}</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {fSubnets.map(s => (
                  <tr key={`${s.vnet}-${s.id}`} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">{s.cidr || s.id}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{s.vnet || '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{s.gateway || '–'}</td>
                    <td className="px-3 py-2.5 text-center">
                      {s.snat ? <span className="text-portal-success text-sm" title={t('sdn.snat_active')}>✓</span> : <span className="text-gray-300 dark:text-zinc-600 text-sm">–</span>}
                    </td>
                    <td className="px-3 py-2.5"><StateBadge pending={s.pending} state={s.state} t={t} /></td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        onEdit={() => { setActionError(''); setSubnetModal(s) }}
                        onDelete={() => { setActionError(''); setDeleteTarget({ kind: 'subnet', item: s }) }}
                        t={t}
                      />
                    </td>
                  </tr>
                ))}
                {fSubnets.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">{t('sdn.empty_subnets')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {zoneModal !== undefined && (
        <SdnZoneFormModal zone={zoneModal} portalNodeId={portalNodeId} onClose={() => setZoneModal(undefined)} onSuccess={afterMutation} />
      )}
      {vnetModal !== undefined && (
        <SdnVnetFormModal vnet={vnetModal} zones={zoneItems} portalNodeId={portalNodeId} onClose={() => setVnetModal(undefined)} onSuccess={afterMutation} />
      )}
      {subnetModal !== undefined && (
        <SdnSubnetFormModal subnet={subnetModal} vnets={vnetItems} portalNodeId={portalNodeId} onClose={() => setSubnetModal(undefined)} onSuccess={afterMutation} />
      )}
      {deleteTarget && (
        <SdnDeleteUsageConfirmModal
          kind={deleteTarget.kind}
          item={deleteTarget.item}
          portalNodeId={portalNodeId}
          onClose={() => setDeleteTarget(null)}
          onSuccess={afterMutation}
        />
      )}

      {/* Apply (cluster-wide!) warning */}
      {showApply && (
        <ConfirmModal
          title={t('sdn.apply_title')}
          body={t('sdn.apply_body')}
          confirmLabel={t('sdn.apply_confirm')}
          variant="danger"
          onConfirm={handleApply}
          onClose={() => { setShowApply(false); load() }}
        />
      )}

      {/* Revert confirm */}
      {showRevert && (
        <ConfirmModal
          title={t('sdn.revert_title')}
          body={t('sdn.revert_body')}
          confirmLabel={t('sdn.revert_confirm')}
          variant="primary"
          onConfirm={handleRevert}
          onClose={() => { setShowRevert(false); load() }}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
