// p3portal.org
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import VmTable from './VmTable'
import { fetchMyPermissions } from '../../api/rbac'
import { useAuth } from '../../hooks/useAuth'

const SKELETON_ROWS = 4

function isTmpl(vm) {
  return vm.template === 1 || vm.template === true
}

const thBase = 'px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider'

function TmplBadge({ vm }) {
  const label = vm.type === 'lxc' ? 'tmpl/CT' : 'tmpl'
  return (
    <span className="text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-1.5 py-0.5 border border-purple-200 dark:border-purple-800">
      {label}
    </span>
  )
}

function formatCtime(ctime) {
  if (!ctime) return '–'
  return new Date(ctime * 1000).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function NodeFilter({ vms, statusFilter, onStatusChange, selectedNode, onNodeSelect, search, onSearch, viewMode, onToggleView }) {
  const nodeOptions = useMemo(() => {
    const portalNodes = new Set()
    const pveNodes = new Set()
    vms.forEach(vm => {
      if (vm.portal_node_name) portalNodes.add(vm.portal_node_name)
      if (vm.node) pveNodes.add(vm.node)
    })
    if (portalNodes.size > 0) return [...portalNodes].sort()
    return [...pveNodes].sort()
  }, [vms])

  const hasMultipleNodes = nodeOptions.length > 1

  function handleAll() {
    onNodeSelect?.(null)
    onStatusChange('ALL')
  }

  const filterBtnCls = (active) =>
    `text-xs px-3 py-1 border transition-colors ${active
      ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400'
      : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-gray-400'}`

  return (
    <div className="flex items-center gap-1 mb-3 flex-wrap">
      <button onClick={handleAll} className={filterBtnCls(!selectedNode && statusFilter === 'ALL')}>
        Alle
      </button>
      <button onClick={() => onStatusChange('RUNNING')} className={`text-xs px-3 py-1 border transition-colors ${statusFilter === 'RUNNING' ? 'border-green-500 bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400' : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-gray-400'}`}>
        Running
      </button>
      <button onClick={() => onStatusChange('STOPPED')} className={`text-xs px-3 py-1 border transition-colors ${statusFilter === 'STOPPED' ? 'border-gray-500 bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300' : 'border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-gray-400'}`}>
        Stopped
      </button>
      {hasMultipleNodes && (
        <select
          value={selectedNode ?? ''}
          onChange={e => onNodeSelect?.(e.target.value || null)}
          className={`text-xs border bg-white dark:bg-zinc-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-500 transition-colors ${
            selectedNode
              ? 'border-orange-500 text-orange-700 dark:text-orange-400'
              : 'border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300'
          }`}
        >
          <option value="">Node ▼</option>
          {nodeOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      )}

      <div className="flex items-center gap-1 ml-auto">
        <input
          type="search"
          value={search}
          onChange={e => onSearch(e.target.value)}
          placeholder="Name oder ID…"
          className="text-xs border bg-white dark:bg-zinc-800 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-500 border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 w-40"
        />
        <button
          onClick={onToggleView}
          title={viewMode === 'compact' ? 'Klassische Ansicht' : 'Kompakte Ansicht'}
          className="text-xs px-2 py-1 border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-400 hover:border-gray-400 transition-colors whitespace-nowrap"
        >
          {viewMode === 'compact' ? 'Klassisch' : 'Kompakt'}
        </button>
      </div>
    </div>
  )
}

export default function VmSection({ vms, loading, userRole, onRefresh, selectedNode, onNodeSelect }) {
  const { auth_type } = useAuth()
  const { data: rbacPerms } = useQuery({
    queryKey: ['rbac-my-permissions'],
    queryFn: fetchMyPermissions,
    enabled: auth_type === 'local',
    staleTime: 120_000,
  })

  // Merge RBAC permissions into each VM for users without global operator/admin role.
  // bypass=true means admin or proxmox-user → canDo logic handles them via isOperator.
  const enrichedVms = useMemo(() => {
    if (!rbacPerms || rbacPerms.bypass) return vms
    return vms.map(vm => {
      const vmType = vm.type === 'lxc' ? 'lxc' : 'vm'
      const matching = rbacPerms.assignments.filter(a =>
        a.resource_type === vmType &&
        a.resource_id === vm.vmid &&
        (a.portal_node_id == null || a.portal_node_id === vm.portal_node_id)
      )
      if (matching.length === 0) return vm
      const merged = [...new Set(matching.flatMap(a => a.permissions))]
      return { ...vm, permissions: merged }
    })
  }, [vms, rbacPerms])

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('widget_vms_collapsed') === 'true'
  )
  const [tmplCollapsed, setTmplCollapsed] = useState(
    () => localStorage.getItem('widget_templates_collapsed') !== 'false'
  )
  const [statusFilter, setStatusFilter] = useState(() => {
    const stored = localStorage.getItem('vm-filter') || 'ALL'
    return stored.startsWith('NODE:') ? 'ALL' : stored
  })
  const [viewMode, setViewMode] = useState(
    () => localStorage.getItem('p3-vmtable-view') || 'compact'
  )
  const [search, setSearch] = useState('')

  function handleStatusChange(val) {
    setStatusFilter(val)
    localStorage.setItem('vm-filter', val)
  }

  function handleToggleView() {
    const next = viewMode === 'compact' ? 'classic' : 'compact'
    setViewMode(next)
    localStorage.setItem('p3-vmtable-view', next)
  }

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('widget_vms_collapsed', String(next))
  }

  function toggleTmpl() {
    const next = !tmplCollapsed
    setTmplCollapsed(next)
    localStorage.setItem('widget_templates_collapsed', String(next))
  }

  const regularVms  = enrichedVms.filter(vm => !isTmpl(vm))
  const templateVms = enrichedVms.filter(vm => isTmpl(vm)).sort((a, b) => a.vmid - b.vmid)

  const filteredVms = useMemo(() => {
    let result = regularVms
    if (selectedNode) {
      result = result.filter(vm => vm.node === selectedNode || vm.portal_node_name === selectedNode)
    }
    if (statusFilter === 'RUNNING') result = result.filter(vm => vm.status === 'running')
    if (statusFilter === 'STOPPED') result = result.filter(vm => vm.status === 'stopped')
    return result
  }, [regularVms, selectedNode, statusFilter])

  const searchedVms = useMemo(() => {
    if (!search.trim()) return filteredVms
    const q = search.trim().toLowerCase()
    return filteredVms.filter(vm =>
      (vm.name ?? '').toLowerCase().includes(q) ||
      String(vm.vmid).includes(q)
    )
  }, [filteredVms, search])

  return (
    <>
      <section>
        <button
          onClick={toggle}
          className="flex items-center gap-1.5 w-full text-left mb-3 group"
          aria-expanded={!collapsed}
        >
          <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
            Virtuelle Maschinen ({regularVms.length})
          </span>
          <span className={`text-gray-400 dark:text-zinc-600 text-[10px] transition-transform duration-150 group-hover:text-gray-600 dark:group-hover:text-zinc-400 ${collapsed ? '-rotate-90' : ''}`}>
            ▼
          </span>
        </button>

        {!collapsed && (
          loading && vms.length === 0 ? (
            <div className="border border-gray-200 dark:border-zinc-700 overflow-hidden rounded-lg">
              <div className="divide-y divide-gray-100 dark:divide-zinc-700/50">
                {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <div key={i} className="bg-gray-100 dark:bg-zinc-800 h-12 animate-pulse" />
                ))}
              </div>
            </div>
          ) : (
            <>
              <NodeFilter
                vms={regularVms}
                statusFilter={statusFilter}
                onStatusChange={handleStatusChange}
                selectedNode={selectedNode}
                onNodeSelect={onNodeSelect}
                search={search}
                onSearch={setSearch}
                viewMode={viewMode}
                onToggleView={handleToggleView}
              />
              <VmTable vms={searchedVms} userRole={userRole} onRefresh={onRefresh} viewMode={viewMode} />
            </>
          )
        )}
      </section>

      {templateVms.length > 0 && (
        <section className="mt-6">
          <button
            onClick={toggleTmpl}
            className="flex items-center gap-1.5 w-full text-left mb-3 group"
            aria-expanded={!tmplCollapsed}
          >
            <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
              Templates ({templateVms.length})
            </span>
            <span className={`text-gray-400 dark:text-zinc-600 text-[10px] transition-transform duration-150 group-hover:text-gray-600 dark:group-hover:text-zinc-400 ${tmplCollapsed ? '-rotate-90' : ''}`}>
              ▼
            </span>
          </button>

          {!tmplCollapsed && (
            <div className="overflow-x-auto border border-gray-200 dark:border-zinc-700 rounded-lg">
              <table className="w-full text-sm text-left">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-zinc-700">
                    <th className={thBase}>ID</th>
                    <th className={thBase}>Name</th>
                    <th className={thBase}>Typ</th>
                    <th className={thBase}>Node</th>
                    <th className={thBase}>Erstellt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-700/50">
                  {templateVms.map(vm => (
                    <tr
                      key={`${vm.node}/${vm.vmid}`}
                      className="bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors opacity-75"
                    >
                      <td className="px-4 py-2 text-gray-500 dark:text-zinc-400 tabular-nums text-xs">{vm.vmid}</td>
                      <td className="px-4 py-2 text-gray-900 dark:text-white text-sm">{vm.name ?? `VM ${vm.vmid}`}</td>
                      <td className="px-4 py-2"><TmplBadge vm={vm} /></td>
                      <td className="px-4 py-2 text-gray-600 dark:text-zinc-400 text-xs">{vm.node}</td>
                      <td className="px-4 py-2 text-gray-500 dark:text-zinc-400 tabular-nums text-xs">{formatCtime(vm.ctime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  )
}
