// p3portal.org
import { useState, useMemo, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import StatusBadge from '../ui/StatusBadge'
import VmActionButtons from '../vms/VmActionButtons'
import SnapshotModal from '../vms/SnapshotModal'
import BulkActionToolbar from './BulkActionToolbar'
import useVmIps, { vmIpKey } from '../../hooks/useVmIps'
import { deleteVm, checkVmSsh } from '../../api/vms'
import { useBulkOwners } from '../../features/owners/hooks/useOwners'
import OwnerColumn from '../../features/owners/components/OwnerColumn'
import ConfirmModal from '../common/ConfirmModal'

// ── helpers ──────────────────────────────────────────────────────────────────

function fmt(bytes) {
  if (bytes == null) return '?'
  const gb = bytes / (1024 ** 3)
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

function uptimeLabel(seconds) {
  if (!seconds) return '–'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${Math.floor((seconds % 3600) / 60)}m`
}

function canDo(vm, action) {
  if (vm.permissions == null) return true
  return vm.permissions.includes(action)
}

function isTemplate(vm) {
  return vm.template === 1 || vm.template === true
}

// ── key helpers ───────────────────────────────────────────────────────────────

const vmKey = (vm) => vmIpKey(vm)

// ── sort helpers ─────────────────────────────────────────────────────────────

function vmSortKey(vm, col) {
  if (col === 'id')      return vm.vmid
  if (col === 'name')    return (vm.name ?? `VM ${vm.vmid}`).toLowerCase()
  if (col === 'status')  return vm.status ?? ''
  if (col === 'type') {
    if (isTemplate(vm)) return 'tmpl'
    return vm.type === 'lxc' ? 'lxc' : 'vm'
  }
  if (col === 'node')    return vm.node ?? ''
  if (col === 'cpu')     return vm.cpu ?? 0
  if (col === 'mem')     return vm.mem ?? 0
  if (col === 'uptime')  return vm.uptime ?? 0
  return ''
}

// ── sub-components ───────────────────────────────────────────────────────────

function SortIcon({ active, dir }) {
  if (!active) return <span className="ml-1 opacity-30 text-[10px]">↕</span>
  return <span className="ml-1 text-[10px]">{dir === 'asc' ? '↑' : '↓'}</span>
}

function SortableTh({ col, label, sortCol, sortDir, onSort, className = '' }) {
  return (
    <th
      className={`px-4 py-2.5 cursor-pointer select-none hover:text-gray-700 dark:hover:text-zinc-300 transition-colors ${className}`}
      onClick={() => onSort(col)}
    >
      {label}
      <SortIcon col={col} active={sortCol === col} dir={sortDir} />
    </th>
  )
}

function TypeBadge({ vm }) {
  if (isTemplate(vm)) {
    return (
      <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 border border-purple-200 dark:border-purple-800">
        tmpl
      </span>
    )
  }
  if (vm.type === 'lxc') {
    return (
      <span className="text-xs bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 px-1.5 py-0.5 border border-teal-200 dark:border-teal-800">
        CT
      </span>
    )
  }
  return (
    <span className="text-xs bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 px-1.5 py-0.5">
      VM
    </span>
  )
}

function SshIcon({ state, onClick, disabled }) {
  if (state === 'checking') {
    return <span className="inline-block w-3 h-3 rounded-full border-2 border-teal-400 border-t-transparent animate-spin" />
  }
  if (state === 'reachable') {
    return <span className="inline-block w-2.5 h-2.5 rounded-full bg-green-500" title="SSH erreichbar" />
  }
  if (state === 'unreachable') {
    return (
      <button
        onClick={onClick}
        disabled={disabled}
        className="inline-block w-2.5 h-2.5 rounded-full bg-red-400 disabled:opacity-40 hover:bg-red-500 transition-colors cursor-pointer"
        title="SSH nicht erreichbar – erneut prüfen"
      />
    )
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-block w-2.5 h-2.5 rounded-full bg-gray-300 dark:bg-zinc-600 disabled:opacity-40 hover:bg-gray-400 dark:hover:bg-zinc-500 transition-colors cursor-pointer"
      title="SSH-Erreichbarkeit prüfen"
    />
  )
}

function CopyIpButton({ ip }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e) {
    e.stopPropagation()
    e.preventDefault()
    navigator.clipboard.writeText(ip).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title={copied ? 'Kopiert!' : 'IP kopieren'}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 dark:text-zinc-600 hover:text-orange-500 dark:hover:text-orange-400"
    >
      {copied
        ? <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
        : <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
      }
    </button>
  )
}

function OverflowMenu({ items }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (items.length === 0) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        title="Weitere Aktionen"
        className="p-1.5 border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 hover:border-gray-400 dark:hover:border-zinc-500 transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded shadow-lg min-w-[120px] py-0.5">
          {items.map(item => (
            <button
              key={item.label}
              onClick={() => { item.onClick(); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                item.danger
                  ? 'text-portal-danger hover:bg-portal-danger/10'
                  : 'text-portal-text hover:bg-portal-bg3/40'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DeleteVmButton({ vm, onRequestDelete, busy }) {
  return (
    <button
      onClick={() => onRequestDelete(vm)}
      disabled={busy}
      className="btn-table-danger"
    >
      {busy ? '…' : 'Löschen'}
    </button>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function VmTable({ vms, userRole, onRefresh, viewMode = 'compact' }) {
  const [snapshotVm, setSnapshotVm] = useState(null)
  const [feedback, setFeedback]     = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(null)

  const [sortCol, setSortCol] = useState(() => {
    try { return JSON.parse(localStorage.getItem('p3-vmtable-sort'))?.col ?? 'id' } catch { return 'id' }
  })
  const [sortDir, setSortDir] = useState(() => {
    try { return JSON.parse(localStorage.getItem('p3-vmtable-sort'))?.dir ?? 'asc' } catch { return 'asc' }
  })

  const [selected, setSelected] = useState(new Set())
  const [sshState, setSshState] = useState({})

  const vmIps = useVmIps(vms)

  const ownerResources = useMemo(() =>
    vms
      .filter(vm => vm.portal_node_id != null && !isTemplate(vm))
      .map(vm => ({ resource_type: vm.type === 'lxc' ? 'lxc' : 'vm', node_id: vm.portal_node_id, vmid: vm.vmid })),
    [vms]
  )
  const { data: bulkOwners } = useBulkOwners(ownerResources)

  const isOperator = userRole === 'operator' || userRole === 'admin'
  const isAdmin    = userRole === 'admin'
  const isCompact  = viewMode === 'compact'

  // True for VMs where the user has explicit RBAC permissions (non-null means assigned)
  const vmHasRbac = (vm) => Array.isArray(vm.permissions)

  const showOk  = (msg) => setFeedback({ type: 'ok',  msg })
  const showErr = (msg) => setFeedback({ type: 'err', msg })

  // ── sorting ────────────────────────────────────────────────────────────────

  function handleSort(col) {
    const newDir = sortCol === col && sortDir === 'asc' ? 'desc' : 'asc'
    setSortCol(col)
    setSortDir(newDir)
    try { localStorage.setItem('p3-vmtable-sort', JSON.stringify({ col, dir: newDir })) } catch (e) { void e }
  }

  const sortedVms = useMemo(() => {
    return [...vms].sort((a, b) => {
      const va = vmSortKey(a, sortCol)
      const vb = vmSortKey(b, sortCol)
      if (typeof va === 'number' && typeof vb === 'number') {
        return sortDir === 'asc' ? va - vb : vb - va
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
  }, [vms, sortCol, sortDir])

  // ── multi-select ───────────────────────────────────────────────────────────

  const selectableVms = vms.filter(vm => !isTemplate(vm) && isOperator && canDo(vm, 'start'))
  const allSelected   = selectableVms.length > 0 && selectableVms.every(vm => selected.has(vmKey(vm)))
  const someSelected  = selectableVms.some(vm => selected.has(vmKey(vm)))

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(selectableVms.map(vm => vmKey(vm))))
  }

  function toggleVm(vm) {
    const k = vmKey(vm)
    const next = new Set(selected)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    setSelected(next)
  }

  // ── SSH auto-check ────────────────────────────────────────────────────────

  const autoChecked = useRef(new Set())

  useEffect(() => {
    vms.forEach(vm => {
      if (vm.status !== 'running' || isTemplate(vm)) return
      const k = vmKey(vm)
      const ip = vmIps[k]
      if (!ip) return
      if (autoChecked.current.has(k)) return
      if (sshState[k] != null) return
      autoChecked.current.add(k)
      setSshState(prev => ({ ...prev, [k]: 'checking' }))
      checkVmSsh(vm.node, vm.vmid, ip)
        .then(res => setSshState(prev => ({ ...prev, [k]: res.reachable ? 'reachable' : 'unreachable' })))
        .catch(()  => setSshState(prev => ({ ...prev, [k]: 'unreachable' })))
    })
  }, [vmIps]) // eslint-disable-line react-hooks/exhaustive-deps

  async function triggerSshCheck(vm) {
    const k = vmKey(vm)
    const ip = vmIps[k]
    if (!ip) {
      setSshState(prev => ({ ...prev, [k]: 'unreachable' }))
      return
    }
    setSshState(prev => ({ ...prev, [k]: 'checking' }))
    try {
      const res = await checkVmSsh(vm.node, vm.vmid, ip)
      setSshState(prev => ({ ...prev, [k]: res.reachable ? 'reachable' : 'unreachable' }))
    } catch {
      setSshState(prev => ({ ...prev, [k]: 'unreachable' }))
    }
  }

  function handleBulkDone() {
    setSelected(new Set())
    setTimeout(() => onRefresh?.(), 3000)
  }

  if (vms.length === 0) {
    return <p className="text-gray-500 dark:text-zinc-500 text-sm">Keine VMs gefunden.</p>
  }

  const thBase = 'px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-500 uppercase tracking-wider'

  return (
    <>
      {feedback && (
        <div className={`mb-3 text-sm px-3 py-2 border ${
          feedback.type === 'ok'
            ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/40 border-green-200 dark:border-green-800'
            : 'text-red-400 bg-red-950/40 border-red-800'
        }`}>
          <span>{feedback.msg}</span>
          <button onClick={() => setFeedback(null)} className="btn-ghost ml-3" aria-label="Schließen">✕</button>
        </div>
      )}

      {selected.size > 0 && (
        <BulkActionToolbar
          selected={selected}
          vms={vms}
          vmIps={vmIps}
          onDone={handleBulkDone}
          onSshUpdate={(updates) => setSshState(prev => ({ ...prev, ...updates }))}
        />
      )}

      <div className="overflow-x-auto border border-gray-200 dark:border-zinc-700 rounded-lg">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className={`border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900 ${thBase}`}>
              {isOperator && (
                <th className="px-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    onChange={toggleAll}
                    disabled={selectableVms.length === 0}
                    className="w-3.5 h-3.5 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                    aria-label="Alle auswählen"
                  />
                </th>
              )}
              <SortableTh col="id"     label="ID"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={thBase} />
              <SortableTh col="name"   label="Name"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={thBase} />
              <SortableTh col="type"   label="Typ"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={thBase} />
              <SortableTh col="node"   label="Node"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={thBase} />
              <SortableTh col="status" label="Status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={thBase} />
              <th className={`${thBase} text-center`} title="SSH-Erreichbarkeit">SSH</th>
              <SortableTh col="cpu"    label="CPU"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={`${thBase} text-right`} />
              <SortableTh col="mem"    label="RAM"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={`${thBase} text-right`} />
              {!isCompact && (
                <SortableTh col="uptime" label="Uptime" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className={`${thBase} hidden md:table-cell text-right`} />
              )}
              {!isCompact && <th className={thBase}>IP</th>}
              <th className={thBase}>Eigentümer</th>
              {(isOperator || sortedVms.some(vmHasRbac)) && <th className={thBase}>Aktionen</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-zinc-700/50">
            {sortedVms.map((vm) => {
              const k = vmKey(vm)
              const tmpl = isTemplate(vm)
              const isSelectable = !tmpl && isOperator && canDo(vm, 'start')
              const isChecked = selected.has(k)
              const ip = vmIps[k]
              const ssh = sshState[k] ?? null

              return (
                <tr
                  key={k}
                  className={`group bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors ${tmpl ? 'opacity-70' : ''}`}
                >
                  {isOperator && (
                    <td className="px-3 py-3">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleVm(vm)}
                        disabled={!isSelectable}
                        className="w-3.5 h-3.5 accent-blue-600 cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                        aria-label={`${vm.name ?? vm.vmid} auswählen`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 text-gray-500 dark:text-zinc-400 tabular-nums">{vm.vmid}</td>
                  <td className="px-4 py-3 font-medium">
                    <Link
                      to={`/vm/${vm.node}/${vm.type ?? 'qemu'}/${vm.vmid}`}
                      className="text-gray-900 dark:text-white hover:text-orange-500 dark:hover:text-orange-400 transition-colors"
                    >
                      {vm.name ?? `VM ${vm.vmid}`}
                    </Link>
                    {isCompact && vm.status === 'running' && !tmpl && (
                      <div className="flex items-center gap-1 mt-0.5">
                        {ip === undefined
                          ? <span className="text-[11px] text-gray-400 dark:text-zinc-600 animate-pulse">…</span>
                          : ip
                            ? <>
                                <span className="text-[11px] text-gray-400 dark:text-zinc-500 tabular-nums">{ip}</span>
                                <CopyIpButton ip={ip} />
                              </>
                            : <span className="text-[11px] text-gray-400 dark:text-zinc-600">–</span>
                        }
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3"><TypeBadge vm={vm} /></td>
                  <td className="px-4 py-3 text-gray-700 dark:text-zinc-300">{vm.node}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={vm.status} />
                    {isCompact && vm.status === 'running' && (
                      <div className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5 tabular-nums">
                        {uptimeLabel(vm.uptime)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {vm.status === 'running' && !tmpl ? (
                      <SshIcon
                        state={ssh}
                        onClick={() => triggerSshCheck(vm)}
                        disabled={ssh === 'checking'}
                      />
                    ) : (
                      <span className="text-gray-300 dark:text-zinc-700 text-xs">–</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-zinc-300 tabular-nums">
                    {vm.status === 'running' ? `${((vm.cpu ?? 0) * 100).toFixed(1)}%` : '–'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-zinc-300 tabular-nums">
                    {vm.status === 'running' ? fmt(vm.mem) : '–'}
                  </td>
                  {!isCompact && (
                    <td className="px-4 py-3 text-right text-gray-500 dark:text-zinc-400 tabular-nums hidden md:table-cell">
                      {vm.status === 'running' ? uptimeLabel(vm.uptime) : '–'}
                    </td>
                  )}
                  {!isCompact && (
                    <td className="px-4 py-3 text-gray-600 dark:text-zinc-400 tabular-nums text-xs">
                      {vm.status !== 'running' || tmpl
                        ? <span className="text-gray-400 dark:text-zinc-600">–</span>
                        : ip === undefined
                          ? <span className="text-gray-400 dark:text-zinc-600 animate-pulse">…</span>
                          : ip
                            ? <span title={ip}>{ip}</span>
                            : <span className="text-gray-400 dark:text-zinc-600">–</span>
                      }
                    </td>
                  )}
                  <td className="px-4 py-3">
                    {(() => {
                      if (!vm.portal_node_id || tmpl) return <span className="text-gray-300 dark:text-zinc-700 text-xs">–</span>
                      const entry = bulkOwners?.find(e => e.node_id === vm.portal_node_id && e.vmid === vm.vmid)
                      return <OwnerColumn owners={entry?.owners ?? []} />
                    })()}
                  </td>

                  {(isOperator || vmHasRbac(vm)) && (
                    <td className="px-4 py-3">
                      {tmpl ? (
                        <span className="text-xs text-gray-400 dark:text-zinc-600">–</span>
                      ) : isCompact ? (
                        <div className="flex items-center gap-1">
                          <VmActionButtons
                            vm={vm}
                            compact
                            onSuccess={(msg) => { showOk(msg); setTimeout(() => onRefresh?.(), 5000) }}
                            onError={showErr}
                          />
                          <OverflowMenu items={[
                            ...(canDo(vm, 'snapshot') ? [{ label: 'Snapshots', onClick: () => setSnapshotVm(vm) }] : []),
                            ...((isAdmin || vmHasRbac(vm)) && canDo(vm, 'delete') ? [{ label: 'Löschen', onClick: () => setDeleteTarget(vm), danger: true }] : []),
                          ]} />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          <VmActionButtons
                            vm={vm}
                            onSuccess={(msg) => { showOk(msg); setTimeout(() => onRefresh?.(), 5000) }}
                            onError={showErr}
                          />
                          {canDo(vm, 'snapshot') && (
                            <button onClick={() => setSnapshotVm(vm)} className="btn-table">
                              Snapshots
                            </button>
                          )}
                          {(isAdmin || vmHasRbac(vm)) && canDo(vm, 'delete') && (
                            <DeleteVmButton
                              vm={vm}
                              onRequestDelete={setDeleteTarget}
                              busy={deleteBusy === vm.vmid}
                            />
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {snapshotVm && (
        <SnapshotModal vm={snapshotVm} onClose={() => setSnapshotVm(null)} />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="VM löschen"
          body={`VM „${deleteTarget.name || deleteTarget.vmid}" wirklich löschen?`}
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={async () => {
            const vm = deleteTarget
            setDeleteTarget(null)
            setDeleteBusy(vm.vmid)
            try {
              await deleteVm(vm.vmid, vm.node)
              showOk(`VM ${vm.vmid} wird gelöscht.`)
              onRefresh?.()
            } catch (err) {
              const s = err.response?.status
              const d = err.response?.data?.detail
              showErr(
                s === 403 ? 'Keine Berechtigung zum Löschen.' :
                s === 404 ? 'VM nicht gefunden.' :
                d ?? 'Fehler beim Löschen der VM.'
              )
            } finally {
              setDeleteBusy(null)
            }
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
