// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getNodeDefaultStorages, setNodeDefaultStorages } from '../../api/admin'
import { getPackerNodes, getPackerStorages } from '../../api/packer'

export default function NodeDefaultStoragesSection() {
  const { t } = useTranslation()
  const [nodes, setNodes] = useState([])
  const [storagesByNode, setStoragesByNode] = useState({})
  const [defaults, setDefaults] = useState({})
  const [draft, setDraft] = useState({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    try {
      const [nodeData, defData] = await Promise.all([
        getPackerNodes(),
        getNodeDefaultStorages(),
      ])
      setNodes(nodeData)
      setDefaults(defData)

      const map = {}
      await Promise.all(
        nodeData.map(async n => {
          try {
            map[n.name] = await getPackerStorages(n.name)
          } catch {
            map[n.name] = []
          }
        })
      )
      setStoragesByNode(map)
    } catch {
      // ignore – service account may not be configured
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleEdit = () => {
    setDraft({ ...defaults })
    setEditing(true)
    setOk('')
    setError('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const cleaned = Object.fromEntries(
        Object.entries(draft).filter(([, v]) => v !== '' && v != null)
      )
      await setNodeDefaultStorages(cleaned)
      await load()
      setEditing(false)
      setOk(t('admin.default_storages.ok_saved'))
    } catch {
      setError(t('admin.default_templates.err_save'))
    } finally {
      setSaving(false)
    }
  }

  const selectCls = 'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-6 mt-6 rounded-lg">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
            {t('admin.default_storages.title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-zinc-500 mt-0.5">
            {t('admin.default_storages.description')}
          </p>
        </div>
        {!editing && nodes.length > 0 && (
          <button
            onClick={handleEdit}
            className="text-sm text-portal-accent hover:text-portal-accent/80 transition-colors"
          >
            {t('admin.default_templates.btn_change')}
          </button>
        )}
      </div>

      {nodes.length === 0 && (
        <p className="text-sm text-gray-400 dark:text-zinc-500">
          {t('admin.default_templates.no_nodes')}
        </p>
      )}

      {!editing && nodes.length > 0 && (
        <div className="space-y-1">
          {nodes.map(n => {
            const storage = defaults[n.name]
            const storages = storagesByNode[n.name] ?? []
            const found = storages.find(s => s.name === storage)
            return (
              <div key={n.name} className="flex items-center gap-3 text-sm">
                <span className="w-24 text-gray-500 dark:text-zinc-400 text-xs font-mono">{n.name}</span>
                <span className="text-gray-700 dark:text-zinc-300">
                  {found
                    ? `${found.name} (${found.type})`
                    : <span className="text-gray-400 dark:text-zinc-600 italic">{t('admin.default_templates.none')}</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <div className="space-y-4">
          {nodes.map(n => {
            const nodeStorages = storagesByNode[n.name] ?? []
            return (
              <div key={n.name}>
                <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1 font-mono">{n.name}</label>
                <select
                  value={draft[n.name] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [n.name]: e.target.value }))}
                  className={selectCls}
                >
                  <option value="">{t('admin.default_templates.placeholder')}</option>
                  {nodeStorages.map(s => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.type})
                    </option>
                  ))}
                  {nodeStorages.length === 0 && (
                    <option disabled>{t('admin.default_storages.no_storages')}</option>
                  )}
                </select>
              </div>
            )
          })}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? t('admin.default_templates.saving') : t('admin.default_templates.save')}
            </button>
            <button
              onClick={() => { setEditing(false); setError('') }}
              className="btn-secondary"
            >
              {t('admin.default_templates.cancel')}
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
