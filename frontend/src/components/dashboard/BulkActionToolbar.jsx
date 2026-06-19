// p3portal.org
import { useState } from 'react'
import { startVm, stopVm, rebootVm, checkVmSsh } from '../../api/vms'
import { vmIpKey } from '../../hooks/useVmIps'

export default function BulkActionToolbar({ selected, vms, vmIps, onDone, onSshUpdate }) {
  const [busy, setBusy] = useState(null)
  const [resultMsg, setResultMsg] = useState(null)

  const selectedVms = vms.filter(vm => selected.has(vmIpKey(vm)))

  const finish = (msg) => {
    setResultMsg(msg)
    setBusy(null)
    setTimeout(() => {
      setResultMsg(null)
      onDone?.()
    }, 2500)
  }

  const bulkAction = async (action) => {
    const labels = { start: 'gestartet', stop: 'gestoppt', reboot: 'neugestartet' }
    // PROJ-96: Bulk-Aktionen setzen confirm=true (bewusste Mehrfach-Auswahl =
    // bewusste Bestätigung; kein Per-VM-Impact-Dialog bei Bulk — MVP-Grenze).
    const fns = {
      start: (vm) => startVm(vm.vmid, vm.node),
      stop: (vm) => stopVm(vm.vmid, vm.node, { confirm: true }),
      reboot: (vm) => rebootVm(vm.vmid, vm.node, { confirm: true }),
    }
    setBusy(action)
    const results = await Promise.allSettled(selectedVms.map(fns[action]))
    const ok = results.filter(r => r.status === 'fulfilled').length
    finish(`${ok}/${selectedVms.length} ${labels[action]}`)
  }

  const handleSshCheck = async () => {
    setBusy('ssh')
    const updates = {}
    selectedVms.forEach(vm => {
      const k = vmIpKey(vm)
      if (vm.status === 'running' && vmIps[k]) updates[k] = 'checking'
    })
    onSshUpdate?.(updates)

    await Promise.allSettled(
      selectedVms.map(async (vm) => {
        const k = vmIpKey(vm)
        if (vm.status !== 'running') return
        const ip = vmIps[k]
        if (!ip) {
          updates[k] = 'unreachable'
          return
        }
        try {
          const res = await checkVmSsh(vm.node, vm.vmid, ip)
          updates[k] = res.reachable ? 'reachable' : 'unreachable'
        } catch {
          updates[k] = 'unreachable'
        }
      })
    )
    onSshUpdate?.({ ...updates })
    setBusy(null)
  }

  const btnBase = 'text-xs px-2.5 py-1 border transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div data-testid="bulk-toolbar" className="mb-3 flex items-center gap-3 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm">
      <span className="text-blue-700 dark:text-blue-300 font-medium tabular-nums">
        {selected.size} ausgewählt
      </span>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => bulkAction('start')}
          disabled={!!busy}
          className={`${btnBase} text-gray-600 dark:text-zinc-300 border-gray-200 dark:border-zinc-600 hover:bg-gray-100 dark:hover:bg-zinc-700`}
        >
          {busy === 'start' ? '…' : 'Starten'}
        </button>
        <button
          onClick={() => bulkAction('stop')}
          disabled={!!busy}
          className={`${btnBase} text-red-500 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950/30`}
        >
          {busy === 'stop' ? '…' : 'Stoppen'}
        </button>
        <button
          onClick={() => bulkAction('reboot')}
          disabled={!!busy}
          className={`${btnBase} text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800 hover:bg-orange-50 dark:hover:bg-orange-950/30`}
        >
          {busy === 'reboot' ? '…' : 'Neustart'}
        </button>
        <button
          onClick={handleSshCheck}
          disabled={!!busy}
          className={`${btnBase} text-teal-600 dark:text-teal-400 border-teal-200 dark:border-teal-800 hover:bg-teal-50 dark:hover:bg-teal-950/30`}
          title="SSH-Erreichbarkeit für ausgewählte VMs prüfen"
        >
          {busy === 'ssh' ? '…' : 'SSH-Check'}
        </button>
      </div>

      {resultMsg && (
        <span className="text-xs text-green-700 dark:text-green-400 font-medium">{resultMsg}</span>
      )}
    </div>
  )
}
