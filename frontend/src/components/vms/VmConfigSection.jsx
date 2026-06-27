// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import VmConfigEditModal from './VmConfigEditModal'
import AddDiskModal from './disks/AddDiskModal'
import ResizeDiskModal from './disks/ResizeDiskModal'
import RemoveDiskModal from './disks/RemoveDiskModal'
import { sizeToGib } from './disks/diskHelpers'
import HelpButton from '../../features/help/components/HelpButton'

function KvRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-zinc-500">{label}</span>
      <span className="text-xs text-gray-800 dark:text-zinc-200 font-mono">{value || '–'}</span>
    </div>
  )
}

const OS_LABELS = {
  l24: 'Linux 2.4', l26: 'Linux 2.6+', w2k: 'Windows 2000',
  wxp: 'Windows XP', w2k3: 'Windows 2003', w2k8: 'Windows 2008',
  wvista: 'Windows Vista', win7: 'Windows 7', win8: 'Windows 8/10',
  win10: 'Windows 10/11', win11: 'Windows 11', solaris: 'Solaris',
  other: 'Other',
}

function BoolBadge({ value }) {
  if (value === null || value === undefined) return <span className="text-xs font-mono text-gray-400 dark:text-zinc-600">–</span>
  return value
    ? <span className="text-xs font-mono text-portal-success">Ja</span>
    : <span className="text-xs font-mono text-gray-400 dark:text-zinc-500">Nein</span>
}

export default function VmConfigSection({ detail, canEdit = false, onSaved, managedByStack = null }) {
  const { t } = useTranslation()
  const osLabel = OS_LABELS[detail.ostype] ?? detail.ostype ?? '–'
  const [editing, setEditing] = useState(false)
  // PROJ-81: disk management modals
  const [addingDisk, setAddingDisk] = useState(false)
  const [resizingDisk, setResizingDisk] = useState(null) // { id, size }
  const [removingDisk, setRemovingDisk] = useState(null)  // { id }
  // PROJ-81: a single "Bearbeiten" toggle for the whole Konfiguration card.
  // Until it is on, nothing is mutable — the CPU/RAM modal trigger and the disk
  // actions stay hidden, so no destructive button is one accidental click away.
  const [editMode, setEditMode] = useState(false)
  // PROJ-76 Phase 2b: Stack-VMs werden über die Stack-Definition bearbeitet (AC-2B-MUT-2).
  const stackLocked = !!managedByStack
  // PROJ-81: disk actions only for QEMU VMs (LXC mountpoints are a non-goal),
  // never on templates, and not on stack-managed VMs (server enforces 409).
  const isQemu = detail.type === 'qemu'
  const canManageDisks = canEdit && !detail.is_template && isQemu && !stackLocked
  const confirmToken = detail.name || String(detail.vmid)

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
          Konfiguration
        </h2>
        {canEdit && !detail.is_template && (
          stackLocked ? (
            <span
              title={t('stacks.managed_by.locked_title')}
              className="btn-table flex items-center gap-1.5 opacity-50 cursor-not-allowed"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 0h10.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H6.75a1.5 1.5 0 0 1-1.5-1.5v-6a1.5 1.5 0 0 1 1.5-1.5Z" />
              </svg>
              {t('stacks.managed_by.locked_label')}
            </span>
          ) : editMode ? (
            <span className="flex items-center gap-1.5">
              <button onClick={() => setEditing(true)} className="btn-table flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
                </svg>
                CPU, RAM &amp; Optionen
              </button>
              <button onClick={() => setEditMode(false)} className="btn-secondary">Fertig</button>
            </span>
          ) : (
            <button onClick={() => setEditMode(true)} className="btn-table flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z" />
              </svg>
              Bearbeiten
            </button>
          )
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Base info */}
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">Allgemein</p>
          <KvRow label="CPU-Kerne" value={String(detail.cpu_cores)} />
          {detail.sockets != null && (
            <KvRow label="CPU-Sockets" value={String(detail.sockets)} />
          )}
          {detail.cpu_type && (
            <KvRow label="CPU-Typ" value={detail.cpu_type} />
          )}
          {detail.type === 'qemu' && <KvRow label="BIOS" value={detail.bios} />}
          <KvRow label="OS-Typ" value={osLabel} />
          <KvRow label="Typ" value={detail.type === 'qemu' ? 'QEMU/KVM' : 'LXC Container'} />
          {detail.onboot != null && (
            <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
              <span className="text-xs text-gray-500 dark:text-zinc-500">Start bei Boot</span>
              <BoolBadge value={detail.onboot} />
            </div>
          )}
          {detail.protection != null && (
            <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
              <span className="text-xs text-gray-500 dark:text-zinc-500">Lösch-Schutz</span>
              <BoolBadge value={detail.protection} />
            </div>
          )}
          {/* LXC-spezifisch */}
          {detail.lxc_hostname && (
            <KvRow label="Hostname (LXC)" value={detail.lxc_hostname} />
          )}
          {detail.lxc_ostemplate && (
            <KvRow label="OS-Template" value={detail.lxc_ostemplate} />
          )}
        </div>

        {/* Network interfaces */}
        <div>
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">
            Netzwerk ({detail.networks.length})
          </p>
          {detail.networks.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-zinc-600">Keine Netzwerkadapter.</p>
          ) : (
            <div className="space-y-2">
              {detail.networks.map((nic) => (
                <div key={nic.id} className="border border-gray-100 dark:border-zinc-800 rounded px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono text-gray-700 dark:text-zinc-300">{nic.id}</span>
                    <span className="text-gray-400 dark:text-zinc-600">{nic.model}</span>
                  </div>
                  <div className="text-gray-500 dark:text-zinc-500">
                    {nic.bridge}{nic.mac ? ` · ${nic.mac}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Disks */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="flex items-center gap-1 text-xs font-medium text-gray-400 dark:text-zinc-600">
              Festplatten ({detail.disks.length})
              {isQemu && <HelpButton helpKey="vm_detail.disks" />}
            </p>
            {canManageDisks && editMode && (
              <button onClick={() => setAddingDisk(true)} className="btn-table flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-3 h-3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Hinzufügen
              </button>
            )}
          </div>
          {/* Stack-managed: disk actions go through the stack definition (AC-STACK-BLOCK-1) */}
          {isQemu && stackLocked && canEdit && !detail.is_template && (
            <p className="text-xs text-gray-400 dark:text-zinc-600 mb-2">{t('stacks.managed_by.locked_label')}</p>
          )}
          {detail.disks.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-zinc-600">Keine Festplatten.</p>
          ) : (
            <div className="space-y-2">
              {detail.disks.map((disk) => (
                <div key={disk.id} className="border border-gray-100 dark:border-zinc-800 rounded px-2.5 py-2 text-xs">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono text-gray-700 dark:text-zinc-300">{disk.id}</span>
                    <span className="text-gray-400 dark:text-zinc-600 font-mono">{disk.size}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-500 dark:text-zinc-500">{disk.storage}</span>
                    {canManageDisks && editMode && (
                      <span className="flex items-center gap-1">
                        <button
                          onClick={() => setResizingDisk({ id: disk.id, size: sizeToGib(disk.size) })}
                          className="btn-table"
                        >
                          Vergrößern
                        </button>
                        <button onClick={() => setRemovingDisk({ id: disk.id })} className="btn-table-danger">
                          Entfernen
                        </button>
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Beschreibung / Notizen */}
      {detail.description && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-zinc-800">
          <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">Notizen</p>
          <pre className="text-xs text-gray-700 dark:text-zinc-300 whitespace-pre-wrap font-sans leading-relaxed bg-gray-50 dark:bg-zinc-800 rounded px-3 py-2">
            {detail.description}
          </pre>
        </div>
      )}

      {editing && (
        <VmConfigEditModal
          detail={detail}
          onClose={() => setEditing(false)}
          onSaved={onSaved}
        />
      )}

      {addingDisk && (
        <AddDiskModal
          vmid={detail.vmid}
          node={detail.node}
          vmName={detail.name}
          onClose={() => setAddingDisk(false)}
          onSaved={onSaved}
        />
      )}

      {resizingDisk && (
        <ResizeDiskModal
          vmid={detail.vmid}
          node={detail.node}
          disk={resizingDisk.id}
          currentSizeGb={resizingDisk.size}
          vmName={detail.name}
          onClose={() => setResizingDisk(null)}
          onSaved={onSaved}
        />
      )}

      {removingDisk && (
        <RemoveDiskModal
          vmid={detail.vmid}
          node={detail.node}
          disk={removingDisk.id}
          confirmToken={confirmToken}
          vmName={detail.name}
          onClose={() => setRemovingDisk(null)}
          onSaved={onSaved}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
