// p3portal.org
import { useMemo } from 'react'

function TypeBadge({ type }) {
  return type === 'lxc'
    ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300">LXC</span>
    : <span className="text-[10px] px-1.5 py-0.5 rounded border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300">VM</span>
}

export default function ComputeTemplatesTab({ vms = [], loading = false }) {
  const templates = useMemo(
    () => vms.filter(v => v.template === true || v.template === 1),
    [vms]
  )

  if (loading && templates.length === 0) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500">
        Keine Templates auf dieser Node
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700">
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider w-16">ID</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Name</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Typ</th>
            <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Storage</th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900">
          {templates.map(t => (
            <tr key={`${t.node}-${t.vmid}`} className="border-b border-gray-100 dark:border-zinc-800 last:border-0">
              <td className="px-4 py-2.5 text-xs font-mono text-gray-500 dark:text-zinc-500">{t.vmid}</td>
              <td className="px-4 py-2.5 text-xs text-gray-900 dark:text-zinc-100 max-w-[200px] truncate">{t.name ?? '–'}</td>
              <td className="px-4 py-2.5"><TypeBadge type={t.type} /></td>
              <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-400 font-mono">{t.disk_storage ?? '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
