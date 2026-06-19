// p3portal.org
// PROJ-84: Ergebnis-Modal nach dem Onboarding bestehender Hosts.
//  - Einzel-Onboarding: zeigt den zurückgelieferten Onboarding-Block (Global-Key)
//    zum manuellen Einfügen im Gast (cloud-init greift bei bestehenden VMs nicht).
//  - Bulk-Onboarding: zeigt die Zähler (onboardet/übersprungen/fehlgeschlagen) +
//    eine Aktion, den (für alle identischen) Global-Onboarding-Block anzuzeigen.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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

/**
 * @param {object|null} single – { block, key_count, host_ref, skipped_already_managed }
 * @param {object|null} bulk   – { onboarded, skipped, failed:[{host_ref,reason}] }
 * @param {function} onClose
 * @param {function} [onShowBlock] – CTA für Bulk: Global-Onboarding-Block anzeigen
 */
export default function OnboardResultModal({ single = null, bulk = null, onClose, onShowBlock }) {
  const { t } = useTranslation()

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onb-result-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800 flex items-center justify-between">
          <h2 id="onb-result-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {t('ansible_inventory.onboard_result_title')}
          </h2>
          <button onClick={onClose} className="btn-ghost" aria-label={t('common.close')}>✕</button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {single && (
            <>
              <p className="text-sm text-gray-700 dark:text-zinc-300">
                {single.skipped_already_managed
                  ? t('ansible_inventory.onboard_already')
                  : t('ansible_inventory.onboard_single_done')}
              </p>
              {single.key_count === 0 && (
                <div className="border border-portal-warn/30 bg-portal-warn/10 px-3 py-2 text-xs text-portal-warn rounded-md">
                  {t('ansible_inventory.onboard_no_global_key')}
                </div>
              )}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {t('ansible_inventory.onb_manual_title')}
                  </h3>
                  <CopyButton text={single.block} />
                </div>
                <p className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.onboard_manual_hint')}</p>
                <pre className="text-[11px] leading-relaxed bg-gray-50 dark:bg-zinc-950 border border-gray-200 dark:border-zinc-700 rounded-md p-3 overflow-x-auto whitespace-pre text-gray-800 dark:text-zinc-200 max-h-72">
{single.block}
                </pre>
              </section>
            </>
          )}

          {bulk && (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="border border-portal-success/30 bg-portal-success/10 rounded-md py-3">
                  <div className="text-lg font-semibold text-portal-success">{bulk.onboarded}</div>
                  <div className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.bulk_onboarded')}</div>
                </div>
                <div className="border border-gray-200 dark:border-zinc-700 rounded-md py-3">
                  <div className="text-lg font-semibold text-gray-600 dark:text-zinc-300">{bulk.skipped}</div>
                  <div className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.bulk_skipped')}</div>
                </div>
                <div className="border border-portal-danger/30 bg-portal-danger/10 rounded-md py-3">
                  <div className="text-lg font-semibold text-portal-danger">{bulk.failed?.length ?? 0}</div>
                  <div className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.bulk_failed')}</div>
                </div>
              </div>

              {bulk.failed?.length > 0 && (
                <ul className="border border-portal-danger/30 rounded-md divide-y divide-gray-100 dark:divide-zinc-800 text-xs">
                  {bulk.failed.map((f) => (
                    <li key={f.host_ref} className="flex items-center justify-between px-3 py-1.5">
                      <span className="font-mono text-gray-700 dark:text-zinc-300">{f.host_ref}</span>
                      <span className="text-portal-danger">{f.reason}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.bulk_block_hint')}</p>
              {onShowBlock && (
                <button type="button" onClick={onShowBlock} className="btn-secondary text-xs">
                  {t('ansible_inventory.show_onboarding')}
                </button>
              )}
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
