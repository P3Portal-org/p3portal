// p3portal.org
import { useState, useEffect, useCallback, useMemo, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useCapability } from '../hooks/useCapability'
import { useScheduledJobs } from '../hooks/useScheduledJobs'
import { getVmDetail, getVmBackups, getSnapshots, getVmGuestInfo, getLxcInterfaces } from '../api/vms'
import PinIcon from '../components/common/PinIcon'
import { usePinToggle } from '../features/sidebar_pins/hooks/usePinToggle'
import VmDetailHeader from '../components/vms/VmDetailHeader'
import VmResourceBars from '../components/vms/VmResourceBars'
import VmConfigSection from '../components/vms/VmConfigSection'
import VmSnapshotSection from '../components/vms/VmSnapshotSection'
import VmBackupSection from '../components/vms/VmBackupSection'
import VmGuestInfoSection from '../components/vms/VmGuestInfoSection'
import VmLxcNetworkSection from '../components/vms/VmLxcNetworkSection'
import VmAlertsTab from '../components/vms/VmAlertsTab'
import VmFirewallTab from '../components/firewall/VmFirewallTab'
import OwnerSection from '../features/owners/components/OwnerSection'
import Watermark from '../components/common/Watermark'
import { PlusComponents } from '../plus'

const ACTION_LABEL = { start: 'Starten', stop: 'Stoppen', reboot: 'Neustarten' }

function fmtDate(iso) {
  if (!iso) return '–'
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
}

function VmScheduledJobsTab({ vmid }) {
  const { jobs, loading } = useScheduledJobs()
  const vmJobs = useMemo(
    () => jobs.filter(j => j.job_type === 'power_action' && Number(j.config?.vmid) === Number(vmid)),
    [jobs, vmid],
  )

  const thCls = 'px-4 py-2.5 text-xs text-gray-500 dark:text-zinc-500 uppercase tracking-wider text-left'
  const tdCls = 'px-4 py-2.5 text-sm'

  if (loading) {
    return <div className="py-8 text-center text-sm text-gray-400 dark:text-zinc-500 animate-pulse">Lade…</div>
  }

  if (vmJobs.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-gray-400 dark:text-zinc-500">
        Keine zeitgesteuerten Jobs für diese VM.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto border border-gray-200 dark:border-zinc-700 rounded-lg">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900">
            <th className={thCls}>Name</th>
            <th className={thCls}>Aktion</th>
            <th className={thCls}>Cron</th>
            <th className={thCls}>Aktiv</th>
            <th className={thCls}>Letzter Lauf</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-700/50">
          {vmJobs.map(j => (
            <tr key={j.id} className="bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
              <td className={`${tdCls} font-medium text-gray-900 dark:text-white`}>{j.name}</td>
              <td className={tdCls}>
                <span className="text-xs px-2 py-0.5 rounded border border-gray-200 dark:border-zinc-700 text-gray-600 dark:text-zinc-300">
                  {ACTION_LABEL[j.config?.action] ?? j.config?.action ?? '–'}
                </span>
              </td>
              <td className={`${tdCls} font-mono text-xs text-gray-500 dark:text-zinc-400`}>{j.cron_expression}</td>
              <td className={tdCls}>
                <span className={`text-xs font-medium ${j.active ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-zinc-500'}`}>
                  {j.active ? 'Aktiv' : 'Inaktiv'}
                </span>
              </td>
              <td className={`${tdCls} text-gray-500 dark:text-zinc-400 tabular-nums`}>
                <span>{fmtDate(j.last_run_at)}</span>
                {j.last_run_status === 'success' && <span className="ml-1.5 text-green-500">✓</span>}
                {j.last_run_status === 'failed'  && <span className="ml-1.5 text-red-500">✗</span>}
                {j.last_run_status === 'running' && <span className="ml-1.5 text-orange-400 animate-pulse">⏳</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function errLabel(err) {
  const s = err?.response?.status
  if (s === 403) return 'Kein Zugriff auf diese VM.'
  if (s === 404) return 'VM nicht gefunden.'
  if (s === 503) return 'Service-Account nicht konfiguriert. Bitte Proxmox-Verbindung in den Einstellungen prüfen.'
  if (s === 502) return 'Proxmox API nicht erreichbar.'
  return err?.response?.data?.detail ?? 'Fehler beim Laden der VM-Details.'
}

export default function VmDetailPage() {
  const { t } = useTranslation()
  const { node, type, vmid } = useParams()
  const { role, username, portalPermissions } = useAuth()
  const hasConfigSnapshots = useCapability('config_snapshots')
  const ConfigSnapshotsTab = PlusComponents.ConfigSnapshotsTab
  // PROJ-96: VM-Abhängigkeiten (Plus). Anzeigen via Capability; Verwalten
  // zusätzlich via manage_dependencies (oder Admin).
  const hasDependencies = useCapability('vm_dependencies')
  const VmDependencySection = PlusComponents.VmDependencySection
  const canManageDependencies = (role === 'admin') || (portalPermissions ?? []).includes('manage_dependencies')
  const [activeTab, setActiveTab] = useState('overview')

  const pinRoute = `/vm/${node}/${type}/${vmid}`
  const { isPinned, loading: pinLoading, toggle: pinToggle, atLimit } = usePinToggle({
    route: pinRoute,
    pinKind: type === 'qemu' ? 'vm' : 'lxc',
    defaultLabel: '',
  })

  const isAdmin = role === 'admin'

  const [detail, setDetail]       = useState(null)
  const [backups, setBackups]     = useState(null)
  const [snapshots, setSnapshots] = useState(null)
  const [guestInfo, setGuestInfo] = useState(null)
  const [lxcIfaces, setLxcIfaces] = useState(null)

  const [detailErr, setDetailErr]   = useState(null)
  const [backupsErr, setBackupsErr] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [guestLoading, setGuestLoading] = useState(false)
  const [ifacesLoading, setIfacesLoading] = useState(false)

  const isOperator = role === 'operator' || role === 'admin'
  // PROJ-90: firewall tab gate (AC-UI-2 / AC-RBAC-2). The server enforces the real
  // boundary via _resolve_vm_access + _check_rbac("configure"); this only decides
  // whether to render the tab. Owners/operators/admins or manage_firewall holders.
  const canFirewall = isOperator || (portalPermissions ?? []).includes('manage_firewall')

  const loadAll = useCallback(async () => {
    setLoading(true)
    setDetailErr(null)
    setBackupsErr(null)
    setGuestInfo(null)
    setLxcIfaces(null)

    const [detailRes, backupsRes, snapshotsRes] = await Promise.allSettled([
      getVmDetail(node, type, vmid),
      getVmBackups(node, type, vmid),
      getSnapshots(vmid, node),
    ])

    if (detailRes.status === 'fulfilled') {
      setDetail(detailRes.value)
    } else {
      setDetailErr(detailRes.reason)
    }

    if (backupsRes.status === 'fulfilled') {
      setBackups(backupsRes.value)
    } else {
      setBackupsErr(backupsRes.reason)
    }

    if (snapshotsRes.status === 'fulfilled') {
      setSnapshots(snapshotsRes.value)
    } else {
      setSnapshots([])
    }

    setLoading(false)

    // Parallel: Guest-Info (QEMU) oder LXC-Interfaces laden
    if (type === 'qemu') {
      setGuestLoading(true)
      try {
        const info = await getVmGuestInfo(node, vmid)
        setGuestInfo(info)
      } catch {
        setGuestInfo(null)
      } finally {
        setGuestLoading(false)
      }
    } else if (type === 'lxc') {
      setIfacesLoading(true)
      try {
        const ifaces = await getLxcInterfaces(node, vmid)
        setLxcIfaces(ifaces)
      } catch {
        setLxcIfaces([])
      } finally {
        setIfacesLoading(false)
      }
    }
  }, [node, type, vmid])

  useEffect(() => { loadAll() }, [loadAll])

  const reloadBackups = useCallback(async () => {
    try {
      setBackups(await getVmBackups(node, type, vmid))
      setBackupsErr(null)
    } catch (err) {
      setBackupsErr(err)
    }
  }, [node, type, vmid])

  const reloadSnapshots = useCallback(async () => {
    try {
      setSnapshots(await getSnapshots(vmid, node))
    } catch {
      setSnapshots([])
    }
  }, [vmid, node])

  const reloadDetail = useCallback(async () => {
    try {
      setDetail(await getVmDetail(node, type, vmid))
    } catch (err) {
      setDetailErr(err)
    }
  }, [node, type, vmid])

  // Hard error on detail load (404/403/503)
  if (!loading && detailErr) {
    const s = detailErr?.response?.status
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <header className="h-12 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
          <Link
            to="/dashboard"
            className="text-xs text-orange-500 hover:text-orange-600 flex items-center gap-1"
          >
            ← Dashboard
          </Link>
        </header>
        <main className="flex-1 flex items-center justify-center bg-transparent px-6">
          <div className={`max-w-md w-full rounded-lg border px-6 py-5 text-sm ${
            s === 403 || s === 404
              ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400'
              : 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/40 text-yellow-700 dark:text-yellow-400'
          }`}>
            <p className="font-medium mb-1">{s === 403 ? 'Zugriff verweigert' : s === 404 ? 'VM nicht gefunden' : 'Verbindungsfehler'}</p>
            <p className="text-xs opacity-80">{errLabel(detailErr)}</p>
          </div>
        </main>
      </div>
    )
  }

  const tabCls = (tab) =>
    `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === tab
        ? 'border-orange-500 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Page header */}
      <header className="flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-4 h-12">
          <Link
            to="/dashboard"
            className="text-xs text-orange-500 hover:text-orange-600 flex items-center gap-1 transition-colors"
          >
            ← Dashboard
          </Link>
          {detail && (
            <button
              onClick={pinToggle}
              disabled={pinLoading || (atLimit && !isPinned)}
              className="p-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
              title={atLimit && !isPinned ? 'Pin-Limit erreicht' : isPinned ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
            >
              <PinIcon pinned={isPinned} disabled={atLimit && !isPinned} className="w-4 h-4" />
            </button>
          )}
        </div>
        {detail && (
          <span className="text-xs text-gray-400 dark:text-zinc-500 tabular-nums">
            {node} · {type === 'qemu' ? 'VM' : 'CT'} {vmid}
          </span>
        )}
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 shrink-0">
        <button onClick={() => setActiveTab('overview')} className={tabCls('overview')}>
          Übersicht
        </button>
        <button onClick={() => setActiveTab('alerts')} className={tabCls('alerts')}>
          Alerts
        </button>
        <button onClick={() => setActiveTab('scheduled')} className={tabCls('scheduled')}>
          Zeitgesteuert
        </button>
        {canFirewall && (
          <button onClick={() => setActiveTab('firewall')} className={tabCls('firewall')}>
            Firewall
          </button>
        )}
        {hasConfigSnapshots && ConfigSnapshotsTab && (
          <button onClick={() => setActiveTab('config-snapshots')} className={tabCls('config-snapshots')}>
            Config-Snapshots
          </button>
        )}
      </div>

      <main className="flex-1 overflow-y-auto px-6 py-6 bg-transparent">
        {loading && !detail ? (
          <div className="flex items-center justify-center h-32">
            <span className="text-sm text-gray-400 dark:text-zinc-500 animate-pulse">Lade VM-Details…</span>
          </div>
        ) : detail ? (
          <>
            {activeTab === 'overview' && (
              <div className="space-y-6">

                {/* Header: name, badges, power buttons */}
                <VmDetailHeader
                  detail={detail}
                  isOperator={isOperator}
                  onActionSuccess={reloadDetail}
                />

                {/* PROJ-76 Phase 2b: Stack-Hinweis + Link (AC-2B-MUT-1 / AC-2B-UI-9) */}
                {detail.managed_by_stack && (
                  <div className="rounded-md border border-portal-accent/40 bg-portal-accent/10 px-4 py-2.5 text-sm text-portal-text flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-portal-accent/20 text-portal-accent">{t('stacks.managed_by.badge')}</span>
                    <span>
                      {t('stacks.managed_by.banner_prefix')}{' '}
                      <Link to={`/stacks/${detail.managed_by_stack.stack_id}`} className="font-medium text-portal-accent hover:underline">
                        {detail.managed_by_stack.stack_name}
                      </Link>{' '}
                      {t('stacks.managed_by.banner_suffix')}
                    </span>
                  </div>
                )}

                {/* PROJ-48: Owner-Sektion (portal_node_id aus VmDetailResponse) */}
                {detail.portal_node_id != null && (
                  <OwnerSection
                    resourceType={type === 'qemu' ? 'vm' : 'lxc'}
                    nodeId={detail.portal_node_id}
                    vmid={vmid}
                    isAdmin={isAdmin}
                    currentUsername={username}
                  />
                )}

                {/* PROJ-96: Abhängigkeiten (Plus, beide Richtungen) */}
                {hasDependencies && VmDependencySection && detail.portal_node_id != null && (
                  <Suspense fallback={null}>
                    <VmDependencySection
                      portalNodeId={detail.portal_node_id}
                      vmid={Number(vmid)}
                      node={node}
                      vmName={detail.name ?? `${type === 'qemu' ? 'VM' : 'CT'} ${vmid}`}
                      canManage={canManageDependencies}
                    />
                  </Suspense>
                )}

                {/* Resource bars */}
                <VmResourceBars detail={detail} />

                {/* Config: base info + network + disks; Stack-VMs: Editor gesperrt (AC-2B-MUT-2) */}
                <VmConfigSection detail={detail} canEdit={isOperator} onSaved={reloadDetail} managedByStack={detail.managed_by_stack} />

                {/* Guest-Info (QEMU only) */}
                {type === 'qemu' && (
                  <VmGuestInfoSection guestInfo={guestInfo} loading={guestLoading} />
                )}

                {/* LXC-Interfaces (LXC only) */}
                {type === 'lxc' && (
                  <VmLxcNetworkSection interfaces={lxcIfaces} loading={ifacesLoading} />
                )}

                {/* Two-column on large screens: snapshots | backups */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <VmSnapshotSection
                    vmid={Number(vmid)}
                    node={node}
                    snapshots={snapshots}
                    isOperator={isOperator}
                    isTemplate={detail.is_template}
                    onReload={reloadSnapshots}
                    portalNodeId={detail.portal_node_id}
                    kind={type}
                  />
                  <VmBackupSection
                    node={node}
                    vmType={type}
                    vmid={Number(vmid)}
                    backupsData={backups}
                    backupsErr={backupsErr}
                    isOperator={isOperator}
                    isTemplate={detail.is_template}
                    onReload={reloadBackups}
                  />
                </div>

              </div>
            )}

            {activeTab === 'alerts' && (
              <div>
                <VmAlertsTab
                  vmid={vmid}
                  nodeName={node}
                  isAdmin={isAdmin}
                />
              </div>
            )}

            {activeTab === 'scheduled' && (
              <div>
                <h2 className="text-sm font-semibold text-gray-700 dark:text-zinc-200 mb-4">
                  Zeitgesteuerte Jobs für diese VM
                </h2>
                <VmScheduledJobsTab vmid={vmid} />
              </div>
            )}

            {activeTab === 'firewall' && canFirewall && (
              <VmFirewallTab
                vmid={Number(vmid)}
                proxmoxNode={node}
                installation={detail.portal_node_id}
                stackInfo={detail.managed_by_stack}
              />
            )}

            {activeTab === 'config-snapshots' && hasConfigSnapshots && ConfigSnapshotsTab && detail?.portal_node_id != null && (
              <Suspense fallback={null}>
                <ConfigSnapshotsTab
                  portalNodeId={detail.portal_node_id}
                  proxmoxNode={node}
                  vmid={vmid}
                  kind={type}
                  vmName={detail.name ?? `${type === 'qemu' ? 'VM' : 'CT'} ${vmid}`}
                  vmStatus={detail.status}
                />
              </Suspense>
            )}
          </>
        ) : null}
        <Watermark />
      </main>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
