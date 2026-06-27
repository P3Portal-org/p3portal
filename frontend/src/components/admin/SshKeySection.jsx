// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getSshKey, setSshKey, deleteSshKey } from '../../api/settings'

function maskKey(key) {
  if (!key) return null
  const parts = key.trim().split(/\s+/)
  const type = parts[0] ?? ''
  const body = parts[1] ?? ''
  const comment = parts[2] ?? ''
  const preview = body.length > 16
    ? `${body.slice(0, 8)}…${body.slice(-8)}`
    : body
  return [type, preview, comment].filter(Boolean).join(' ')
}

export default function SshKeySection() {
  const { t } = useTranslation()
  const [current, setCurrent] = useState(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    try {
      const { key } = await getSshKey()
      setCurrent(key ?? null)
    } catch {
      // Not available until backend is deployed
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    if (!draft.trim()) { setError(t('admin.ssh_key.err_empty')); return }
    setSaving(true); setError(''); setOk('')
    try {
      await setSshKey(draft.trim())
      await load()
      setDraft(''); setEditing(false)
      setOk(t('admin.ssh_key.ok_saved'))
    } catch {
      setError(t('admin.ssh_key.err_save'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true); setError(''); setOk('')
    try {
      await deleteSshKey()
      setCurrent(null)
      setOk(t('admin.ssh_key.ok_deleted'))
    } catch {
      setError(t('admin.ssh_key.err_delete'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-6 mt-6 rounded-lg">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
            {t('admin.ssh_key.title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-zinc-500 mt-0.5">
            {t('admin.ssh_key.description')}
          </p>
        </div>
        {!editing && (
          <button
            onClick={() => { setEditing(true); setDraft(current ?? ''); setOk('') }}
            className="text-sm text-portal-accent hover:text-portal-accent/80 transition-colors"
          >
            {current ? t('admin.ssh_key.btn_change') : t('admin.ssh_key.btn_set')}
          </button>
        )}
      </div>

      {/* Current key display */}
      {!editing && (
        <div className="flex items-center gap-3">
          {current ? (
            <>
              <code className="flex-1 text-xs font-mono bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-3 py-2 text-gray-700 dark:text-zinc-300 truncate">
                {maskKey(current)}
              </code>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="text-sm text-portal-danger hover:text-portal-danger/80 disabled:opacity-50 transition-colors shrink-0"
              >
                {deleting ? t('admin.ssh_key.removing') : t('admin.ssh_key.btn_remove')}
              </button>
            </>
          ) : (
            <p className="text-sm text-gray-400 dark:text-zinc-500 italic">{t('admin.ssh_key.empty')}</p>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="space-y-3">
          <textarea
            rows={4}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('admin.ssh_key.placeholder')}
            className="w-full border px-3 py-2 text-xs font-mono bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition resize-y"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? t('admin.ssh_key.saving') : t('admin.ssh_key.save')}
            </button>
            <button
              onClick={() => { setEditing(false); setDraft(''); setError('') }}
              className="btn-secondary"
            >
              {t('admin.ssh_key.cancel')}
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
