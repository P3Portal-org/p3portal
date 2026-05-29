// p3portal.org
import { Suspense, useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../hooks/useAuth'
import { useCapability } from '../../hooks/useCapability'
import { fetchUsers } from '../../api/admin'
import { fetchNodes } from '../../api/nodes'
import { getCacheStats } from '../../api/cluster'
import LicenseStatusBanner from '../../components/admin/LicenseStatusBanner'
import LicenseSectionAdmin from '../../components/admin/LicenseSectionAdmin'
import AppearanceSection from '../../components/admin/AppearanceSection'
import SshKeySection from '../../components/admin/SshKeySection'
import NodeDefaultStoragesSection from '../../components/admin/NodeDefaultStoragesSection'
import NodeDefaultTemplatesSection from '../../components/admin/NodeDefaultTemplatesSection'
import VmidRangeSection from '../../components/admin/VmidRangeSection'
import PlaybookVmidRangeSection from '../../components/admin/PlaybookVmidRangeSection'
import PackerHttpIpSection from '../../components/admin/PackerHttpIpSection'
import ApiKeysSection from '../../components/admin/apikeys/ApiKeysSection'
import AnnouncementsSection from '../../components/admin/announcements/AnnouncementsSection'
import GlobalRulesTab from '../../components/admin/monitoring/GlobalRulesTab'
import { PlusComponents } from '../../plus'
import UserTable from '../../components/admin/UserTable'
import UserForm from '../../components/admin/UserForm'
import NodeTable from '../../components/admin/NodeTable'
import NodeFormModal from '../../components/admin/NodeFormModal'
import PackerUploadModal from '../../components/packer/PackerUploadModal'
import SharedPlusBadge from '../../components/common/PlusBadge'
import PlaybookUploadModal from '../../components/playbooks/PlaybookUploadModal'
import { getPlaybooks, deletePlaybook } from '../../api/playbooks'
import { fetchPackerTemplates, deletePackerTemplate } from '../../api/packer'
import PresetTable from '../../components/admin/rbac/PresetTable'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'
import PinIcon from '../../components/common/PinIcon'
import { usePinToggle } from '../../features/sidebar_pins/hooks/usePinToggle'
const PoolsPage = PlusComponents.PoolsPage
import GroupsPage from '../../features/groups/Page'
import NodeAccessModal from '../../features/node_assignments/Page'
const PlaybookPermissionsPage = PlusComponents.PlaybookPermissionsPage
// PROJ-64: ApprovalRulesAdminPage nach plus/Approvals/ migriert – via Registry
const ApprovalRulesAdminPage = PlusComponents.ApprovalRulesAdminPage
// PROJ-68: Git-Sync via Plus-Registry
const GitSyncSection = PlusComponents.GitSyncSection
// PROJ-74: Config-Snapshot Orphan-Admin via Plus-Registry
const ConfigSnapshotOrphanPage = PlusComponents.ConfigSnapshotOrphanPage
// PROJ-57: Help-Admin-Sektion
import HelpAdminSection from '../../features/help/components/HelpAdminSection'
import WebhookAllowlistSection from '../../components/admin/WebhookAllowlistSection'
import HelpButton from '../../features/help/components/HelpButton'
import TabHelpButton from '../../features/help/components/TabHelpButton'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'
import Watermark from '../../components/common/Watermark'

// PROJ-59: Top-Tab-Reduktion auf 6. Pools + Playbook-Rechte sind jetzt
// Sub-Tabs unter „Nutzer & Rechte". Content → Vorlagen.
const TABS = [
  { id: 'portal',       label: 'Portal',          perm: 'manage_settings' },
  { id: 'nodes',        label: 'Nodes',           perm: 'manage_nodes' },
  { id: 'users',        label: 'Nutzer & Rechte', perm: 'manage_users' },
  { id: 'templates',    label: 'Vorlagen',        perm: null },
  { id: 'integrations', label: 'Integrationen',   perm: 'manage_api_keys' },
  { id: 'monitoring',   label: 'Monitoring',      perm: 'manage_settings' },
]

function TabPinButton({ tabId, label, subId }) {
  const route = subId
    ? `/system-settings?sub=${subId}&tab=${tabId}`
    : `/system-settings?tab=${tabId}`
  const { isPinned, loading, toggle, atLimit } = usePinToggle({
    route,
    pinKind: subId ? 'system_settings_sub_tab' : 'system_settings_tab',
    defaultLabel: `System Settings – ${label}`,
  })
  return (
    <button
      onClick={e => { e.stopPropagation(); toggle() }}
      disabled={loading || (atLimit && !isPinned)}
      className="ml-1.5 p-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      title={atLimit && !isPinned ? 'Pin-Limit erreicht' : isPinned ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
    >
      <PinIcon pinned={isPinned} disabled={atLimit && !isPinned} className="w-3.5 h-3.5" />
    </button>
  )
}

// PROJ-59: Approval-Workflow ist eigener Portal-Sub-Tab (Toggle + Regeln am gleichen Ort,
// auch sichtbar wenn der Workflow noch aus ist – Admin kann Regeln vorbereiten).
const PORTAL_SUB_TABS = [
  { id: 'defaults',          label: 'Standardwerte' },
  { id: 'approval_workflow', label: 'Approval-Workflow' },
  { id: 'appearance',        label: 'Erscheinungsbild' },
  { id: 'security',          label: 'Sicherheit' },
  { id: 'license',           label: 'Lizenz' },
]

function PortalTab({ navigate }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeSub = searchParams.get('sub') || 'defaults'
  // PROJ-64: Approval-Workflow Sub-Tab nur bei aktiver Capability
  const hasApprovalWorkflow = useCapability('approval_workflow')

  const subCls = (id) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeSub === id
        ? 'border-orange-500 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200 dark:border-zinc-700">
        {PORTAL_SUB_TABS.filter(st => st.id !== 'approval_workflow' || hasApprovalWorkflow).map(st => (
          <button key={st.id} onClick={() => setSearchParams(prev => { const n = new URLSearchParams(prev); n.set('sub', st.id); return n })} className={subCls(st.id)}>
            {st.label}
          </button>
        ))}
      </div>

      {activeSub === 'defaults' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="portal" subId="defaults" label="Standardwerte" />
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">Setup-Wizard</p>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">Nodes und Verbindungseinstellungen konfigurieren</p>
            </div>
            <button
              onClick={() => navigate('/setup')}
              className="shrink-0 ml-4 px-4 py-2 text-sm font-medium border border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              Öffnen
            </button>
          </div>
          <SshKeySection />
          <NodeDefaultStoragesSection />
          <NodeDefaultTemplatesSection />
          <VmidRangeSection />
          <PlaybookVmidRangeSection />
          <PackerHttpIpSection />
        </div>
      )}

      {activeSub === 'approval_workflow' && hasApprovalWorkflow && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="portal" subId="approval_workflow" label="Approval-Workflow" />
          </div>
          <Suspense fallback={null}>
            <ApprovalRulesAdminPage embedded />
          </Suspense>
        </div>
      )}

      {activeSub === 'appearance' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="portal" subId="appearance" label="Erscheinungsbild" />
          </div>
          <AppearanceSection />
        </div>
      )}

      {activeSub === 'security' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="portal" subId="security" label="Sicherheit" />
          </div>
          <WebhookAllowlistSection />
        </div>
      )}

      {activeSub === 'license' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="portal" subId="license" label="Lizenz" />
          </div>
          <LicenseSectionAdmin />
        </div>
      )}
    </div>
  )
}

function UsersTab() {
  const { t } = useTranslation()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [panel, setPanel] = useState(null)
  const [searchParamsSub, setSearchParamsSub] = useSearchParams()
  const activeSubTab = searchParamsSub.get('sub') || 'users'
  const { userLimit, userAtLimit, reload: reloadLimits } = useLicenseLimits()
  const isPlus = useCapability('pools_quotas')
  const hasPlaybookPermissions = useCapability('playbook_permissions')

  const load = useCallback(async () => {
    try {
      const data = await fetchUsers()
      setUsers(data)
    } catch {
      // ignore
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (panel === null) return
    const onKey = (e) => { if (e.key === 'Escape') setPanel(null) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [panel])

  const subTabCls = (id) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeSubTab === id
        ? 'border-orange-500 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200 dark:border-zinc-700 overflow-x-auto">
        <button onClick={() => setSearchParamsSub(prev => { const n = new URLSearchParams(prev); n.set('sub', 'users'); return n })} className={subTabCls('users')}>
          {t('admin.users.tab_users')}
        </button>
        <button onClick={() => setSearchParamsSub(prev => { const n = new URLSearchParams(prev); n.set('sub', 'presets'); return n })} className={subTabCls('presets')}>
          {t('admin.users.tab_presets')}
        </button>
        <button onClick={() => setSearchParamsSub(prev => { const n = new URLSearchParams(prev); n.set('sub', 'groups'); return n })} className={subTabCls('groups')}>
          {t('system_settings.users_groups_sub_tab')}
        </button>
        {isPlus && (
          <button onClick={() => setSearchParamsSub(prev => { const n = new URLSearchParams(prev); n.set('sub', 'pools'); return n })} className={subTabCls('pools')}>
            Pools
          </button>
        )}
        {hasPlaybookPermissions && (
          <button onClick={() => setSearchParamsSub(prev => { const n = new URLSearchParams(prev); n.set('sub', 'playbook_permissions'); return n })} className={subTabCls('playbook_permissions')}>
            Playbook-Rechte
          </button>
        )}
      </div>

      {activeSubTab === 'users' && (
        <>
          <div className="flex justify-end mb-1">
            <TabPinButton tabId="users" subId="users" label={t('admin.users.tab_users')} />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500 dark:text-zinc-500">
              {t('admin.users.description')}
            </p>
            <div className="relative group">
              <button
                onClick={() => !userAtLimit && setPanel('create')}
                disabled={userAtLimit}
                className="btn-primary flex items-center gap-2"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t('admin.users.create_btn')}
              </button>
              {userAtLimit && (
                <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block w-52 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2.5 py-1.5 shadow-lg pointer-events-none">
                  Limit erreicht – Upgrade auf P3 Plus
                </div>
              )}
            </div>
          </div>
          {loading
            ? <div className="h-32 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
            : <UserTable
                users={users}
                onEdit={(u) => setPanel(u)}
                onRefresh={load}
              />
          }
        </>
      )}

      {activeSubTab === 'presets' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="users" subId="presets" label={t('admin.users.tab_presets')} />
          </div>
          <PresetTable />
        </div>
      )}

      {activeSubTab === 'groups' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="users" subId="groups" label={t('system_settings.users_groups_sub_tab')} />
          </div>
          <GroupsPage embedded />
        </div>
      )}

      {activeSubTab === 'pools' && isPlus && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="users" subId="pools" label="Pools" />
          </div>
          <Suspense fallback={null}><PoolsPage embedded /></Suspense>
        </div>
      )}

      {activeSubTab === 'playbook_permissions' && hasPlaybookPermissions && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <TabPinButton tabId="users" subId="playbook_permissions" label="Playbook-Rechte" />
          </div>
          <Suspense fallback={null}><PlaybookPermissionsPage embedded /></Suspense>
        </div>
      )}

      {panel !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-lg flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {panel === 'create' ? t('admin.users.modal_create') : `${t('admin.users.modal_edit', { username: panel.username })}`}
                </h2>
                {panel === 'create' && userLimit && !userLimit.unlimited && (
                  <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                    userAtLimit
                      ? 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400'
                      : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
                  }`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 shrink-0">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                    {userLimit.current} / {userLimit.max} Nutzer
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <ModalHelpButton helpKey="modal.user_form" />
                <button
                  onClick={() => setPanel(null)}
                  className="btn-ghost transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 overflow-y-auto">
              <UserForm
                user={panel === 'create' ? null : panel}
                onSuccess={() => { setPanel(null); load(); reloadLimits?.() }}
                onCancel={() => setPanel(null)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NodesTab() {
  const isPlus = useCapability('multiple_nodes')
  const [showModal, setShowModal] = useState(false)
  const [editNode, setEditNode] = useState(null)
  const [accessNode, setAccessNode] = useState(null)
  const [nodes, setNodes] = useState([])
  const [cacheStats, setCacheStats] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')
  const load = useCallback(async () => {
    setFetchError('')
    try {
      const [data, stats] = await Promise.all([
        fetchNodes(),
        getCacheStats().catch(() => []),
      ])
      setNodes(data)
      setCacheStats(stats)
    } catch {
      setFetchError('Nodes konnten nicht geladen werden.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {isPlus && (
        <div className="flex justify-end">
          <button
            onClick={() => { setEditNode(null); setShowModal(true) }}
            className="btn-primary flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Node hinzufügen
          </button>
        </div>
      )}
      {fetchError && <p className="text-sm text-red-500">{fetchError}</p>}
      {loading
        ? <div className="h-32 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        : <NodeTable
            nodes={nodes}
            cacheStats={cacheStats}
            onRefresh={load}
            onEdit={(n) => { setEditNode(n); setShowModal(true) }}
            onManageAccess={(n) => setAccessNode(n)}
          />
      }
      {showModal && (
        <NodeFormModal
          node={editNode}
          onClose={() => { setShowModal(false); setEditNode(null) }}
          onSaved={() => { setShowModal(false); setEditNode(null); load() }}
        />
      )}
      {accessNode && (
        <NodeAccessModal
          node={accessNode}
          isPlus={isPlus}
          onClose={() => setAccessNode(null)}
        />
      )}
    </div>
  )
}

const CATEGORY_LABELS = {
  vm_deployment: 'VM Deployment',
  lxc_deployment: 'LXC Deployment',
  vm_lxc_config: 'VM/LXC Konfiguration',
}

function DeleteConfirmButton({ onDelete }) {
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleClick = async () => {
    if (!confirm) { setConfirm(true); return }
    setLoading(true)
    setError(null)
    try {
      await onDelete()
    } catch (err) {
      setError(err.response?.data?.detail ?? 'Fehler beim Löschen')
      setConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  if (error) return <span className="text-xs text-red-500">{error}</span>

  return (
    <div className="flex items-center gap-1">
      {confirm && (
        <button
          onClick={() => setConfirm(false)}
          className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors"
        >
          Abbrechen
        </button>
      )}
      <button
        onClick={handleClick}
        disabled={loading}
        className={`text-xs px-2 py-1 rounded transition-colors ${
          confirm
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'border border-gray-200 dark:border-zinc-700 text-gray-400 dark:text-zinc-500 hover:border-red-400 hover:text-red-500'
        }`}
      >
        {loading ? '…' : confirm ? 'Bestätigen' : 'Löschen'}
      </button>
    </div>
  )
}

function IntegrationsTab() {
  const [searchParamsSub, setSearchParamsSub] = useSearchParams()
  const activeSub = searchParamsSub.get('sub') === 'api_keys' ? 'api_keys' : 'announcements'

  const setSub = (sub) => setSearchParamsSub(prev => {
    const n = new URLSearchParams(prev)
    n.set('sub', sub)
    return n
  })

  const subTabCls = (id) =>
    `px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
      activeSub === id
        ? 'border-orange-500 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-gray-200 dark:border-zinc-700 overflow-x-auto">
        <button onClick={() => setSub('announcements')} className={subTabCls('announcements')}>
          Ankündigungen
        </button>
        <button onClick={() => setSub('api_keys')} className={subTabCls('api_keys')}>
          API-Keys &amp; Webhooks
        </button>
      </div>

      {activeSub === 'api_keys' && (
        <>
          <div className="flex justify-end mb-1">
            <TabPinButton tabId="integrations" subId="api_keys" label="API-Keys & Webhooks" />
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <ApiKeysSection />
          </div>
        </>
      )}

      {activeSub === 'announcements' && (
        <>
          <div className="flex justify-end mb-1">
            <TabPinButton tabId="integrations" subId="announcements" label="Ankündigungen" />
          </div>
          <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
            <AnnouncementsSection />
          </div>
        </>
      )}
    </div>
  )
}

function ContentTab() {
  const [showPbUpload, setShowPbUpload] = useState(false)
  const [showPackerUpload, setShowPackerUpload] = useState(false)
  const [playbooks, setPlaybooks] = useState([])
  const [packerTemplates, setPackerTemplates] = useState([])
  const [pbLoading, setPbLoading] = useState(true)
  const [pkLoading, setPkLoading] = useState(true)
  const { role } = useAuth()
  const isPlus = useCapability('help_global_overrides')
  const isAdmin = role === 'admin'

  const loadPlaybooks = useCallback(async () => {
    setPbLoading(true)
    try { setPlaybooks(await getPlaybooks()) } catch { /* ignore */ } finally { setPbLoading(false) }
  }, [])

  const loadPacker = useCallback(async () => {
    setPkLoading(true)
    try { setPackerTemplates(await fetchPackerTemplates()) } catch { /* ignore */ } finally { setPkLoading(false) }
  }, [])

  useEffect(() => { loadPlaybooks(); loadPacker() }, [loadPlaybooks, loadPacker])

  if (!isAdmin) {
    return <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Berechtigung.</p>
  }

  const handleDeletePlaybook = (id) => async () => {
    await deletePlaybook(id)
    await loadPlaybooks()
  }

  const handleDeletePacker = (id) => async () => {
    await deletePackerTemplate(id)
    await loadPacker()
  }

  return (
    <div className="space-y-6">
      {/* Upload-Aktionen */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">Playbooks hochladen</p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              ZIP mit <code className="font-mono">meta.yaml</code> + Playbook-Dateien
            </p>
          </div>
          <button
            onClick={() => setShowPbUpload(true)}
            className="btn-primary shrink-0 ml-4 text-xs"
          >
            Hochladen
          </button>
        </div>
        <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">Packer Build-Definitionen hochladen</p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              ZIP mit <code className="font-mono">.pkr.hcl</code> + <code className="font-mono">meta.yaml</code>
            </p>
          </div>
          <button
            onClick={() => setShowPackerUpload(true)}
            className="btn-primary shrink-0 ml-4 text-xs"
          >
            Hochladen
          </button>
        </div>
      </div>

      {/* Playbooks-Liste */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-zinc-700">
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Playbooks</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
            {pbLoading ? '…' : playbooks.length}
          </span>
        </div>
        {pbLoading ? (
          <div className="h-20 animate-pulse bg-gray-50 dark:bg-zinc-800" />
        ) : playbooks.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">Keine Playbooks vorhanden</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400">Name</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400">Kategorie</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400">Rolle</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {playbooks.map(pb => (
                <tr key={pb.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-zinc-100">{pb.name}</p>
                    <p className="text-gray-400 dark:text-zinc-500 font-mono">{pb.id}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-zinc-300">
                    {CATEGORY_LABELS[pb.category] ?? pb.category ?? '–'}
                  </td>
                  <td className="px-4 py-3">
                    {pb.required_role
                      ? <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300">{pb.required_role}</span>
                      : <span className="text-gray-400 dark:text-zinc-500">–</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DeleteConfirmButton onDelete={handleDeletePlaybook(pb.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Packer-Templates-Liste */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-zinc-700">
          <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Packer Build-Definitionen</p>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
            {pkLoading ? '…' : packerTemplates.length}
          </span>
        </div>
        {pkLoading ? (
          <div className="h-20 animate-pulse bg-gray-50 dark:bg-zinc-800" />
        ) : packerTemplates.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">Keine Packer Build-Definitionen vorhanden</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50">
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400">Name</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400">Beschreibung</th>
                <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400">Rolle</th>
                <th className="text-right px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
              {packerTemplates.map(tmpl => (
                <tr key={tmpl.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-zinc-100">{tmpl.name}</p>
                    <p className="text-gray-400 dark:text-zinc-500 font-mono">{tmpl.id}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-zinc-300 max-w-xs">
                    <span className="line-clamp-2">{tmpl.description ?? '–'}</span>
                  </td>
                  <td className="px-4 py-3">
                    {tmpl.required_role
                      ? <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-300">{tmpl.required_role}</span>
                      : <span className="text-gray-400 dark:text-zinc-500">–</span>
                    }
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DeleteConfirmButton onDelete={handleDeletePacker(tmpl.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Hilfetexte-Admin-Sektion – nur Plus (PROJ-57) */}
      {isPlus && <HelpAdminSection />}

      {/* Git-Sync-Sektion (PROJ-68) – Plus angezeigt, Core gesperrt */}
      <Suspense fallback={null}>
        <GitSyncSection />
      </Suspense>

      {showPbUpload && (
        <PlaybookUploadModal
          onClose={() => setShowPbUpload(false)}
          onUploaded={() => { setShowPbUpload(false); loadPlaybooks() }}
        />
      )}
      {showPackerUpload && (
        <PackerUploadModal
          onClose={() => setShowPackerUpload(false)}
          onUploaded={() => { setShowPackerUpload(false); loadPacker() }}
        />
      )}
    </div>
  )
}

export default function SystemSettingsPage() {
  const navigate = useNavigate()
  const { role, portalPermissions } = useAuth()
  const isPlus = useCapability('alert_presets')
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'portal'
  const AlertPresetsTab = PlusComponents.AlertPresetsTab
  const AlertSmtpSection = PlusComponents.AlertSmtpSection

  const isAdmin = role === 'admin'
  const perms = portalPermissions ?? []

  const visibleTabs = TABS.filter(tab => {
    if (tab.plusOnly && !isPlus) return false
    if (!tab.perm) return isAdmin
    return isAdmin || perms.includes(tab.perm)
  })

  useEffect(() => {
    const currentTab = searchParams.get('tab') || 'portal'
    if (visibleTabs.length > 0 && !visibleTabs.find(t => t.id === currentTab)) {
      setSearchParams({ tab: visibleTabs[0].id })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, portalPermissions])

  const tabCls = (id) =>
    `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === id
        ? 'border-orange-500 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  if (visibleTabs.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <header className="h-12 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">System Settings</h1>
            <HelpButton helpKey="system_settings" />
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Berechtigung für System Settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">System Settings</h1>
          <HelpButton helpKey="system_settings" />
        </div>
        <div className="ml-auto">
          <LicenseStatusBanner />
        </div>
      </header>

      <div className="flex border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 shrink-0 overflow-x-auto">
        {visibleTabs.map(tab => {
          const tabHelpKeys = {
            nodes: 'system_settings.tabs.nodes',
            users: 'system_settings.tabs.users',
            portal: 'system_settings.tabs.portal',
            templates: 'system_settings.tabs.content',
          }
          return (
            <button key={tab.id} onClick={() => setSearchParams({ tab: tab.id })} className={tabCls(tab.id)}>
              {tab.label}
              {tabHelpKeys[tab.id] && <TabHelpButton helpKey={tabHelpKeys[tab.id]} />}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-6 min-w-0">
        <div className="max-w-4xl mx-auto">

          {/* Pin-Button für Haupt-Tabs ohne eigene Sub-Tab-Pins */}
          {!['portal', 'users', 'integrations'].includes(activeTab) && (
            <div className="flex justify-end mb-3">
              <TabPinButton tabId={activeTab} label={visibleTabs.find(t => t.id === activeTab)?.label ?? activeTab} />
            </div>
          )}

          {activeTab === 'portal' && <PortalTab navigate={navigate} />}

          {activeTab === 'nodes' && <NodesTab />}

          {activeTab === 'users' && <UsersTab />}

          {activeTab === 'templates' && <ContentTab />}

          {activeTab === 'integrations' && <IntegrationsTab />}

          {activeTab === 'monitoring' && (
            <div className="space-y-8">
              <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
                <GlobalRulesTab />
              </div>
              {isPlus && AlertPresetsTab && (
                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
                  <PlusBadge />
                  <Suspense fallback={null}>
                    <AlertPresetsTab />
                  </Suspense>
                </div>
              )}
              {isPlus && AlertSmtpSection && (
                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
                  <PlusBadge />
                  <Suspense fallback={null}>
                    <AlertSmtpSection />
                  </Suspense>
                </div>
              )}
              {isPlus && ConfigSnapshotOrphanPage && (
                <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
                  <PlusBadge />
                  <Suspense fallback={null}>
                    <ConfigSnapshotOrphanPage embedded />
                  </Suspense>
                </div>
              )}
            </div>
          )}

        </div>
        <Watermark />
      </div>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}

function PlusBadge() {
  return (
    <div className="flex items-center justify-end mb-3">
      <SharedPlusBadge className="w-3.5 h-3.5 text-green-500 dark:text-green-400 shrink-0" />
    </div>
  )
}
