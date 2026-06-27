// p3portal.org
// PROJ-57: Slide-Over-Panel für kontextuelle Hilfe.
// Features: Back-Stack, Z-index > Modal (z-[60]), Escape-Key, Klick außerhalb, Upload-Footer.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHelpSlideOver } from './HelpSlideOverContext'
import HelpMarkdownView, { getRepoBundleMap } from './HelpMarkdownView'
import HelpUploadSection from './HelpUploadSection'
import { resolveHelpContent } from '../helpResolver'
import { useHelpOverridesMe, useHelpOverridesGlobal, useDeleteOverride } from '../hooks'
import { REGISTRY_MAP } from '../registry'
import ConfirmModal from '../../../components/common/ConfirmModal'

// Einmalig zur Modul-Ladezeit gebaut – kein Overhead per Render
const REPO_BUNDLE = getRepoBundleMap()

export default function HelpSlideOver() {
  const { t, i18n } = useTranslation()
  const { isOpen, currentKey, canGoBack, close, popHistory, pushHistory } = useHelpSlideOver()
  const appLang = i18n.language?.split('-')[0] || 'de'
  const [lang, setLang] = useState(appLang)

  const { data: overridesMe = [] }      = useHelpOverridesMe()
  const { data: overridesGlobal = [] }  = useHelpOverridesGlobal()
  const deleteOverride = useDeleteOverride()
  const [confirmDelete, setConfirmDelete] = useState(null)

  // Escape-Key schließt Slide-Over (AC-UI-5)
  useEffect(() => {
    if (!isOpen) return
    const handle = (e) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [isOpen, close])

  if (!isOpen || !currentKey) return null

  const registryEntry = REGISTRY_MAP[currentKey]
  const title = registryEntry
    ? (lang === 'de' ? registryEntry.titleDe : registryEntry.titleEn)
    : currentKey

  const { content, source, languageFallback } = resolveHelpContent({
    key: currentKey,
    lang,
    overridesMe,
    overridesGlobal,
    repoBundle: REPO_BUNDLE,
  })

  // Eigener Override für aktuellen Key+Sprache (für "Auf Standard zurücksetzen")
  const myOverride = overridesMe.find(o => o.key === currentKey && o.lang === lang)

  const handleResetToDefault = async () => {
    if (!myOverride) return
    await deleteOverride.mutateAsync(myOverride.id)
    setConfirmDelete(null)
  }

  return (
    <>
      {/* Backdrop – Klick außerhalb schließt (AC-UI-5) */}
      <div
        className="fixed inset-0 bg-black/20 dark:bg-black/40 z-[59]"
        onClick={close}
        aria-hidden="true"
      />

      {/* Panel – Z-Index > Modal (z-50) damit Slide-Over über Modal liegt (AC-UI-8) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Hilfe: ${title}`}
        className="fixed right-0 top-0 h-full w-full sm:w-[480px] bg-white dark:bg-zinc-900 border-l border-gray-200 dark:border-zinc-700 shadow-2xl z-[60] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          {/* Back-Pfeil (AC-CROSSLINK-3) */}
          <button
            type="button"
            onClick={popHistory}
            disabled={!canGoBack}
            aria-label={t('help.back_to_previous')}
            className="btn-ghost p-1 disabled:opacity-30"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100 truncate">{title}</h2>
          </div>

          {/* Sprach-Toggle DE / EN */}
          <div className="flex items-center shrink-0 rounded-md overflow-hidden border border-gray-200 dark:border-zinc-700 text-xs">
            <button
              type="button"
              onClick={() => setLang('de')}
              className={`px-2 py-0.5 transition-colors ${lang === 'de' ? 'bg-[var(--accent)] text-white' : 'bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800'}`}
            >
              DE
            </button>
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`px-2 py-0.5 transition-colors ${lang === 'en' ? 'bg-[var(--accent)] text-white' : 'bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800'}`}
            >
              EN
            </button>
          </div>

          {/* Quellen-Badge */}
          <SourceBadge source={source} t={t} />

          {/* Schließen-Button */}
          <button type="button" onClick={close} className="btn-ghost p-1" aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Language-Fallback-Banner (AC-LANG-3) */}
        {languageFallback && (
          <div className="px-4 py-2 bg-portal-warn/10 text-portal-warn text-xs border-b border-portal-warn/20 shrink-0">
            {t('help.translation_pending_banner')}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {content ? (
            <HelpMarkdownView content={content} onCrossLink={pushHistory} />
          ) : (
            <NoHelpView t={t} />
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-zinc-800 shrink-0">
          {/* "Eigene Version"-Badge + Zurücksetzen */}
          {myOverride && (
            <div className="flex items-center justify-between mb-2">
              <span className="inline-flex items-center gap-1 text-xs bg-portal-warn/10 text-portal-warn border border-portal-warn/30 rounded-full px-2 py-0.5">
                {t('help.source.user')}
              </span>
              <button
                type="button"
                onClick={() => setConfirmDelete(myOverride)}
                className="text-xs text-portal-danger hover:underline"
              >
                {t('help.reset_to_default')}
              </button>
            </div>
          )}

          <HelpUploadSection
            helpKey={currentKey}
            currentLang={lang}
          />
        </div>
      </div>

      {/* Confirm-Dialog: Override löschen */}
      {confirmDelete && (
        <ConfirmModal
          isOpen
          title={t('help.reset_to_default')}
          message={t('help.reset_confirm_message')}
          variant="danger"
          onConfirm={handleResetToDefault}
          onCancel={() => setConfirmDelete(null)}
          busy={deleteOverride.isPending}
        />
      )}
    </>
  )
}

function SourceBadge({ source, t }) {
  if (source === 'none') return null
  const map = {
    user:   { label: t('help.source.user'),   cls: 'bg-portal-warn/10 text-portal-warn border-portal-warn/30' },
    global: { label: t('help.source.global'), cls: 'bg-portal-info/10 text-portal-info border-portal-info/30' },
    repo:   { label: t('help.source.repo'),   cls: 'bg-gray-50 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700' },
  }
  const { label, cls } = map[source] || map.repo
  return (
    <span className={`inline-flex items-center text-[10px] border rounded-full px-2 py-0.5 shrink-0 ${cls}`}>
      {label}
    </span>
  )
}

function NoHelpView({ t }) {
  return (
    <div className="flex flex-col items-center justify-center h-32 text-center gap-2">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300 dark:text-zinc-600">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" />
        <circle cx="12" cy="17" r="0.5" fill="currentColor" />
      </svg>
      <p className="text-sm text-gray-400 dark:text-zinc-500">{t('help.no_help_available')}</p>
    </div>
  )
}
