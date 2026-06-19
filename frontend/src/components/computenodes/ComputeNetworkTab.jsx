// p3portal.org
/**
 * PROJ-79: Node network management tab (Linux bridges & VLAN interfaces).
 * Lists interfaces, stages create/edit/delete as pending, then applies (reload)
 * or discards (revert) the staged changes. Proxmox is the single source of truth.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  listNetworkInterfaces,
  reloadNetwork,
  revertNetwork,
} from '../../api/networks'
import NetworkBridgeFormModal from './NetworkBridgeFormModal'
import NetworkVlanFormModal from './NetworkVlanFormModal'
import DeleteUsageConfirmModal from './DeleteUsageConfirmModal'
import ConfirmModal from '../common/ConfirmModal'

function apiErrMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien für die Netzwerk-Verwaltung.'
  if (s === 503) return 'Admin-Token für diese Node nicht konfiguriert.'
  if (s === 502) return 'Proxmox nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Ausführen der Aktion.'
}

function ifaceIp(iface) {
  if (iface.cidr && iface.cidr6) return `${iface.cidr} · ${iface.cidr6}`
  return iface.cidr || iface.cidr6 || '–'
}

function StatusBadge({ iface }) {
  if (iface.pending) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400">
        ausstehend
      </span>
    )
  }
  if (iface.active === false) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
        inaktiv
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400">
      aktiv
    </span>
  )
}

function RowActions({ iface, onEdit, onDelete, busy }) {
  return (
    <div className="flex items-center gap-1.5 justify-end">
      <button onClick={() => onEdit(iface)} disabled={busy} className="btn-table" title="Bearbeiten">
        Bearbeiten
      </button>
      <button onClick={() => onDelete(iface)} disabled={busy} className="btn-table-danger" title="Löschen">
        Löschen
      </button>
    </div>
  )
}

export default function ComputeNetworkTab({ nodeName, active }) {
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
      .catch(err => setData({ interfaces: [], node_unreachable: true, detail: apiErrMsg(err) }))
      .finally(() => setLoading(false))
  }, [nodeName])

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
      throw new Error(apiErrMsg(err))
    }
  }
  const handleRevert = async () => {
    try {
      await revertNetwork(nodeName)
      setPendingHint(false)   // staged changes discarded
    } catch (err) {
      throw new Error(apiErrMsg(err))
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
      <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-400">
        Node nicht erreichbar – Netzwerk-Interfaces konnten nicht geladen werden.
        {data.detail && (
          <span className="block mt-1 text-xs text-yellow-600/90 dark:text-yellow-500/90">
            Ursache: {data.detail}
          </span>
        )}
      </div>
    )
  }

  if (data?.permission_denied) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">Kein Zugriff in Proxmox</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          Der konfigurierte Token hat kein Leserecht auf /nodes/{nodeName}/network.
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
        <div className="rounded-lg border border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/30 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-yellow-700 dark:text-yellow-400">
            ⏳ Es gibt ausstehende Netzwerk-Änderungen. Sie werden erst nach &bdquo;Übernehmen&ldquo; wirksam.
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setActionError(''); setShowReload(true) }} className="btn-primary text-xs">
              Übernehmen (Reload)
            </button>
            <button onClick={() => { setActionError(''); setShowRevert(true) }} className="btn-secondary text-xs">
              Verwerfen (Revert)
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
            placeholder="Suche Name / Typ…"
            className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-orange-500 w-44"
          />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-2 py-1.5 text-xs rounded focus:outline-none focus:border-orange-500"
          >
            <option value="all">Alle Typen</option>
            <option value="bridge">Bridges</option>
            <option value="vlan">VLANs</option>
          </select>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => { setActionError(''); setBridgeModal(null) }} className="btn-primary text-xs">
            + Bridge anlegen
          </button>
          <button onClick={() => { setActionError(''); setVlanModal(null) }} className="btn-secondary text-xs">
            + VLAN anlegen
          </button>
        </div>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 underline text-xs">Schließen</button>
        </div>
      )}

      {/* Empty state */}
      {interfaces.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-400 dark:text-zinc-500">
          Keine Bridges oder VLAN-Interfaces auf diesem Node.
        </div>
      )}

      {/* Interface table */}
      {interfaces.length > 0 && (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Name</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Typ</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">IP / CIDR</th>
                  <th className="px-3 py-2 text-center text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Autostart</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Kommentar</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">Aktionen</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {filtered.map(iface => (
                  <tr key={iface.iface} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                    <td className="px-3 py-2.5 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200 whitespace-nowrap">
                      {iface.iface}
                      {iface.bridge_vlan_aware && (
                        <span className="ml-1.5 text-[9px] text-gray-400 dark:text-zinc-500">VLAN-aware</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                      {iface.type === 'bridge' ? 'Bridge' : iface.type === 'vlan' ? 'VLAN' : iface.type}
                      {iface.type === 'vlan' && iface.vlan_id != null && (
                        <span className="block text-[10px] text-gray-400 dark:text-zinc-500">Tag {iface.vlan_id}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-zinc-300 font-mono whitespace-nowrap">
                      {ifaceIp(iface)}
                      {iface.gateway && (
                        <span className="block text-[10px] text-gray-400 dark:text-zinc-500">GW {iface.gateway}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {iface.autostart
                        ? <span className="text-green-500 text-sm" title="Autostart aktiv">✓</span>
                        : <span className="text-gray-300 dark:text-zinc-600 text-sm" title="kein Autostart">–</span>}
                    </td>
                    <td className="px-3 py-2.5"><StatusBadge iface={iface} /></td>
                    <td className="px-3 py-2.5 text-[11px] text-gray-500 dark:text-zinc-400 max-w-[160px] truncate" title={iface.comments || ''}>
                      {iface.comments || '–'}
                    </td>
                    <td className="px-3 py-2.5">
                      <RowActions
                        iface={iface}
                        
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
                      Keine Treffer für die aktuelle Suche/Filter.
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
          title="Änderungen übernehmen (Netzwerk-Reload)"
          body={
            'Der Node führt einen Netzwerk-Reload aus. Die Konnektivität zum Node kann dabei kurz gestört sein. ' +
            'Bei einem Fehler bleiben die ausstehenden Änderungen erhalten und können verworfen werden. ' +
            'Ändere möglichst nicht die Management-Bridge (vmbr0), über die der Node erreichbar ist.'
          }
          confirmLabel="Jetzt übernehmen"
          variant="danger"
          onConfirm={handleReload}
          onClose={() => { setShowReload(false); load() }}
        />
      )}

      {/* Revert (discard) confirm */}
      {showRevert && (
        <ConfirmModal
          title="Ausstehende Änderungen verwerfen"
          body="Alle noch nicht übernommenen Netzwerk-Änderungen dieses Nodes werden verworfen. Der aktive Stand bleibt unverändert."
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
