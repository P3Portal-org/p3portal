// p3portal.org
import { useState, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguages } from '../../hooks/useLanguages'
import { setGlobalDefaultLanguage, deleteLanguage } from '../../api/translations'
import { useCapability } from '../../hooks/useCapability'
import { PlusComponents } from '../../plus'

const LanguagesAdminActions = PlusComponents.LanguagesAdminActions

function LockClosed({ className }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="4" y="9" width="12" height="10" rx="2" />
      <path d="M7 9V6a3 3 0 0 1 6 0v3" />
      <circle cx="10" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

export default function LanguagesTab({ globalDefault, onDefaultChanged }) {
  const { t, i18n } = useTranslation()
  const { languages, loading, reload } = useLanguages()
  const isPlus = useCapability('language_change')
  const [msg, setMsg] = useState(null)

  const flash = (text, ok = true) => {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 2500)
  }

  const handleMessage = (text, ok = true) => flash(text, ok)

  const handleSetDefault = async (langCode) => {
    try {
      await setGlobalDefaultLanguage(langCode)
      onDefaultChanged?.(langCode)
      i18n.changeLanguage(langCode)
      localStorage.setItem('p3-lang', langCode)
      flash(t('appearance.default_set'))
    } catch {
      flash(t('common.error'), false)
    }
  }

  const handleDelete = async (langCode) => {
    if (!confirm(t('common.confirm') + '?')) return
    try {
      await deleteLanguage(langCode)
      await reload()
      flash(t('appearance.deleted'))
      if (i18n.language === langCode) i18n.changeLanguage('de')
    } catch {
      flash(t('common.error'), false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
          {t('appearance.language_tab')}
        </span>
        <div className="flex items-center gap-2">
          {msg && (
            <span className={`text-xs ${msg.ok ? 'text-portal-success' : 'text-portal-danger'}`}>{msg.text}</span>
          )}
          {isPlus && LanguagesAdminActions ? (
            <Suspense fallback={null}>
              <LanguagesAdminActions onReload={reload} onMessage={handleMessage} />
            </Suspense>
          ) : (
            <span title={t('appearance.no_plus')} className="cursor-default text-gray-400 dark:text-zinc-500">
              <LockClosed className="w-4 h-4" />
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('common.loading')}</p>
      ) : (
        <div className="space-y-2">
          {languages.map(lang => (
            <div
              key={lang.code}
              className="flex items-center gap-3 px-3 py-2.5 rounded border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-800"
            >
              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-gray-200 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 uppercase">
                {lang.code}
              </span>
              <div className="flex-1 min-w-0">
                <span className="text-sm text-gray-900 dark:text-zinc-100 font-medium">{lang.name}</span>
                {lang.is_builtin && (
                  <span className="ml-2 text-xs text-gray-400 dark:text-zinc-600">{t('appearance.builtin')}</span>
                )}
                {globalDefault === lang.code && (
                  <span className="ml-2 text-xs text-portal-accent">{t('appearance.current_default')}</span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleSetDefault(lang.code)}
                  className="btn-table"
                >
                  {t('appearance.set_as_default')}
                </button>
                {!lang.is_builtin && (
                  <button
                    onClick={() => handleDelete(lang.code)}
                    className="btn-table-danger"
                  >
                    {t('appearance.delete')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-gray-400 dark:text-zinc-600">{t('appearance.upload_lang_hint')}</p>
    </div>
  )
}
