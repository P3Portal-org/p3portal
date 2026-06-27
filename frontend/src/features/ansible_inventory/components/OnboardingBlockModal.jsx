// p3portal.org
// PROJ-83: Modal das den kanonischen Onboarding-Block (Service-User p3-ansible +
// NOPASSWD-sudo + Public Keys) sowie die cloud-init vendor-data zum Kopieren zeigt.
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchOnboardingBlock } from '../api'

function CopyButton({ text }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard nicht verfügbar */ }
  }
  return (
    <button type="button" onClick={copy} className="btn-table text-xs">
      {copied ? t('ansible_inventory.copied') : t('ansible_inventory.copy')}
    </button>
  )
}

export default function OnboardingBlockModal({ scope = 'user', scopeRef = null, globalOptIn = false, onClose }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchOnboardingBlock(scope, scopeRef, globalOptIn)
      .then(d => { if (active) { setData(d); setError(null) } })
      .catch(err => { if (active) setError(err) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [scope, scopeRef, globalOptIn])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-modal-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 id="onb-modal-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {t('ansible_inventory.onb_title')}
          </h2>
          <button onClick={onClose} className="btn-ghost" aria-label={t('common.close')}>✕</button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <p className="text-sm text-gray-700 dark:text-zinc-300">{t('ansible_inventory.onb_intro')}</p>

          {loading && (
            <div className="text-sm text-gray-400 dark:text-zinc-500">{t('common.loading')}</div>
          )}
          {error && (
            <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-sm text-portal-danger">
              {t('ansible_inventory.onb_error')}
            </div>
          )}

          {data && (
            <>
              {data.key_count === 0 && (
                <div className="border border-portal-warn/30 bg-portal-warn/10 px-3 py-2 text-xs text-portal-warn rounded-md">
                  {t('ansible_inventory.onb_no_keys')}
                </div>
              )}

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {t('ansible_inventory.onb_manual_title')}
                  </h3>
                  <CopyButton text={data.block} />
                </div>
                <p className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.onb_manual_hint')}</p>
                <pre className="text-[11px] leading-relaxed bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-md p-3 overflow-x-auto whitespace-pre text-gray-800 dark:text-zinc-200 max-h-72">
{data.block}
                </pre>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {t('ansible_inventory.onb_vendor_title')}
                  </h3>
                  <CopyButton text={data.vendor_data} />
                </div>
                <p className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.onb_vendor_hint')}</p>
                <pre className="text-[11px] leading-relaxed bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-md p-3 overflow-x-auto whitespace-pre text-gray-800 dark:text-zinc-200 max-h-72">
{data.vendor_data}
                </pre>
              </section>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex justify-end bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} className="btn-secondary">{t('common.close')}</button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
