// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getPlaybookVmidRange, setPlaybookVmidRange } from '../../api/admin'

export default function PlaybookVmidRangeSection() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(null)
  const [draftMin, setDraftMin] = useState('')
  const [draftMax, setDraftMax] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await getPlaybookVmidRange()
      setCurrent(data)
    } catch {
      // ignore until backend deployed
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleEdit = () => {
    setDraftMin(String(current?.min ?? 100))
    setDraftMax(String(current?.max ?? 999999))
    setEditing(true)
    setOk('')
    setError('')
  }

  const handleSave = async () => {
    const min = parseInt(draftMin, 10)
    const max = parseInt(draftMax, 10)
    if (isNaN(min) || isNaN(max)) { setError(t('admin.vmid_range.err_invalid')); return }
    if (min >= max) { setError(t('admin.vmid_range.err_min_max')); return }
    setSaving(true); setError('')
    try {
      await setPlaybookVmidRange(min, max)
      await load()
      setEditing(false)
      setOk(t('admin.vmid_range.ok_saved'))
    } catch {
      setError(t('admin.vmid_range.err_save'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-6 mt-6 rounded-lg">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
            {t('admin.playbook_vmid_range.title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-zinc-500 mt-0.5">
            {t('admin.playbook_vmid_range.description')}
          </p>
        </div>
        {!editing && (
          <button
            onClick={handleEdit}
            className="text-sm text-portal-accent hover:text-portal-accent/80 transition-colors"
          >
            {t('admin.vmid_range.btn_change')}
          </button>
        )}
      </div>

      {!editing && current && (
        <div className="flex items-center gap-3">
          <code className="text-xs font-mono bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-3 py-2 text-gray-700 dark:text-zinc-300">
            {current.min} – {current.max}
          </code>
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1">{t('admin.vmid_range.label_min')}</label>
              <input
                type="number"
                value={draftMin}
                min={100}
                max={999999999}
                onChange={e => setDraftMin(e.target.value)}
                className={inputCls}
              />
            </div>
            <span className="text-gray-400 dark:text-zinc-500 mt-5">–</span>
            <div className="flex-1">
              <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1">{t('admin.vmid_range.label_max')}</label>
              <input
                type="number"
                value={draftMax}
                min={100}
                max={999999999}
                onChange={e => setDraftMax(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? t('admin.vmid_range.saving') : t('admin.vmid_range.save')}
            </button>
            <button
              onClick={() => { setEditing(false); setError('') }}
              className="text-sm text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200 px-4 py-2 transition-colors"
            >
              {t('admin.vmid_range.cancel')}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-portal-danger">{error}</p>}
      {ok && <p className="mt-2 text-xs text-portal-success">{ok}</p>}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
