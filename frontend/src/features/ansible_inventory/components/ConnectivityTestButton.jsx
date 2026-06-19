// p3portal.org
// PROJ-84: Optionaler, informativer SSH-Verbindungstest als p3-ansible.
// Blockt nichts, setzt keinen Zustand. Für Hosts ohne IP nicht verfügbar
// (AC-VERIFY-3); Ergebnis wird inline als ✓/✗ + generische Ursache gezeigt.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTestConnection } from '../hooks'

export default function ConnectivityTestButton({ host }) {
  const { t } = useTranslation()
  const test = useTestConnection()
  const [result, setResult] = useState(null) // { ok, reason }
  const hasIp = !!host.ip

  const run = async () => {
    setResult(null)
    try {
      const r = await test.mutateAsync({
        portalNodeId: host.portal_node_id,
        kind: host.kind,
        vmid: host.vmid,
      })
      setResult(r)
    } catch {
      setResult({ ok: false, reason: 'error' })
    }
  }

  if (!hasIp) {
    return (
      <span className="text-[11px] italic text-gray-400 dark:text-zinc-500" title={t('ansible_inventory.test_no_ip')}>
        {t('ansible_inventory.test_unavailable')}
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-2">
      {result && (
        <span
          className={`text-[11px] font-medium ${result.ok ? 'text-portal-success' : 'text-portal-danger'}`}
          title={t(`ansible_inventory.test_reason.${result.reason}`, t('ansible_inventory.test_reason.error'))}
        >
          {result.ok ? '✓ ' : '✗ '}
          {t(`ansible_inventory.test_reason.${result.reason}`, t('ansible_inventory.test_reason.error'))}
        </span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={test.isPending}
        className="btn-table text-xs"
        title={t('ansible_inventory.test_connection')}
      >
        {test.isPending ? t('ansible_inventory.testing') : t('ansible_inventory.test_connection')}
      </button>
    </span>
  )
}
