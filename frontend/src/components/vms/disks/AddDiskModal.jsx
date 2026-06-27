// p3portal.org
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { listImageStorages, attachDisk } from '../../../api/vms'
import { diskErrMsg, formatBytes, modalInputCls } from './diskHelpers'

const BUS_OPTIONS = [
  { value: 'scsi', label: 'SCSI' },
  { value: 'virtio', label: 'VirtIO' },
  { value: 'sata', label: 'SATA' },
]

export default function AddDiskModal({ vmid, node, vmName, onClose, onSaved }) {
  const { t } = useTranslation()
  const [storages, setStorages] = useState(null) // null = loading, [] = loaded
  const [storagesErr, setStoragesErr] = useState('')
  const [form, setForm] = useState({ size_gb: '32', storage: '', bus: 'scsi' })
  const [armed, setArmed] = useState(false) // zweite Bestätigung (gegen versehentliche Änderung)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Jede Eingabe-Änderung hebt eine bereits gegebene Bestätigung wieder auf.
  const set = (k, v) => { setError(''); setArmed(false); setForm((f) => ({ ...f, [k]: v })) }

  useEffect(() => {
    let active = true
    setStorages(null)
    setStoragesErr('')
    listImageStorages(node)
      .then((rows) => {
        if (!active) return
        setStorages(rows)
        if (rows.length > 0) setForm((f) => ({ ...f, storage: f.storage || rows[0].name }))
      })
      .catch((err) => { if (active) { setStorages([]); setStoragesErr(diskErrMsg(err, t)) } })
    return () => { active = false }
  }, [node, t])

  const sizeNum = parseInt(form.size_gb, 10)

  const validate = () => {
    if (Number.isNaN(sizeNum) || sizeNum < 1) { setError(t('vm_disks.add_validate_size')); return false }
    if (!form.storage) { setError(t('vm_disks.add_validate_storage')); return false }
    return true
  }

  const handlePrimary = async (e) => {
    e.preventDefault()
    // 1. Bestätigung: validieren und "scharf schalten".
    if (!armed) {
      if (validate()) setArmed(true)
      return
    }
    // 2. Bestätigung: ausführen.
    setSaving(true)
    setError('')
    try {
      await attachDisk(vmid, { size_gb: sizeNum, storage: form.storage, bus: form.bus }, node)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(diskErrMsg(err, t))
      setArmed(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-xl w-full max-w-md max-h-[85vh] flex flex-col rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{t('vm_disks.add_title')}</h2>
            {vmName && <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">{vmName}</p>}
          </div>
          <button onClick={onClose} aria-label={t('vm_disks.close')} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handlePrimary} className="overflow-y-auto flex-1 p-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label htmlFor="disk-size" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('vm_disks.add_label_size')}</label>
            <input id="disk-size" type="number" min={1} max={131072} value={form.size_gb}
              onChange={(e) => set('size_gb', e.target.value)} className={modalInputCls} />
          </div>

          <div>
            <label htmlFor="disk-storage" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('vm_disks.add_label_storage')}</label>
            {storages === null ? (
              <p className="text-xs text-gray-400 dark:text-zinc-500 animate-pulse py-2">{t('vm_disks.add_loading_storages')}</p>
            ) : storages.length === 0 ? (
              <p className="text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded px-3 py-2">
                {storagesErr || t('vm_disks.add_no_storages')}
              </p>
            ) : (
              <select id="disk-storage" value={form.storage}
                onChange={(e) => set('storage', e.target.value)} className={modalInputCls}>
                {storages.map((s) => (
                  <option key={s.name} value={s.name}>
                    {t('vm_disks.add_storage_option', { name: s.name, avail: formatBytes(s.avail), total: formatBytes(s.total) })}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label htmlFor="disk-bus" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">{t('vm_disks.add_label_bus')}</label>
            <select id="disk-bus" value={form.bus}
              onChange={(e) => set('bus', e.target.value)} className={modalInputCls}>
              {BUS_OPTIONS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
            <p className="text-xs text-gray-400 dark:text-zinc-600 mt-1">{t('vm_disks.add_bus_hint')}</p>
          </div>

          {/* Zweite Bestätigung */}
          {armed && (
            <p className="text-sm text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded px-3 py-2.5">
              {t('vm_disks.add_armed', {
                size: sizeNum,
                storage: form.storage,
                bus: BUS_OPTIONS.find((b) => b.value === form.bus)?.label,
              })}
            </p>
          )}
        </form>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-zinc-700 shrink-0">
          {armed && (
            <button type="button" onClick={() => setArmed(false)} disabled={saving} className="btn-secondary mr-auto">{t('vm_disks.back')}</button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">{t('vm_disks.cancel')}</button>
          <button type="button" onClick={handlePrimary} disabled={saving || storages === null || (storages?.length === 0)}
            className="btn-primary">
            {saving ? t('vm_disks.add_btn_saving') : armed ? t('vm_disks.confirm') : t('vm_disks.add_btn_attach')}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
