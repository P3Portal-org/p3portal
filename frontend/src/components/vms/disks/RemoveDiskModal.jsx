// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { removeDisk } from '../../../api/vms'
import { diskErrMsg, modalInputCls } from './diskHelpers'

export default function RemoveDiskModal({ vmid, node, disk, confirmToken, vmName, onClose, onSaved }) {
  const { t } = useTranslation()
  // The backend expects the VM name (or vmid as string) as confirmation token.
  const expected = confirmToken
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const matches = typed === expected

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!matches) {
      setError(t('vm_disks.remove_validate_mismatch'))
      return
    }
    setSaving(true)
    setError('')
    try {
      await removeDisk(vmid, disk, typed, node)
      onSaved?.()
      onClose()
    } catch (err) {
      setError(diskErrMsg(err, t))
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
              {t('vm_disks.remove_title', { disk })}
            </h2>
            {vmName && <p className="text-xs text-gray-500 dark:text-zinc-500 mt-0.5">{vmName}</p>}
          </div>
          <button onClick={onClose} aria-label={t('vm_disks.close')} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded px-3 py-2.5">
            <p className="font-medium mb-1">{t('vm_disks.remove_warn_title')}</p>
            <p className="text-xs opacity-90">
              {t('vm_disks.remove_warn_body_pre', { disk })}
              <strong>{t('vm_disks.remove_warn_body_strong')}</strong>
              {t('vm_disks.remove_warn_body_post')}
            </p>
          </div>

          <div>
            <label htmlFor="remove-confirm" className="block text-xs text-gray-500 dark:text-zinc-500 mb-1">
              {t('vm_disks.remove_label_confirm', { name: expected })}
            </label>
            <input id="remove-confirm" type="text" autoComplete="off" value={typed}
              onChange={(e) => { setError(''); setTyped(e.target.value) }} className={modalInputCls} />
          </div>
        </form>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200 dark:border-zinc-700 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">{t('vm_disks.cancel')}</button>
          <button type="button" onClick={handleSubmit} disabled={saving || !matches} className="btn-danger">
            {saving ? t('vm_disks.remove_btn_saving') : t('vm_disks.remove_btn_remove')}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
