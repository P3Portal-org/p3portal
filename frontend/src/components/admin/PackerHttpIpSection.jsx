// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getPackerHttpIp, setPackerHttpIp } from '../../api/admin'

export default function PackerHttpIpSection() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await getPackerHttpIp()
      setCurrent(data.packer_http_ip || '')
    } catch {
      setCurrent('')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleEdit = () => {
    setDraft(current)
    setEditing(true)
    setOk('')
    setError('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await setPackerHttpIp(draft.trim())
      await load()
      setEditing(false)
      setOk(t('admin.packer_http_ip.ok_saved'))
    } catch {
      setError(t('admin.packer_http_ip.err_save'))
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition font-mono'

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-6 mt-6 rounded-lg">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
            {t('admin.packer_http_ip.title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-zinc-500 mt-0.5">
            {t('admin.packer_http_ip.description')}
          </p>
        </div>
        {!editing && (
          <button
            onClick={handleEdit}
            className="text-sm text-portal-accent hover:text-portal-accent/80 transition-colors shrink-0 ml-4"
          >
            {t('admin.packer_http_ip.btn_change')}
          </button>
        )}
      </div>

      {!editing && current !== null && (
        <div className="flex items-center gap-3">
          {current ? (
            <code className="text-xs font-mono bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-3 py-2 text-gray-700 dark:text-zinc-300">
              {current}
            </code>
          ) : (
            <span className="text-sm text-gray-400 dark:text-zinc-500 italic">
              {t('admin.packer_http_ip.not_set')}
            </span>
          )}
        </div>
      )}

      {editing && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1">
              {t('admin.packer_http_ip.label_ip')}
            </label>
            <input
              type="text"
              value={draft}
              placeholder="192.168.1.100"
              onChange={e => setDraft(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? t('admin.packer_http_ip.saving') : t('admin.packer_http_ip.save')}
            </button>
            <button
              onClick={() => { setEditing(false); setError('') }}
              className="btn-secondary"
            >
              {t('admin.packer_http_ip.cancel')}
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
