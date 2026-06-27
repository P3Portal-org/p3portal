// p3portal.org
import { useState, useMemo } from 'react'
import { updateVmConfig } from '../../api/vms'

function errMsg(err) {
  const s = err.response?.status
  const d = err.response?.data?.detail
  if (s === 403) return 'Keine Berechtigung, diese VM zu konfigurieren.'
  if (s === 422) return typeof d === 'string' ? d : 'Ungültige Eingabe.'
  if (s === 503) return 'Service-Account nicht konfiguriert.'
  if (s === 502) return 'Proxmox API nicht erreichbar.'
  return d ?? 'Fehler beim Speichern der Konfiguration.'
}

const inputCls =
  'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent'

export default function VmConfigEditModal({ detail, onClose, onSaved }) {
  const isQemu = detail.type === 'qemu'
  const initialMemMB = useMemo(
    () => (detail.mem_total ? Math.round(detail.mem_total / 1024 / 1024) : 0),
    [detail.mem_total],
  )

  const [form, setForm] = useState({
    cores: String(detail.cpu_cores ?? 1),
    sockets: String(detail.sockets ?? 1),
    memory: String(initialMemMB || ''),
    swap: '',
    onboot: detail.onboot ?? false,
    protection: detail.protection ?? false,
    description: detail.description ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => { setError(''); setForm((f) => ({ ...f, [k]: v })) }

  const buildPayload = () => {
    const p = {}
    const cores = parseInt(form.cores, 10)
    if (!Number.isNaN(cores) && cores !== (detail.cpu_cores ?? 1)) p.cores = cores

    const mem = parseInt(form.memory, 10)
    if (!Number.isNaN(mem) && mem !== initialMemMB) p.memory = mem

    if (isQemu) {
      const sockets = parseInt(form.sockets, 10)
      if (!Number.isNaN(sockets) && sockets !== (detail.sockets ?? 1)) p.sockets = sockets
    } else if (form.swap.trim() !== '') {
      const swap = parseInt(form.swap, 10)
      if (!Number.isNaN(swap)) p.swap = swap
    }

    if (form.onboot !== (detail.onboot ?? false)) p.onboot = form.onboot
    if (form.protection !== (detail.protection ?? false)) p.protection = form.protection
    if (form.description !== (detail.description ?? '')) p.description = form.description
    return p
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const payload = buildPayload()
    if (Object.keys(payload).length === 0) {
      setError('Keine Änderungen vorgenommen.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await updateVmConfig(detail.vmid, payload, detail.node)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setSaving(false)
    }
  }

  const running = detail.status === 'running'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Konfiguration ändern – {isQemu ? 'VM' : 'CT'} {detail.vmid}
            </h2>
            {detail.name && (
              <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">{detail.name}</p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-5 space-y-4">
          {running && isQemu && (
            <p className="text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded px-3 py-2">
              Die VM läuft. CPU-/RAM-Änderungen werden in der Regel erst nach einem Neustart wirksam (außer Hot-Plug ist aktiviert).
            </p>
          )}

          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="cfg-cores" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">CPU-Kerne</label>
              <input id="cfg-cores" type="number" min={1} max={1024} value={form.cores}
                onChange={(e) => set('cores', e.target.value)} className={inputCls} />
            </div>
            {isQemu && (
              <div>
                <label htmlFor="cfg-sockets" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">CPU-Sockets</label>
                <input id="cfg-sockets" type="number" min={1} max={1024} value={form.sockets}
                  onChange={(e) => set('sockets', e.target.value)} className={inputCls} />
              </div>
            )}
            <div>
              <label htmlFor="cfg-memory" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">RAM (MB)</label>
              <input id="cfg-memory" type="number" min={16} value={form.memory}
                onChange={(e) => set('memory', e.target.value)} className={inputCls} />
            </div>
            {!isQemu && (
              <div>
                <label htmlFor="cfg-swap" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">Swap (MB)</label>
                <input id="cfg-swap" type="number" min={0} placeholder="unverändert" value={form.swap}
                  onChange={(e) => set('swap', e.target.value)} className={inputCls} />
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.onboot}
                onChange={(e) => set('onboot', e.target.checked)}
                className="accent-portal-accent" />
              Start bei Boot
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300">
              <input type="checkbox" checked={form.protection}
                onChange={(e) => set('protection', e.target.checked)}
                className="accent-portal-accent" />
              Lösch-Schutz
            </label>
          </div>

          <div>
            <label htmlFor="cfg-desc" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">Notizen</label>
            <textarea id="cfg-desc" rows={3} value={form.description}
              onChange={(e) => set('description', e.target.value)}
              className={`${inputCls} font-sans resize-y`} />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-zinc-700 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
          <button type="button" onClick={handleSubmit} disabled={saving} className="btn-primary">
            {saving ? 'Speichere…' : 'Speichern'}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
