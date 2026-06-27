// p3portal.org
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePlaybooks } from '../../hooks/usePlaybooks'
import { useAuth } from '../../hooks/useAuth'
import { getPlaybook, getPlaybookDescription } from '../../api/playbooks'
import PlaybookForm from '../../components/playbooks/PlaybookForm'
import DescriptionPanel from '../../components/ui/DescriptionPanel'
import PageDescription from '../../components/ui/PageDescription'
import PlaybookUploadModal from '../../components/playbooks/PlaybookUploadModal'
import PinIcon from '../../components/common/PinIcon'
import { usePinToggle } from '../../features/sidebar_pins/hooks/usePinToggle'
import HelpButton from '../../features/help/components/HelpButton'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'
import TabHelpButton from '../../features/help/components/TabHelpButton'
import { useGitSyncConflictIds } from '../../plus'
import Watermark from '../../components/common/Watermark'

function TabPinButton({ tabId, label }) {
  const { isPinned, loading, toggle, atLimit } = usePinToggle({
    route: `/provisioning?tab=${tabId}`,
    pinKind: 'other',
    defaultLabel: `Provisioning – ${label}`,
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

function PlaybookCard({ playbook, selected, onSelect, hasConflict }) {
  return (
    <button
      onClick={() => onSelect(playbook)}
      className={`w-full text-left border p-4 transition-colors rounded-lg ${
        selected
          ? 'border-portal-accent/50 bg-portal-accent/10'
          : 'border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-portal-accent dark:hover:border-portal-accent'
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-sm font-medium text-gray-900 dark:text-zinc-100 leading-snug">{playbook.name}</p>
        {hasConflict && (
          <span className="shrink-0 mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-portal-warn/10 text-portal-warn border border-portal-warn/30 leading-none">
            Konflikt
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-gray-500 dark:text-zinc-400 line-clamp-2">{playbook.description}</p>
    </button>
  )
}

const TABS = [
  { id: 'vm_deployment', label: 'VMs' },
  { id: 'lxc_deployment', label: 'LXCs' },
]

export default function ProvisioningPage() {
  const { playbooks, loading, error, reload } = usePlaybooks()
  const { role } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeCategory = searchParams.get('tab') || 'vm_deployment'
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const isAdmin = role === 'admin'
  const conflictIds = useGitSyncConflictIds('ansible', isAdmin)

  // PROJ-49: can_execute filtert Playbooks ohne Whitelist-Berechtigung.
  // Admin sieht immer alle (Resolver gibt für Admin immer true zurück).
  // can_execute=null bedeutet unbekannt (kein user_id) → nicht filtern.
  const visible = playbooks.filter(pb => {
    if (pb.can_execute === false) return false
    if (role === 'viewer' && pb.required_role) return false
    return true
  })
  const filtered = visible.filter(pb => pb.category === activeCategory)

  const handleCategoryChange = (cat) => {
    setSearchParams({ tab: cat })
    setSelected(null)
  }

  const handleSelect = async (pb) => {
    setDetailLoading(true)
    setSelected(null)
    try {
      const detail = await getPlaybook(pb.id)
      setSelected(detail)
    } catch {
      setSelected(pb)
    } finally {
      setDetailLoading(false)
    }
  }

  const tabCls = (id) =>
    `px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
      activeCategory === id
        ? 'border-portal-accent/50 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Provisioning</h1>
          <HelpButton helpKey="deploy" />
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowUpload(true)}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Playbook hochladen
          </button>
        )}
      </header>

      <div className="flex border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 shrink-0">
        {TABS.map(tab => {
          const tabHelpKeys = {
            vm_deployment:  'deploy.tabs.vm_deployment',
            lxc_deployment: 'deploy.tabs.lxc_deployment',
          }
          return (
            <button key={tab.id} onClick={() => handleCategoryChange(tab.id)} className={tabCls(tab.id)}>
              {tab.label}
              {tabHelpKeys[tab.id] && <TabHelpButton helpKey={tabHelpKeys[tab.id]} />}
            </button>
          )
        })}
        <div className="ml-auto self-center pr-1">
          <TabPinButton tabId={activeCategory} label={TABS.find(t => t.id === activeCategory)?.label ?? activeCategory} />
        </div>
      </div>

      <div className="flex flex-1 min-h-0 m-4 rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700">
        {/* Linke Spalte: Playbook-Liste */}
        <div className="w-64 lg:w-72 xl:w-80 shrink-0 border-r border-gray-200 dark:border-zinc-700 overflow-y-auto p-3 space-y-2 bg-transparent">
          {loading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-zinc-800 animate-pulse" />)}
            </div>
          )}
          {error && (
            <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger">
              Fehler beim Laden der Playbooks.
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Playbooks gefunden.</p>
              <p className="text-xs text-gray-400 dark:text-zinc-500 mt-1">
                Füge <code className="font-mono">meta.yaml</code> mit <code className="font-mono">category: {activeCategory}</code> hinzu.
              </p>
            </div>
          )}
          {filtered.map(pb => (
            <PlaybookCard key={pb.id} playbook={pb} selected={selected?.id === pb.id} onSelect={handleSelect} hasConflict={conflictIds.has(pb.id)} />
          ))}
        </div>

        {/* Rechte Spalte: Formular + Beschreibung */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 bg-transparent">
            {detailLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <svg className="animate-spin w-5 h-5 text-portal-accent mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              </div>
            ) : !selected ? (
              <PageDescription
                pageId={`playbooks-${activeCategory.replace(/_/g, '-')}`}
                fallback="Playbook aus der Liste auswählen"
              />
            ) : (
              <div className="max-w-lg xl:max-w-xl 2xl:max-w-2xl">
                <div className="mb-6 pb-4 border-b border-gray-200 dark:border-zinc-700">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{selected.name}</h2>
                    <ModalHelpButton helpKey="modal.deploy_form" />
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">{selected.description}</p>
                </div>
                <PlaybookForm playbook={selected} />
              </div>
            )}
          <Watermark />
          </div>
          <DescriptionPanel resourceId={selected?.id ?? null} fetchFn={getPlaybookDescription} />
        </div>
      </div>

      {showUpload && (
        <PlaybookUploadModal onClose={() => setShowUpload(false)} onUploaded={() => reload?.()} />
      )}
    </div>
  )
}
