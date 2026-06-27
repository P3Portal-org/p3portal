// p3portal.org
import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'

const STATUS_DOT = {
  running: 'bg-green-500',
  stopped: 'bg-gray-400 dark:bg-zinc-500',
  paused:  'bg-yellow-500',
}

function StatusBadge({ status }) {
  const dot = STATUS_DOT[status] ?? 'bg-gray-400'
  return (
    <span className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className="text-xs text-gray-600 dark:text-zinc-400 capitalize">{status}</span>
    </span>
  )
}

function TypeBadge({ type }) {
  return type === 'lxc'
    ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">LXC</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">VM</span>
}

function VmRow({ vm }) {
  const navigate = useNavigate()
  return (
    <tr
      className="group border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50 cursor-pointer transition-colors"
      onClick={() => navigate(`/vm/${vm.node}/${vm.type ?? 'qemu'}/${vm.vmid}`)}
    >
      <td className="px-4 py-2.5 text-xs font-mono text-gray-500 dark:text-zinc-500 w-16">{vm.vmid}</td>
      <td className="px-4 py-2.5 text-xs text-gray-900 dark:text-zinc-100 max-w-[180px] truncate group-hover:text-orange-500 dark:group-hover:text-orange-400 transition-colors">
        {vm.name ?? '–'}
      </td>
      <td className="px-4 py-2.5"><TypeBadge type={vm.type} /></td>
      <td className="px-4 py-2.5"><StatusBadge status={vm.status} /></td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400">
        {vm.cpu != null ? `${(vm.cpu * 100).toFixed(1)}%` : '–'}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400">
        {vm.mem && vm.maxmem
          ? `${(vm.mem / 1024 / 1024).toFixed(0)} / ${(vm.maxmem / 1024 / 1024).toFixed(0)} MB`
          : '–'}
      </td>
    </tr>
  )
}

export default function ComputeVmSection({ vms = [], loading = false }) {
  const [typeFilter, setTypeFilter] = useState('all')

  const nonTemplates = useMemo(() => vms.filter(v => !v.template), [vms])

  const filtered = useMemo(() => {
    if (typeFilter === 'vm')  return nonTemplates.filter(v => v.type === 'qemu')
    if (typeFilter === 'lxc') return nonTemplates.filter(v => v.type === 'lxc')
    return nonTemplates
  }, [nonTemplates, typeFilter])

  const btnCls = (active) =>
    `text-xs px-3 py-1 border transition-colors ${
      active
        ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400'
        : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-gray-400 dark:hover:border-zinc-500'
    }`

  if (loading && nonTemplates.length === 0) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter Toggle */}
      <div className="flex items-center gap-1">
        <button onClick={() => setTypeFilter('all')}  className={btnCls(typeFilter === 'all')}>Alle</button>
        <button onClick={() => setTypeFilter('vm')}   className={btnCls(typeFilter === 'vm')}>VMs</button>
        <button onClick={() => setTypeFilter('lxc')}  className={btnCls(typeFilter === 'lxc')}>LXC</button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">
          {typeFilter === 'lxc'
            ? 'Keine LXC Container auf dieser Node'
            : typeFilter === 'vm'
            ? 'Keine VMs auf dieser Node'
            : 'Keine VMs oder Container auf dieser Node'}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700">
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider w-16">ID</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Typ</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Status</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">CPU</th>
                <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">RAM</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-zinc-900">
              {filtered.map(vm => <VmRow key={`${vm.node}-${vm.vmid}`} vm={vm} />)}
            </tbody>
          </table>
        </div>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
