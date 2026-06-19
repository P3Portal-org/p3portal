// p3portal.org
import { useState } from 'react'
import { resizeDisk } from '../../../api/vms'
import { diskErrMsg, modalInputCls } from './diskHelpers'

export default function ResizeDiskModal({ vmid, node, disk, currentSizeGb, vmName, onClose, onSaved }) {
  const [sizeGb, setSizeGb] = useState(String((currentSizeGb || 0) + 1))
  const [armed, setArmed] = useState(false) // zweite Bestätigung
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const size = parseInt(sizeGb, 10)

  const validate = () => {
    if (Number.isNaN(size) || size < 1) { setError('Bitte eine gültige Größe angeben.'); return false }
    if (size <= currentSizeGb) {
      setError(`Neue Größe muss größer als die aktuelle (${currentSizeGb} GB) sein – Verkleinern ist nicht möglich.`)
      return false
    }
    return true
  }

  const handlePrimary = async (e) => {
    e.preventDefault()
    if (!armed) {
      if (validate()) setArmed(true)
      return
    }
    setSaving(true)
    setError('')
    try {
      await resizeDisk(vmid, disk, size, node)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(diskErrMsg(err))
      setArmed(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-md flex flex-col rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              Festplatte <span className="font-mono">{disk}</span> vergrößern
            </h2>
            {vmName && <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">{vmName}</p>}
          </div>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handlePrimary} className="p-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          <p className="text-xs text-gray-500 dark:text-zinc-400">
            Aktuelle Größe: <span className="font-mono text-gray-700 dark:text-zinc-200">{currentSizeGb} GB</span>.
            Festplatten können nur vergrößert, nicht verkleinert werden.
          </p>

          <div>
            <label htmlFor="resize-size" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">Neue Größe (GB)</label>
            <input id="resize-size" type="number" min={currentSizeGb + 1} max={131072} value={sizeGb}
              onChange={(e) => { setError(''); setArmed(false); setSizeGb(e.target.value) }} className={modalInputCls} />
          </div>

          {/* Zweite Bestätigung */}
          {armed && (
            <p className="text-sm text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded px-3 py-2.5">
              Festplatte <span className="font-mono">{disk}</span> von <strong>{currentSizeGb} GB</strong> auf{' '}
              <strong>{size} GB</strong> vergrößern? Zum Ausführen erneut bestätigen.
            </p>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-zinc-700 shrink-0">
          {armed && (
            <button type="button" onClick={() => setArmed(false)} disabled={saving} className="btn-secondary mr-auto">Zurück</button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
          <button type="button" onClick={handlePrimary} disabled={saving} className="btn-primary">
            {saving ? 'Vergrößere…' : armed ? 'Bestätigen' : 'Vergrößern'}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
