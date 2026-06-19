// p3portal.org
// PROJ-84: Node-/installations-weite Discovery- + Onboarding-Sicht (Plus,
// manage_ansible_inventory). Listet ALLE QEMU+LXC einer Installation mit
// Managed-/Run-Scope-Status, onboardet sie einzeln + bulk ownership-frei über
// den Global-Key. Reine Anzeige dessen, was die Cluster-Sicht ohnehin zeigt.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getNodes } from '../../../api/cluster'
import { useDiscovery, useOnboardHost, useOnboardBulk } from '../hooks'
import ConnectivityTestButton from './ConnectivityTestButton'
import OnboardResultModal from './OnboardResultModal'
import OnboardingBlockModal from './OnboardingBlockModal'

function StatusBadges({ host }) {
  const { t } = useTranslation()
  const noIp = host.managed && !host.ip
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded border leading-none ${
          host.managed
            ? 'bg-portal-success/10 text-portal-success border-portal-success/30'
            : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700'
        }`}
      >
        {t(`ansible_inventory.group.${host.managed ? 'managed' : 'unmanaged'}`)}
      </span>
      {noIp && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border leading-none bg-portal-warn/10 text-portal-warn border-portal-warn/30">
          {t('ansible_inventory.group.no_ip')}
        </span>
      )}
      {host.managed && !host.in_run_scope && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border leading-none bg-portal-warn/10 text-portal-warn border-portal-warn/30"
          title={t('ansible_inventory.no_run_scope_hint')}
        >
          {t('ansible_inventory.no_run_scope')}
        </span>
      )}
    </span>
  )
}

export default function InstallationDiscoveryView() {
  const { t } = useTranslation()

  // ── Installationen (distinkte Portal-Nodes) aus der Cluster-Sicht ──────────
  const [installations, setInstallations] = useState([])
  const [installation, setInstallation] = useState(null)
  useEffect(() => {
    let active = true
    getNodes()
      .then((list) => {
        if (!active) return
        const seen = new Map()
        for (const n of Array.isArray(list) ? list : []) {
          const id = n.portal_node_id
          if (id == null || seen.has(id)) continue
          seen.set(id, { id, name: n.portal_node_name || n.node })
        }
        const arr = [...seen.values()]
        setInstallations(arr)
        setInstallation((prev) => (prev != null ? prev : arr[0]?.id ?? null))
      })
      .catch(() => { if (active) setInstallations([]) })
    return () => { active = false }
  }, [])

  const { data, isLoading, error } = useDiscovery(installation, installation != null)
  const hosts = useMemo(() => data?.hosts ?? [], [data])

  // ── Filter ─────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // all | managed | unmanaged
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return hosts.filter((h) => {
      if (statusFilter === 'managed' && !h.managed) return false
      if (statusFilter === 'unmanaged' && h.managed) return false
      if (!q) return true
      return (
        String(h.vmid).includes(q) ||
        (h.name || '').toLowerCase().includes(q) ||
        (h.proxmox_node || '').toLowerCase().includes(q)
      )
    })
  }, [hosts, query, statusFilter])

  // ── Auswahl + Onboarding ─────────────────────────────────────────────────
  const [selected, setSelected] = useState(() => new Set())
  const [includePoolKey, setIncludePoolKey] = useState(false)
  const [singleResult, setSingleResult] = useState(null)
  const [bulkResult, setBulkResult] = useState(null)
  const [showGlobalBlock, setShowGlobalBlock] = useState(false)
  const [bulkError, setBulkError] = useState(null)

  const onboardOne = useOnboardHost()
  const onboardMany = useOnboardBulk()

  // Auswahl zurücksetzen, wenn Installation/Liste wechselt.
  useEffect(() => { setSelected(new Set()) }, [installation, data])

  const toggle = (ref) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }
  const allRefs = filtered.map((h) => h.host_ref)
  const allSelected = allRefs.length > 0 && allRefs.every((r) => selected.has(r))
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allRefs))
  }

  const doSingle = async (h) => {
    try {
      const r = await onboardOne.mutateAsync({
        portalNodeId: h.portal_node_id, kind: h.kind, vmid: h.vmid, includePoolKey,
      })
      setSingleResult(r)
    } catch {
      setSingleResult({ block: '', key_count: 0, skipped_already_managed: false })
    }
  }

  const doBulk = async () => {
    setBulkError(null)
    const sel = filtered.filter((h) => selected.has(h.host_ref))
    if (sel.length === 0) return
    try {
      const r = await onboardMany.mutateAsync({
        hosts: sel.map((h) => ({ portal_node_id: h.portal_node_id, kind: h.kind, vmid: h.vmid })),
        includePoolKey,
      })
      setBulkResult(r)
      setSelected(new Set())
    } catch {
      setBulkError(true)
    }
  }

  return (
    <div className="space-y-3">
      {/* Installations-Auswahl (nur bei mehreren) */}
      {installations.length > 1 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-zinc-300">{t('ansible_inventory.installation')}</label>
          <select
            value={installation ?? ''}
            onChange={(e) => setInstallation(Number(e.target.value))}
            className="text-sm border border-gray-200 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900"
          >
            {installations.map((i) => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('ansible_inventory.discovery_search')}
          className="text-sm border border-gray-200 dark:border-zinc-700 rounded-md px-2 py-1 bg-white dark:bg-zinc-900 flex-1 min-w-[12rem]"
        />
        <div className="flex border border-gray-200 dark:border-zinc-700 text-xs rounded-md overflow-hidden">
          {['all', 'managed', 'unmanaged'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 transition-colors ${
                statusFilter === s
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
              }`}
            >
              {t(`ansible_inventory.filter.${s}`)}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-sm text-gray-400 dark:text-zinc-500">{t('common.loading')}</div>
      ) : error ? (
        <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {t('ansible_inventory.load_error')}
        </div>
      ) : data?.error === 'node_unreachable' ? (
        <p className="text-sm text-portal-warn">{t('ansible_inventory.discovery_unreachable')}</p>
      ) : data?.error === 'node_unknown' ? (
        <p className="text-sm text-portal-warn">{t('ansible_inventory.discovery_unknown')}</p>
      ) : hosts.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">{t('ansible_inventory.discovery_empty')}</p>
      ) : (
        <>
          {/* Bulk-Leiste */}
          <div className="flex flex-wrap items-center gap-3 border border-gray-200 dark:border-zinc-700 rounded-md px-3 py-2">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-300 cursor-pointer select-none">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 accent-orange-500" />
              {t('ansible_inventory.select_all')}
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-zinc-300 cursor-pointer select-none">
              <input type="checkbox" checked={includePoolKey} onChange={(e) => setIncludePoolKey(e.target.checked)} className="w-4 h-4 accent-orange-500" />
              {t('ansible_inventory.include_pool_key')}
            </label>
            <span className="text-xs text-gray-400 dark:text-zinc-500">{t('ansible_inventory.n_selected', { count: selected.size })}</span>
            <button
              type="button"
              onClick={doBulk}
              disabled={selected.size === 0 || onboardMany.isPending}
              className="btn-primary text-xs ml-auto"
            >
              {onboardMany.isPending ? t('ansible_inventory.onboarding') : t('ansible_inventory.onboard_n', { count: selected.size })}
            </button>
          </div>
          {bulkError && (
            <p className="text-xs text-portal-danger">{t('ansible_inventory.onboard_error')}</p>
          )}

          {/* Host-Liste */}
          <div className="border border-gray-200 dark:border-zinc-700 rounded-md overflow-hidden">
            <ul>
              {filtered.map((h) => (
                <li
                  key={h.host_ref}
                  className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 dark:border-zinc-800 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(h.host_ref)}
                    onChange={() => toggle(h.host_ref)}
                    className="w-4 h-4 accent-orange-500"
                    aria-label={`VM ${h.vmid}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate text-gray-900 dark:text-zinc-100">
                        {h.name || `VM ${h.vmid}`}
                      </span>
                      <span className="text-xs text-gray-400 dark:text-zinc-500 shrink-0">#{h.vmid}</span>
                      <StatusBadges host={h} />
                    </div>
                    <div className="text-xs text-gray-400 dark:text-zinc-500 truncate">
                      {h.ip ? <span className="font-mono">{h.ip}</span> : <span className="italic">{t('ansible_inventory.no_ip_reason')}</span>}
                      {' · '}{h.kind.toUpperCase()}
                      {h.proxmox_node && <>{' · '}{h.proxmox_node}</>}
                      {h.status && <>{' · '}{h.status}</>}
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    <ConnectivityTestButton host={h} />
                    <button type="button" onClick={() => doSingle(h)} disabled={onboardOne.isPending} className="btn-table text-xs">
                      {t('ansible_inventory.onboard')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {filtered.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-zinc-500">{t('ansible_inventory.discovery_no_match')}</p>
          )}
        </>
      )}

      {singleResult && (
        <OnboardResultModal single={singleResult} onClose={() => setSingleResult(null)} />
      )}
      {bulkResult && (
        <OnboardResultModal
          bulk={bulkResult}
          onClose={() => setBulkResult(null)}
          onShowBlock={() => { setShowGlobalBlock(true) }}
        />
      )}
      {showGlobalBlock && (
        <OnboardingBlockModal scope="global" globalOptIn onClose={() => setShowGlobalBlock(false)} />
      )}
    </div>
  )
}
