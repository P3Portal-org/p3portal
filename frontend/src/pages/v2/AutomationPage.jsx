// p3portal.org
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePlaybooks } from '../../hooks/usePlaybooks'
import { useScheduledJobs } from '../../hooks/useScheduledJobs'
import { useAuth } from '../../hooks/useAuth'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'
import { useCapability } from '../../hooks/useCapability'
import { getPlaybook, getPlaybookDescription } from '../../api/playbooks'
import PlaybookForm from '../../components/playbooks/PlaybookForm'
import DescriptionPanel from '../../components/ui/DescriptionPanel'
import PageDescription from '../../components/ui/PageDescription'
import PlaybookUploadModal from '../../components/playbooks/PlaybookUploadModal'
import { PlusComponents, useGitSyncConflictIds } from '../../plus'
import PinIcon from '../../components/common/PinIcon'
import { usePinToggle } from '../../features/sidebar_pins/hooks/usePinToggle'
import HelpButton from '../../features/help/components/HelpButton'
import TabHelpButton from '../../features/help/components/TabHelpButton'
import Watermark from '../../components/common/Watermark'
import InventoryView from '../../features/ansible_inventory/components/InventoryView'

function TabPinButton({ tabId, label }) {
  const { isPinned, loading, toggle, atLimit } = usePinToggle({
    route: `/automation?tab=${tabId}`,
    pinKind: 'other',
    defaultLabel: `Automation – ${label}`,
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
          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/20'
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
  { id: 'playbooks', label: 'Playbooks' },
  { id: 'scheduled', label: 'Zeitgesteuerte Jobs' },
  { id: 'inventory', label: 'Ansible-Inventar' },
]

export default function AutomationPage() {
  const { playbooks, loading: pbLoading, error: pbError, reload } = usePlaybooks()
  const { jobs, loading: sjLoading, error: sjError, reload: sjReload } = useScheduledJobs()
  const { role, username } = useAuth()
  const { scheduledJobsLimit } = useLicenseLimits()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'playbooks'
  const ScheduledJobsTable = PlusComponents.ScheduledJobsTable
  const ScheduledJobFormModal = PlusComponents.ScheduledJobFormModal
  const ScheduledJobDetailModal = PlusComponents.ScheduledJobDetailModal
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [editJob, setEditJob] = useState(null)
  const [detailJob, setDetailJob] = useState(null)
  const isAdmin = role === 'admin'
  // PROJ-93: Playbook-Editor-Tab (Plus + admin), via PlusComponents-Registry.
  const AnsibleEditorTab = PlusComponents.AnsibleEditorTab
  const canPlaybookEditor = useCapability('ansible_editor') && isAdmin
  const visibleTabs = canPlaybookEditor
    ? [...TABS, { id: 'playbook-editor', label: 'Playbook-Editor' }]
    : TABS
  const conflictIds = useGitSyncConflictIds('ansible', isAdmin)
  const myJobCount = jobs.filter(j => j.created_by === username).length
  const sjAtLimit = !scheduledJobsLimit?.unlimited && scheduledJobsLimit?.max !== null && scheduledJobsLimit?.max !== undefined && myJobCount >= scheduledJobsLimit?.max

  // PROJ-77: Deep-Link „/automation?tab=scheduled&openJob=<id>" öffnet das
  // Detail-Modal automatisch (z.B. aus AutoBadge in PROJ-74-Snapshots).
  const openJobParam = searchParams.get('openJob')
  useEffect(() => {
    if (!openJobParam || sjLoading) return
    const job = jobs.find(j => j.id === openJobParam)
    if (job) {
      setDetailJob(job)
      const next = new URLSearchParams(searchParams)
      next.delete('openJob')
      setSearchParams(next, { replace: true })
    }
  }, [openJobParam, sjLoading, jobs, searchParams, setSearchParams])

  const visible = role === 'viewer'
    ? playbooks.filter(pb => !pb.required_role)
    : playbooks
  const filtered = visible.filter(pb => pb.category === 'vm_lxc_config')

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
      activeTab === id
        ? 'border-orange-500 text-gray-900 dark:text-zinc-100'
        : 'border-transparent text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center justify-between px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Automation</h1>
          <HelpButton helpKey="automation" />
        </div>
        {activeTab === 'playbooks' && isAdmin && (
          <button
            onClick={() => setShowUpload(true)}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            Playbook hochladen
          </button>
        )}
        {activeTab === 'scheduled' && (
          <button
            onClick={() => setShowCreate(true)}
            disabled={sjAtLimit}
            title={sjAtLimit ? `Limit erreicht (${scheduledJobsLimit?.max} Jobs/Nutzer in Core)` : undefined}
            className="btn-primary flex items-center gap-1.5 text-xs"
          >
            Neuer Job
          </button>
        )}
      </header>

      <div className="flex border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 shrink-0">
        {visibleTabs.filter(tab => tab.id !== 'scheduled' || !!ScheduledJobsTable).map(tab => {
          const tabHelpKeys = {
            playbooks: 'automation.tabs.playbooks',
            scheduled: 'automation.tabs.scheduled',
            inventory: 'automation.tabs.inventory',
            'playbook-editor': 'automation.tabs.playbook_editor',
          }
          return (
            <button key={tab.id} onClick={() => setSearchParams({ tab: tab.id })} className={tabCls(tab.id)}>
              {tab.label}
              {tabHelpKeys[tab.id] && <TabHelpButton helpKey={tabHelpKeys[tab.id]} />}
            </button>
          )
        })}
        <div className="ml-auto self-center pr-1">
          <TabPinButton tabId={activeTab} label={TABS.find(t => t.id === activeTab)?.label ?? activeTab} />
        </div>
      </div>

      {activeTab === 'playbooks' && (
        <div className="flex flex-1 min-h-0 m-4 rounded-lg overflow-hidden border border-gray-200 dark:border-zinc-700">
          <div className="w-64 lg:w-72 xl:w-80 shrink-0 border-r border-gray-200 dark:border-zinc-700 overflow-y-auto p-3 space-y-2 bg-transparent">
            {pbLoading && (
              <div className="space-y-2">
                {[1, 2, 3].map(i => <div key={i} className="h-20 bg-gray-100 dark:bg-zinc-800 animate-pulse" />)}
              </div>
            )}
            {pbError && (
              <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                Fehler beim Laden.
              </div>
            )}
            {!pbLoading && !pbError && filtered.length === 0 && (
              <div className="py-16 text-center">
                <p className="text-sm text-gray-500 dark:text-zinc-400">Keine Playbooks gefunden.</p>
              </div>
            )}
            {filtered.map(pb => (
              <PlaybookCard key={pb.id} playbook={pb} selected={selected?.id === pb.id} onSelect={handleSelect} hasConflict={conflictIds.has(pb.id)} />
            ))}
          </div>
          <div className="flex flex-1 min-h-0">
            <div className="flex-1 overflow-y-auto p-6 bg-transparent">
              {detailLoading ? (
                <div className="flex flex-col items-center justify-center h-full">
                  <svg className="animate-spin w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                </div>
              ) : !selected ? (
                <PageDescription pageId="playbooks-vm-lxc-config" fallback="Playbook aus der Liste auswählen" />
              ) : (
                <div className="max-w-lg xl:max-w-xl 2xl:max-w-2xl">
                  <div className="mb-6 pb-4 border-b border-gray-200 dark:border-zinc-700">
                    <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{selected.name}</h2>
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
      )}

      {activeTab === 'scheduled' && (
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          <div className="max-w-6xl mx-auto">
            <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
              {sjLoading && (
                <div className="text-center py-16 text-gray-400 dark:text-zinc-500 text-sm">Lädt…</div>
              )}
              {sjError && !sjLoading && (
                <div className="text-center py-16">
                  <p className="text-sm text-red-500">Fehler beim Laden der Jobs.</p>
                  <button onClick={sjReload} className="mt-2 text-xs text-orange-600 hover:underline">Erneut versuchen</button>
                </div>
              )}
              {!sjLoading && !sjError && ScheduledJobsTable && (
                <Suspense fallback={null}>
                  <ScheduledJobsTable
                    jobs={jobs}
                    onEdit={setEditJob}
                    onDetail={setDetailJob}
                    onReload={sjReload}
                  />
                </Suspense>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'inventory' && (
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          <InventoryView />
          <Watermark />
        </div>
      )}

      {activeTab === 'playbook-editor' && canPlaybookEditor && AnsibleEditorTab && (
        <div className="flex flex-col flex-1 min-h-0">
          <Suspense fallback={<div className="p-6 text-sm text-gray-500 dark:text-zinc-400">…</div>}>
            <AnsibleEditorTab />
          </Suspense>
        </div>
      )}

      {showUpload && (
        <PlaybookUploadModal onClose={() => setShowUpload(false)} onUploaded={() => reload?.()} />
      )}
      {showCreate && ScheduledJobFormModal && (
        <Suspense fallback={null}>
          <ScheduledJobFormModal
            onClose={() => setShowCreate(false)}
            onSaved={() => { setShowCreate(false); sjReload() }}
            currentCount={myJobCount}
            maxJobs={scheduledJobsLimit && !scheduledJobsLimit.unlimited ? scheduledJobsLimit.max : null}
          />
        </Suspense>
      )}
      {editJob && ScheduledJobFormModal && (
        <Suspense fallback={null}>
          <ScheduledJobFormModal
            job={editJob}
            onClose={() => setEditJob(null)}
            onSaved={() => { setEditJob(null); sjReload() }}
          />
        </Suspense>
      )}
      {detailJob && ScheduledJobDetailModal && (
        <Suspense fallback={null}>
          <ScheduledJobDetailModal
            job={detailJob}
            onClose={() => setDetailJob(null)}
            onEdit={(j) => { setDetailJob(null); setEditJob(j) }}
            onReload={sjReload}
          />
        </Suspense>
      )}
    </div>
  )
}
