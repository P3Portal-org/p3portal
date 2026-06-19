// p3portal.org
import { useState } from 'react'
import { startVm, stopVm, rebootVm } from '../../api/vms'
import ConfirmModal from '../common/ConfirmModal'
import { useDependencyImpactGuard } from './useDependencyImpactGuard'

const ACTIONS = {
  start:  { label: 'Starten',    needsConfirm: false, danger: false },
  stop:   { label: 'Stoppen',    needsConfirm: true,  danger: true  },
  reboot: { label: 'Neustarten', needsConfirm: true,  danger: false },
}

const ICONS = {
  start: (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" />
    </svg>
  ),
  stop: (
    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M6 6h12v12H6z" />
    </svg>
  ),
  reboot: (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
}

function errMsg(err) {
  const s = err.response?.status
  const d = err.response?.data?.detail
  if (s === 403) return 'Keine Berechtigung für diese Aktion.'
  if (s === 503) return 'Service-Account nicht konfiguriert.'
  if (s === 404) return 'VM nicht gefunden.'
  return d ?? 'Fehler beim Ausführen der Aktion.'
}

function SingleAction({ action, vmid, node, vmStatus, onSuccess, onError, onConfirmRequested, guardedRun, compact }) {
  const [busy, setBusy] = useState(false)
  const cfg = ACTIONS[action]

  const isDisabled =
    (action === 'start'  && vmStatus === 'running') ||
    (action === 'stop'   && vmStatus !== 'running') ||
    (action === 'reboot' && vmStatus !== 'running')

  const execute = async () => {
    setBusy(true)
    try {
      // PROJ-96: stop/reboot durchlaufen die Abhängigkeits-Impact-Warnung
      // (409 → Dialog → Retry mit confirm); start ist ungeguardet.
      if (action === 'start')  await startVm(vmid, node)
      if (action === 'stop')   await guardedRun((confirm) => stopVm(vmid, node, { confirm }), cfg.label)
      if (action === 'reboot') await guardedRun((confirm) => rebootVm(vmid, node, { confirm }), cfg.label)
      onSuccess?.(`VM ${vmid}: ${cfg.label} wurde gestartet.`)
    } catch (err) {
      if (err?.cancelled) return  // Impact-Dialog abgebrochen → kein Fehler-Toast
      onError?.(errMsg(err))
    } finally {
      setBusy(false)
    }
  }

  const handleClick = () => {
    if (isDisabled || busy) return
    if (cfg.needsConfirm) onConfirmRequested(action, execute)
    else execute()
  }

  if (compact) {
    return (
      <button
        onClick={handleClick}
        disabled={isDisabled || busy}
        title={cfg.label}
        className={`p-1.5 border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          cfg.danger
            ? 'text-red-500 dark:text-red-400 border-red-200 dark:border-red-900 enabled:hover:bg-red-50 dark:enabled:hover:bg-red-950/30 enabled:hover:border-red-400 dark:enabled:hover:border-red-700'
            : 'text-gray-600 dark:text-zinc-400 border-gray-200 dark:border-zinc-700 enabled:hover:bg-gray-50 dark:enabled:hover:bg-zinc-800 enabled:hover:border-gray-400 dark:enabled:hover:border-zinc-500'
        }`}
      >
        {busy ? <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[10px]">…</span> : ICONS[action]}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={isDisabled || busy}
      className={`text-xs px-2 py-1 border transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        cfg.danger
          ? 'text-red-500 dark:text-red-400 border-red-200 dark:border-red-900 enabled:hover:bg-red-50 dark:enabled:hover:bg-red-950/30 enabled:hover:border-red-400 dark:enabled:hover:border-red-700'
          : 'text-gray-600 dark:text-zinc-400 border-gray-200 dark:border-zinc-700 enabled:hover:bg-gray-50 dark:enabled:hover:bg-zinc-800 enabled:hover:border-gray-400 dark:enabled:hover:border-zinc-500'
      }`}
    >
      {busy ? '…' : cfg.label}
    </button>
  )
}

export default function VmActionButtons({ vm, onSuccess, onError, compact = false }) {
  const [pendingConfirm, setPendingConfirm] = useState(null)
  const { guardedRun, impactModal } = useDependencyImpactGuard()
  const perms = vm.permissions

  const visible = perms == null
    ? ['start', 'stop', 'reboot']
    : ['start', 'stop', 'reboot'].filter((a) => perms.includes(a))

  if (visible.length === 0) return null

  const cfg = pendingConfirm ? ACTIONS[pendingConfirm.action] : null

  return (
    <div className="flex items-center gap-1">
      {visible.map((action) => (
        <SingleAction
          key={action}
          action={action}
          vmid={vm.vmid}
          node={vm.node}
          vmStatus={vm.status}
          onSuccess={onSuccess}
          onError={onError}
          onConfirmRequested={(a, execute) => setPendingConfirm({ action: a, execute })}
          guardedRun={guardedRun}
          compact={compact}
        />
      ))}
      {impactModal}
      {pendingConfirm && (
        <ConfirmModal
          title={`VM ${vm.vmid} ${cfg.label.toLowerCase()}?`}
          body={`Aktion „${cfg.label}" für VM ${vm.vmid} wirklich ausführen?`}
          confirmLabel={cfg.label}
          variant={cfg.danger ? 'danger' : 'primary'}
          onConfirm={async () => {
            const { execute } = pendingConfirm
            setPendingConfirm(null)
            await execute()
          }}
          onClose={() => setPendingConfirm(null)}
        />
      )}
    </div>
  )
}
