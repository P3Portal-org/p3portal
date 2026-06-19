// p3portal.org
// PROJ-96: Aktions-Impact-Warnung. Rein Core: basiert ausschließlich auf dem
// HTTP-409-Vertrag der Power-Endpoints ({error:'dependency_impact', count,
// dependents}). Im Core-Mode (Plus ohne Lizenz) liefert das Backend nie diesen
// 409 (Hook No-Op) → der Dialog erscheint nie. Daher kein Plus-Import nötig und
// kein Core-Bundle-Leak. DE-Texte hartkodiert, konsistent mit den umgebenden
// Core-VM-Komponenten (VmActionButtons/VmTable/VmSnapshotSection).
import { useState } from 'react'

export default function DependencyImpactModal({ data, actionLabel, onConfirm, onCancel }) {
  const [busy, setBusy] = useState(false)
  const deps = data?.dependents || []
  const count = data?.count ?? deps.length

  const handle = async () => {
    if (busy) return
    setBusy(true)
    // onConfirm wirft nie nach außen (resolved/rejected die ursprüngliche Aktion);
    // das Modal schließt danach über den Guard.
    await onConfirm()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dep-impact-title"
    >
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 id="dep-impact-title" className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            Abhängige VMs betroffen
          </h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          <p className="text-sm text-gray-700 dark:text-zinc-300">
            {count === 1
              ? '1 VM hängt von dieser VM ab:'
              : `${count} VMs hängen von dieser VM ab:`}
          </p>
          <ul className="rounded-md border border-portal-warn/30 bg-portal-warn/10 divide-y divide-portal-warn/20 max-h-48 overflow-y-auto">
            {deps.map((d, i) => (
              <li key={`${d.node || ''}-${d.vmid}-${i}`} className="px-3 py-1.5 text-xs">
                <span className="font-medium text-gray-900 dark:text-zinc-100">{d.name || `#${d.vmid}`}</span>
                <span className="text-gray-400 dark:text-zinc-500 tabular-nums"> · {d.vmid}</span>
                {d.installation && <span className="text-gray-400 dark:text-zinc-500"> · {d.installation}</span>}
                {d.dep_label && <span className="text-portal-text2 italic"> — {d.dep_label}</span>}
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 dark:text-zinc-400">
            {actionLabel
              ? `„${actionLabel}" trotzdem ausführen? Die abhängigen VMs werden nicht automatisch mit behandelt.`
              : 'Aktion trotzdem ausführen? Die abhängigen VMs werden nicht automatisch mit behandelt.'}
          </p>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            Abbrechen
          </button>
          <button type="button" onClick={handle} disabled={busy} className="btn-danger">
            {busy ? '…' : 'Trotzdem fortfahren'}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
