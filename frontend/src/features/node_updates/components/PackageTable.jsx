// p3portal.org
// PROJ-73: Durchsuchbare, sortierbare Pakettabelle
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import SecurityBadge from './SecurityBadge'

export default function PackageTable({ packages, showNodeColumn = false }) {
  const { t }    = useTranslation()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q
      ? packages.filter(p => p.name.toLowerCase().includes(q))
      : packages
    // Security zuerst, dann alphabetisch
    return [...list].sort((a, b) => {
      if (a.is_security !== b.is_security) return a.is_security ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }, [packages, search])

  const hasManyRows = packages.length > 50

  return (
    <div className="space-y-3">
      {hasManyRows && (
        <div className="relative">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 dark:text-zinc-500 pointer-events-none"
            viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="9" cy="9" r="6"/><path d="m15 15 3 3"/>
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('nodeUpdates.search_placeholder')}
            className="w-full max-w-xs pl-8 pr-3 py-1.5 text-xs rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-800 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-xs text-gray-400 dark:text-zinc-500">
          {search ? t('nodeUpdates.no_search_results') : t('nodeUpdates.no_packages')}
        </p>
      ) : (
        <div className={`rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden ${hasManyRows ? 'max-h-[480px] overflow-y-auto' : ''}`}>
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50 dark:bg-zinc-800/80 border-b border-gray-200 dark:border-zinc-700">
                {showNodeColumn && (
                  <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                    {t('nodeUpdates.col_node')}
                  </th>
                )}
                <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  {t('nodeUpdates.col_package')}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  {t('nodeUpdates.col_old_version')}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  {t('nodeUpdates.col_new_version')}
                </th>
                <th className="px-3 py-2 text-left font-semibold text-[10px] uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                  {t('nodeUpdates.col_security')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
              {filtered.map((pkg, i) => (
                <tr
                  key={`${pkg.node_name ?? ''}-${pkg.name}-${i}`}
                  className={`hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors ${pkg.is_security ? 'bg-yellow-50/40 dark:bg-yellow-950/10' : ''}`}
                >
                  {showNodeColumn && (
                    <td className="px-3 py-2 font-mono text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                      {pkg.node_name ?? '–'}
                    </td>
                  )}
                  <td className="px-3 py-2 font-mono text-gray-800 dark:text-zinc-200 whitespace-nowrap">
                    {pkg.name}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-500 dark:text-zinc-400 whitespace-nowrap">
                    {pkg.version_old}
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-700 dark:text-zinc-300 whitespace-nowrap">
                    {pkg.version_new}
                  </td>
                  <td className="px-3 py-2">
                    {pkg.is_security && <SecurityBadge />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
