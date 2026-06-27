// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Erzeugt einen URL-safe Base64-String (analog Python secrets.token_urlsafe(48)). */
function generateSecretKey() {
  const bytes = new Uint8Array(48)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export default function WizardStep1License({ onNext }) {
  const { t } = useTranslation()
  const [accepted, setAccepted] = useState(false)
  const [secretKey] = useState(() => generateSecretKey())
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(secretKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('setup.s1_title')}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.s1_subtitle')}
        </p>
      </div>

      {/* Hinweisbox */}
      <div className="bg-portal-warn/10 border border-portal-warn/30 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5 text-portal-warn shrink-0 mt-0.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <p className="text-sm font-semibold text-portal-warn">
            {t('setup.s1_warn_title')}
          </p>
        </div>
        <div className="text-sm text-portal-warn space-y-2 pl-8">
          <p>{t('setup.s1_warn_p1')}</p>
          <p>
            {t('setup.s1_warn_p2')}
          </p>
          <p>
            {t('setup.s1_warn_p3')}
          </p>
        </div>
      </div>

      {/* Info-Block */}
      <div className="bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 flex items-start gap-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5 text-zinc-400 shrink-0 mt-0.5">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('setup.s1_info')}{' '}
          <a href="https://p3portal.org" target="_blank" rel="noopener noreferrer" className="text-portal-accent hover:underline">
            p3portal.org
          </a>.
        </p>
      </div>

      {/* SECRET_KEY-Sicherheitshinweis */}
      <div className="bg-portal-info/10 border border-portal-info/30 rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5 text-portal-info shrink-0 mt-0.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="text-sm font-semibold text-portal-info">
            {t('setup.s1_secret_title')}
          </p>
        </div>
        <div className="text-sm text-portal-info space-y-2 pl-8">
          <p>{t('setup.s1_secret_p1')}</p>
          <p>{t('setup.s1_secret_p2')} <code className="font-mono bg-portal-info/15 px-1 rounded text-xs">.env</code></p>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 font-mono text-xs bg-portal-info/15 px-3 py-2 rounded break-all select-all">
              SECRET_KEY={secretKey}
            </code>
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 btn-secondary text-xs px-2 py-1"
              title={t('setup.s1_secret_copy')}
            >
              {copied ? '✓' : t('setup.s1_secret_copy')}
            </button>
          </div>
          <p className="text-xs text-portal-info">
            {t('setup.s1_secret_note')}
          </p>
        </div>
      </div>

      {/* Checkbox */}
      <label className="flex items-start gap-3 cursor-pointer group">
        <div className="relative mt-0.5 shrink-0">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="sr-only"
          />
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
              accepted
                ? 'bg-portal-accent border-portal-accent'
                : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 group-hover:border-portal-accent'
            }`}
          >
            {accepted && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 text-white">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
        </div>
        <span className="text-sm text-zinc-700 dark:text-zinc-300">
          {t('setup.s1_checkbox')}
        </span>
      </label>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={!accepted}
          onClick={() => onNext()}
          className="btn-primary"
        >
          {t('setup.next')}
        </button>
      </div>
    </div>
  )
}
