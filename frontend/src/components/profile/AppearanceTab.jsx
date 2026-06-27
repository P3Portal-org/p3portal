// p3portal.org
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../hooks/useTheme'
import { useThemes } from '../../hooks/useThemes'
import { useLanguages } from '../../hooks/useLanguages'
import { getPreferences, setPreferences } from '../../api/themes'

const PORTAL_DEFAULT = 'portal-default'

export default function AppearanceTab() {
  const { t, i18n } = useTranslation()
  const { setTheme } = useTheme()
  const { themes } = useThemes()
  const { languages } = useLanguages()

  const [themeChoice, setThemeChoice] = useState(PORTAL_DEFAULT)
  const [langChoice, setLangChoice] = useState(PORTAL_DEFAULT)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    getPreferences()
      .then(prefs => {
        setThemeChoice(prefs.theme_id ?? PORTAL_DEFAULT)
        setLangChoice(prefs.lang_code ?? PORTAL_DEFAULT)
      })
      .catch(() => {
        setThemeChoice(localStorage.getItem('p3-theme') ?? PORTAL_DEFAULT)
        setLangChoice(localStorage.getItem('p3-lang') ?? PORTAL_DEFAULT)
      })
  }, [])

  const handleThemeChange = (val) => {
    setThemeChoice(val)
    if (val !== PORTAL_DEFAULT) {
      setTheme(val)
    }
  }

  const handleLangChange = (val) => {
    setLangChoice(val)
    const code = val === PORTAL_DEFAULT ? 'de' : val
    i18n.changeLanguage(code)
    localStorage.setItem('p3-lang', code)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await setPreferences({
        theme_id: themeChoice,
        lang_code: langChoice,
      })
      setMsg({ text: t('appearance.theme_saved'), ok: true })
    } catch {
      setMsg({ text: t('common.error'), ok: false })
    } finally {
      setSaving(false)
      setTimeout(() => setMsg(null), 2500)
    }
  }

  const themeOptions = [
    { value: PORTAL_DEFAULT, label: t('appearance.portal_default') },
    ...themes.map(th => ({ value: th.id, label: th.name })),
  ]

  const langOptions = [
    { value: PORTAL_DEFAULT, label: t('appearance.portal_default') },
    ...languages.map(l => ({ value: l.code, label: l.name })),
  ]

  const selectCls = 'w-full text-sm px-3 py-2 rounded border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent'
  const labelCls = 'block text-xs font-medium text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1.5'

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
      <div className="space-y-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
          {t('appearance.appearance_title')}
        </h3>

        <div>
          <label className={labelCls}>{t('appearance.theme_label')}</label>
          <select
            value={themeChoice}
            onChange={e => handleThemeChange(e.target.value)}
            className={selectCls}
          >
            {themeOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelCls}>{t('appearance.language_label')}</label>
          <select
            value={langChoice}
            onChange={e => handleLangChange(e.target.value)}
            className={selectCls}
          >
            {langOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
          {msg && (
            <span className={`text-xs ${msg.ok ? 'text-portal-success' : 'text-portal-danger'}`}>{msg.text}</span>
          )}
        </div>
      </div>
    </div>
  )
}
