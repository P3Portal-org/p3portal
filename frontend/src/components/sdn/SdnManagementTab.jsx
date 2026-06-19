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

function apiErrMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien für die SDN-Verwaltung (SDN.Allocate).'
  if (s === 503) return 'Admin-Token (SDN.Allocate) für diesen Cluster nicht konfiguriert.'
  if (s === 502) return 'Proxmox nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Ausführen der Aktion.'
}

function StateBadge({ pending, state }) {
  if (!pending) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-portal-success/10 text-portal-success">
        aktiv
      </span>
    )
  }
  const label = state === 'deleted' ? 'wird gelöscht' : state === 'changed' ? 'geändert' : state === 'new' ? 'neu' : 'ausstehend'
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

function RowActions({ onEdit, onDelete, busy }) {
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <button onClick={onEdit} disabled={busy} className="btn-table" title="Bearbeiten">Bearbeiten</button>
      <button onClick={onDelete} disabled={busy} className="btn-table-danger" title="Löschen">Löschen</button>
    </div>
  )
}

function thCls() {
  return 'px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider'
}

export default function SdnManagementTab({ portalNodeId = null } = {}) {
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
      listSdnZones(portalNodeId).catch(err => ({ items: [], cluster_unreachable: true, detail: apiErrMsg(err) })),
      listSdnVnets(portalNodeId).catch(() => ({ items: [] })),
      listSdnSubnets(portalNodeId).catch(() => ({ items: [] })),
    ])
      .then(([z, v, s]) => { setZones(z); setVnets(v); setSubnets(s) })
      .finally(() => setLoading(false))
  }, [portalNodeId])

  // Reset stale state when the selected installation changes, then reload.
  useEffect(() => { setPendingHint(false); setActionError(''); load() }, [load])

  const afterMutation = () => { setPendingHint(true); load() }

  const handleApply = async () => {
    try {
      await applySdn(portalNodeId)
      setPendingHint(false)
    } catch (err) {
      throw new Error(apiErrMsg(err))
    }
  }
  const handleRevert = async () => {
    try {
      await revertSdn(portalNodeId)
      setPendingHint(false)
    } catch (err) {
      throw new Error(apiErrMsg(err))
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
        <p className="text-sm font-medium text-portal-text">SDN ist auf diesem Cluster nicht verfügbar</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          Das Proxmox-Paket <span className="font-mono">pve-sdn</span> ist nicht installiert oder die SDN-API antwortet nicht.
        </p>
      </div>
    )
  }

  if (zones?.permission_denied) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">Kein Zugriff in Proxmox</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          Der konfigurierte Token hat kein Leserecht auf /cluster/sdn.
        </p>
      </div>
    )
  }

  if (zones?.cluster_unreachable) {
    return (
      <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
        Cluster nicht erreichbar – SDN-Konfiguration konnte nicht geladen werden.
        {zones.detail && (
          <span className="block mt-1 text-xs text-portal-warn/90">Ursache: {zones.detail}</span>
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
            ⏳ Es gibt ausstehende SDN-Änderungen. Sie werden erst nach &bdquo;Übernehmen&ldquo; <strong>cluster-weit</strong> wirksam.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setActionError(''); setShowApply(true) }} className="btn-primary text-xs">
              Übernehmen (cluster-weit)
            </button>
            <button onClick={() => { setActionError(''); setShowRevert(true) }} className="btn-secondary text-xs">
              Verwerfen
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
          placeholder="Suche Name / Typ / Zone…"
          className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent w-56"
        />
      </div>

      {actionError && (
        <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 underline text-xs">Schließen</button>
        </div>
      )}

      {/* ── Zones ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Zonen"
          count={zoneItems.length}
          createLabel="+ Zone anlegen"
          onCreate={() => { setActionError(''); setZoneModal(null) }}
        />
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
                  <th className={thCls()}>Name</th>
                  <th className={thCls()}>Typ</th>
                  <th className={thCls()}>Bridge / Nodes</th>
                  <th className={thCls()}>MTU</th>
                  <th className={thCls()}>Status</th>
                  <th className={`${thCls()} text-right`}>Aktionen</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {fZones.map(z => (
                  <tr key={z.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">{z.id}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400">{z.type}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{z.bridge || z.nodes || '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400">{z.mtu ?? '–'}</td>
                    <td className="px-3 py-2.5"><StateBadge pending={z.pending} state={z.state} /></td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        onEdit={() => { setActionError(''); setZoneModal(z) }}
                        onDelete={() => { setActionError(''); setDeleteTarget({ kind: 'zone', item: z }) }}
                      />
                    </td>
                  </tr>
                ))}
                {fZones.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">Keine Zonen.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── VNets ─────────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="VNets"
          count={vnetItems.length}
          createLabel="+ VNet anlegen"
          createDisabled={zoneItems.length === 0}
          onCreate={() => { setActionError(''); setVnetModal(null) }}
        />
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
                  <th className={thCls()}>Name</th>
                  <th className={thCls()}>Zone</th>
                  <th className={thCls()}>Tag</th>
                  <th className={thCls()}>Alias</th>
                  <th className={thCls()}>Status</th>
                  <th className={`${thCls()} text-right`}>Aktionen</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {fVnets.map(v => (
                  <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">
                      {v.id}
                      {v.vlanaware && <span className="ml-1.5 text-[9px] text-gray-400 dark:text-zinc-500">VLAN-aware</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{v.zone || '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400">{v.tag ?? '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 max-w-[160px] truncate" title={v.alias || ''}>{v.alias || '–'}</td>
                    <td className="px-3 py-2.5"><StateBadge pending={v.pending} state={v.state} /></td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        onEdit={() => { setActionError(''); setVnetModal(v) }}
                        onDelete={() => { setActionError(''); setDeleteTarget({ kind: 'vnet', item: v }) }}
                      />
                    </td>
                  </tr>
                ))}
                {fVnets.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">Keine VNets.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── Subnets ───────────────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="Subnets"
          count={subnetItems.length}
          createLabel="+ Subnet anlegen"
          createDisabled={vnetItems.length === 0}
          onCreate={() => { setActionError(''); setSubnetModal(null) }}
        />
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
                  <th className={thCls()}>CIDR</th>
                  <th className={thCls()}>VNet</th>
                  <th className={thCls()}>Gateway</th>
                  <th className={thCls()}>SNAT</th>
                  <th className={thCls()}>Status</th>
                  <th className={`${thCls()} text-right`}>Aktionen</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {fSubnets.map(s => (
                  <tr key={`${s.vnet}-${s.id}`} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">{s.cidr || s.id}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{s.vnet || '–'}</td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{s.gateway || '–'}</td>
                    <td className="px-3 py-2.5 text-center">
                      {s.snat ? <span className="text-portal-success text-sm" title="SNAT aktiv">✓</span> : <span className="text-gray-300 dark:text-zinc-600 text-sm">–</span>}
                    </td>
                    <td className="px-3 py-2.5"><StateBadge pending={s.pending} state={s.state} /></td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        onEdit={() => { setActionError(''); setSubnetModal(s) }}
                        onDelete={() => { setActionError(''); setDeleteTarget({ kind: 'subnet', item: s }) }}
                      />
                    </td>
                  </tr>
                ))}
                {fSubnets.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">Keine Subnets.</td></tr>
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
          title="SDN-Änderungen cluster-weit übernehmen"
          body={
            'Achtung: Der Apply lädt die SDN-Konfiguration auf ALLEN Nodes des Clusters neu (nicht nur einem). ' +
            'Eine fehlerhafte SDN-Konfiguration kann die Netzwerk-Konnektivität cluster-weit stören. ' +
            'Bei einem Fehler bleiben die ausstehenden Änderungen erhalten und können verworfen werden.'
          }
          confirmLabel="Cluster-weit übernehmen"
          variant="danger"
          onConfirm={handleApply}
          onClose={() => { setShowApply(false); load() }}
        />
      )}

      {/* Revert confirm */}
      {showRevert && (
        <ConfirmModal
          title="Ausstehende SDN-Änderungen verwerfen"
          body="Alle noch nicht übernommenen SDN-Änderungen werden verworfen. Der aktive (zuletzt angewendete) Stand bleibt unverändert."
          confirmLabel="Verwerfen"
          variant="primary"
          onConfirm={handleRevert}
          onClose={() => { setShowRevert(false); load() }}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
