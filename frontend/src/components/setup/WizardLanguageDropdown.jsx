// p3portal.org
import { useState } from 'react'
import i18n from '../../i18n'

const LANGS = [
  { code: 'en', label: 'EN' },
  { code: 'de', label: 'DE' },
]

export default function WizardLanguageDropdown() {
  const [open, setOpen] = useState(false)
  const current = LANGS.find((l) => l.code === i18n.language) ?? LANGS[0]

  const select = (code) => {
    i18n.changeLanguage(code)
    localStorage.setItem('p3-lang', code)
    setOpen(false)
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
        aria-label="Sprache wählen"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3.5 h-3.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        {current.label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg overflow-hidden min-w-[80px]">
            {LANGS.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => select(lang.code)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors ${
                  lang.code === current.code ? 'font-semibold text-portal-accent' : 'text-zinc-700 dark:text-zinc-300'
                }`}
              >
                {lang.code === 'en' ? 'English' : 'Deutsch'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
