// p3portal.org
// PROJ-57: /help – zentrales P3 Handbuch mit kategorisierter Übersicht und Volltextsuche.
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHelpOverridesMe, useHelpOverridesGlobal } from './hooks'
import { HELP_CATEGORIES, getRegistryByCategory } from './registry'
import { resolveHelpContent } from './helpResolver'
import { getRepoBundleMap } from './components/HelpMarkdownView'
import { useHelpSlideOver } from './components/HelpSlideOverContext'
import HelpButton from './components/HelpButton'
import Watermark from '../../components/common/Watermark'

// Einmalig laden
let _repoBundle = null
function getBundle() {
  if (!_repoBundle) _repoBundle = getRepoBundleMap()
  return _repoBundle
}

export default function HelpPage() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.split('-')[0] || 'de'
  const [search, setSearch] = useState('')
  const { open } = useHelpSlideOver()

  const { data: overridesMe = [] }     = useHelpOverridesMe()
  const { data: overridesGlobal = [] } = useHelpOverridesGlobal()
  const repoBundle = getBundle()

  const byCategory = getRegistryByCategory()

  // Suche: filtert Key + Titel (client-seitig, AC-INDEX-3)
  const filtered = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    const result = {}
    for (const [catId, entries] of Object.entries(byCategory)) {
      const hits = entries.filter(e => {
        const title = lang === 'de' ? e.titleDe : e.titleEn
        if (title.toLowerCase().includes(q)) return true
        // Suche auch im Repo-Content
        const { content } = resolveHelpContent({ key: e.key, lang, overridesMe, overridesGlobal, repoBundle })
        return content?.toLowerCase().includes(q)
      })
      if (hits.length > 0) result[catId] = hits
    }
    return result
  }, [search, lang, overridesMe, overridesGlobal, repoBundle, byCategory])

  const displayCategories = filtered || byCategory
  const hasResults = Object.values(displayCategories).some(arr => arr.length > 0)

  return (
    <main className="flex-1 overflow-y-auto">
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-gray-900 dark:text-zinc-100">
            {t('help.page_title')}
          </h1>
          <HelpButton helpKey="help" />
        </div>
        <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">{t('help.page_description')}</p>
      </div>

      {/* Suchfeld */}
      <div className="relative">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
        </svg>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('help.search_placeholder')}
          className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-gray-900 dark:text-zinc-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}
      </div>

      {/* Keine Treffer */}
      {search && !hasResults && (
        <div className="text-center py-10 space-y-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
          </svg>
          <p className="text-sm font-medium text-gray-500 dark:text-zinc-400">
            {t('help.search_no_results', { query: search })}
          </p>
        </div>
      )}

      {/* Kategorien */}
      {Object.entries(displayCategories).map(([catId, entries]) => {
        if (entries.length === 0) return null
        const catLabel = lang === 'de' ? HELP_CATEGORIES[catId]?.de : HELP_CATEGORIES[catId]?.en
        return (
          <div key={catId}>
            <h2 className="text-xs font-semibold text-gray-400 dark:text-zinc-500 uppercase tracking-wide mb-2">
              {catLabel}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {entries.map(entry => {
                const title = lang === 'de' ? entry.titleDe : entry.titleEn
                const { source } = resolveHelpContent({ key: entry.key, lang, overridesMe, overridesGlobal, repoBundle })
                return (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => open(entry.key)}
                    className="flex items-center justify-between gap-3 text-left px-4 py-3 rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-[var(--accent)] hover:shadow-sm transition-all group"
                  >
                    <span className="text-sm text-gray-800 dark:text-zinc-200 group-hover:text-[var(--accent)] transition-colors truncate">
                      {title}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {source === 'user' && (
                        <span className="text-[10px] bg-portal-warn/10 text-portal-warn border border-portal-warn/30 rounded-full px-1.5 py-0.5">
                          {t('help.source.user')}
                        </span>
                      )}
                      {source === 'global' && (
                        <span className="text-[10px] bg-portal-info/10 text-portal-info border border-portal-info/30 rounded-full px-1.5 py-0.5">
                          {t('help.source.global')}
                        </span>
                      )}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-gray-300 dark:text-zinc-600 group-hover:text-[var(--accent)] transition-colors">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
      <Watermark />
    </div>
    </main>
  )
}
