// p3portal.org
import { Suspense, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePackerTemplates } from '../../hooks/usePackerTemplates'
import { useAuth } from '../../hooks/useAuth'
import { useCapability } from '../../hooks/useCapability'
import { useGitSyncConflictIds, PlusComponents } from '../../plus'
import { getPackerTemplate, deletePackerTemplate } from '../../api/packer'
import PackerBuildForm from '../../components/packer/PackerBuildForm'
import PackerDescriptionPanel from '../../components/packer/PackerDescriptionPanel'
import PackerUploadModal from '../../components/packer/PackerUploadModal'
import ProxmoxTemplatesTab from '../../components/packer/ProxmoxTemplatesTab'
import IsoManagerTab from '../../components/packer/IsoManagerTab'
import LxcTemplatesTab from '../../components/image-factory/LxcTemplatesTab'
import PageDescription from '../../components/ui/PageDescription'
import PinIcon from '../../components/common/PinIcon'
import { usePinToggle } from '../../features/sidebar_pins/hooks/usePinToggle'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'
import HelpButton from '../../features/help/components/HelpButton'
import TabHelpButton from '../../features/help/components/TabHelpButton'
import Watermark from '../../components/common/Watermark'

function TabPinButton({ tabId, label }) {
  const { isPinned, loading, toggle, atLimit } = usePinToggle({
    route: `/image-factory?tab=${tabId}`,
    pinKind: 'other',
    defaultLabel: `Image Factory – ${label}`,
  })
  return (
    <button
      onClick={e => { e.stopPropagation(); toggle() }}
      disabled={loading || (atLimit && !isPinned)}
      className="p-0.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed"
      title={atLimit && !isPinned ? 'Pin-Limit erreicht' : isPinned ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
    >
      <PinIcon pinned={isPinned} disabled={atLimit && !isPinned} className="w-3.5 h-3.5" />
    </button>
  )
}

const ROLE_ORDER = { viewer: 0, operator: 1, admin: 2 }

function canUserStart(userRole, requiredRole) {
  if (userRole === 'viewer') return false
  return (ROLE_ORDER[userRole] ?? 0) >= (ROLE_ORDER[requiredRole] ?? 0)
}

function TemplateCard({ template, selected, isRunning, canAdmin, hasConflict, onSelect, onDeleted }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const handleDeleteClick = async (e) => {
    e.stopPropagation()
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    setDeleteError(null)
    try {
      await deletePackerTemplate(template.id)
      onDeleted(template.id)
    } catch (err) {
      setDeleteError(err.response?.data?.detail ?? 'Fehler beim Löschen')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={`border transition-colors rounded-lg ${
      selected
        ? 'border-portal-accent/50 bg-portal-accent/10'
        : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-portal-accent dark:hover:border-portal-accent'
    }`}>
      <div className="p-4 cursor-pointer" onClick={() => onSelect(template)}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-gray-900 dark:text-zinc-100">{template.name}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasConflict && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-portal-warn/10 text-portal-warn border border-portal-warn/30 leading-none">
                Konflikt
              </span>
            )}
            {isRunning && (
              <span className="flex items-center gap-1 text-xs bg-portal-accent/10 text-portal-accent px-2 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-portal-accent animate-pulse" />
                läuft
              </span>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400 line-clamp-2">{template.description}</p>
      </div>
      {canAdmin && (
        <div className="px-4 pb-3">
          {deleteError && <p className="text-xs text-portal-danger mb-1">{deleteError}</p>}
          <div className="flex justify-end">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-portal-danger">Löschen?</span>
                <button onClick={handleDeleteClick} disabled={deleting}
                  className="text-xs bg-portal-danger hover:bg-portal-danger disabled:opacity-50 text-white px-2 py-0.5 transition-colors">
                  {deleting ? '…' : 'Ja'}
                </button>
                <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(false) }}
                  className="text-xs text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200">
                  Nein
                </button>
              </div>
            ) : (
              <button onClick={handleDeleteClick}
                className="text-xs text-portal-danger hover:text-portal-danger transition-colors">
                Löschen
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const TABS = [
  { id: 'vm-images', label: 'VM Images' },
  { id: 'vm-templates', label: 'VM Templates' },
  { id: 'lxc-templates', label: 'LXC Templates' },
  { id: 'isos', label: 'ISOs' },
]

export default function ImageFactoryPage() {
  const { role } = useAuth()
  const { templates, runningBuilds, loading, error, reload } = usePackerTemplates()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'vm-images'
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const isAdmin = role === 'admin'
  const conflictIds = useGitSyncConflictIds('packer', isAdmin)
  // PROJ-92: Build-Editor-Tab nur bei Plus + Admin (require_admin im Backend).
  const canBuildEditor = useCapability('packer_editor') && isAdmin
  const PackerEditorTab = PlusComponents.PackerEditorTab
  const tabs = canBuildEditor ? [...TABS, { id: 'build-editor', label: 'Build Editor' }] : TABS
  const visibleTemplates = role === 'viewer'
    ? templates.filter(t => !t.required_role)
    : templates

  const handleSelect = async (tmpl) => {
    setDetailLoading(true)
    setSelected(null)
    try {
      const detail = await getPackerTemplate(tmpl.id)
      setSelected(detail)
    } catch {
      setSelected(tmpl)
    } finally {
      setDetailLoading(false)
    }
  }

  const handleDeleted = async (id) => {
    if (selected?.id === id) setSelected(null)
    await reload()
  }

  const tabCls = (id) =>
    `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeTab === id
        ? 'border-portal-accent/50 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Image Factory</h1>
          <HelpButton helpKey="image_factory" />
        </div>
        {isAdmin && activeTab === 'vm-images' && (
          <button
            onClick={() => setShowUpload(true)}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Build-Definition hochladen
          </button>
        )}
      </header>

      <div className="flex border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 shrink-0">
        {tabs.map(tab => {
          const tabHelpKeys = {
            'vm-images':    'image_factory.tabs.vm_images',
            'vm-templates': 'image_factory.tabs.vm_templates',
            'lxc-templates':'image_factory.tabs.lxc_templates',
            'isos':         'image_factory.tabs.isos',
            'build-editor': 'image_factory.tabs.build_editor',
          }
          return (
            <button key={tab.id} onClick={() => setSearchParams({ tab: tab.id })} className={tabCls(tab.id)}>
              {tab.label}
              {tabHelpKeys[tab.id] && <TabHelpButton helpKey={tabHelpKeys[tab.id]} />}
            </button>
          )
        })}
        <div className="ml-auto self-center pr-1">
          <TabPinButton tabId={activeTab} label={tabs.find(t => t.id === activeTab)?.label ?? activeTab} />
        </div>
      </div>

      {activeTab === 'vm-templates' && <ProxmoxTemplatesTab />}
      {activeTab === 'lxc-templates' && <LxcTemplatesTab />}
      {activeTab === 'isos' && <IsoManagerTab />}
      {activeTab === 'build-editor' && canBuildEditor && PackerEditorTab && (
        <Suspense fallback={<div className="p-6 text-sm text-gray-500 dark:text-zinc-400">Lädt…</div>}>
          <PackerEditorTab />
        </Suspense>
      )}

      <div className={`flex flex-1 min-h-0 m-4 rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700 ${activeTab !== 'vm-images' ? 'hidden' : ''}`}>
        <div className="w-64 lg:w-72 xl:w-80 2xl:w-96 shrink-0 border-r border-gray-200 dark:border-zinc-700 overflow-y-auto p-3 space-y-2 bg-transparent">
          {loading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />)}
            </div>
          )}
          {error && (
            <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger">
              Fehler beim Laden.
            </div>
          )}
          {!loading && !error && visibleTemplates.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Build-Definitionen gefunden.</p>
            </div>
          )}
          {visibleTemplates.map(tmpl => (
            <TemplateCard
              key={tmpl.id}
              template={tmpl}
              selected={selected?.id === tmpl.id}
              isRunning={runningBuilds.has(tmpl.id)}
              canAdmin={isAdmin}
              hasConflict={conflictIds.has(tmpl.id)}
              onSelect={handleSelect}
              onDeleted={handleDeleted}
            />
          ))}
        </div>

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 bg-transparent">
            {detailLoading ? (
              <div className="flex flex-col items-center justify-center h-full">
                <svg className="animate-spin w-5 h-5 text-portal-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              </div>
            ) : !selected ? (
              <PageDescription pageId="template-builder" fallback="Build-Definition aus der Liste auswählen" />
            ) : !canUserStart(role, selected.required_role) ? (
              <div className="max-w-lg">
                <div className="mb-6 pb-4 border-b border-gray-200 dark:border-zinc-700">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{selected.name}</h2>
                    <ModalHelpButton helpKey="modal.packer_build_form" />
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{selected.description}</p>
                </div>
                <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Berechtigung zum Starten.</p>
              </div>
            ) : (
              <div className="max-w-lg xl:max-w-xl 2xl:max-w-2xl">
                <div className="mb-6 pb-4 border-b border-gray-200 dark:border-zinc-700">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{selected.name}</h2>
                    <ModalHelpButton helpKey="modal.packer_build_form" />
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{selected.description}</p>
                </div>
                <PackerBuildForm
                  template={selected}
                  isRunning={runningBuilds.has(selected.id)}
                  onBuildStarted={reload}
                />
              </div>
            )}
          <Watermark />
          </div>
          <PackerDescriptionPanel templateId={selected?.id ?? null} />
        </div>
      </div>

      {showUpload && (
        <PackerUploadModal onClose={() => setShowUpload(false)} onUploaded={() => reload()} />
      )}
    </div>
  )
}
