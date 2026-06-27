// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getNodeDefaultTemplates, setNodeDefaultTemplates } from '../../api/admin'
import { getNodes } from '../../api/cluster'
import { getProxmoxTemplates } from '../../api/cluster'

export default function NodeDefaultTemplatesSection() {
  const { t } = useTranslation()
  const [nodes, setNodes] = useState([])
  const [templates, setTemplates] = useState([])
  const [defaults, setDefaults] = useState({})
  const [draft, setDraft] = useState({})
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')

  const load = useCallback(async () => {
    try {
      const [nodeData, tmplData, defData] = await Promise.all([
        getNodes(),
        getProxmoxTemplates(),
        getNodeDefaultTemplates(),
      ])
      setNodes(nodeData)
      setTemplates(tmplData)
      setDefaults(defData)
    } catch {
      // ignore – backend may not have service account configured
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
      // Remove entries where value is empty string
      const cleaned = Object.fromEntries(
        Object.entries(draft).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, Number(v)])
      )
      await setNodeDefaultTemplates(cleaned)
      await load()
      setEditing(false)
      setOk(t('admin.default_templates.ok_saved'))
    } catch {
      setError(t('admin.default_templates.err_save'))
    } finally {
      setSaving(false)
    }
  }

  const selectCls = 'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'

  const templatesForNode = (nodeName) => templates.filter(tmpl => tmpl.node === nodeName)

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 p-6 mt-6 rounded-lg">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white uppercase tracking-wider">
            {t('admin.default_templates.title')}
          </h2>
          <p className="text-sm text-gray-500 dark:text-zinc-500 mt-0.5">
            {t('admin.default_templates.description')}
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
            const vmid = defaults[n.node]
            const tmpl = templates.find(tt => tt.vmid === vmid)
            return (
              <div key={n.node} className="flex items-center gap-3 text-sm">
                <span className="w-24 text-gray-500 dark:text-zinc-400 text-xs font-mono">{n.node}</span>
                <span className="text-gray-700 dark:text-zinc-300">
                  {tmpl ? `${tmpl.name} (ID ${tmpl.vmid})` : <span className="text-gray-400 dark:text-zinc-600 italic">{t('admin.default_templates.none')}</span>}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <div className="space-y-4">
          {nodes.map(n => {
            const nodeTemplates = templatesForNode(n.node)
            return (
              <div key={n.node}>
                <label className="block text-xs text-gray-500 dark:text-zinc-400 mb-1 font-mono">{n.node}</label>
                <select
                  value={draft[n.node] ?? ''}
                  onChange={e => setDraft(d => ({ ...d, [n.node]: e.target.value }))}
                  className={selectCls}
                >
                  <option value="">{t('admin.default_templates.placeholder')}</option>
                  {nodeTemplates.map(tt => (
                    <option key={tt.vmid} value={tt.vmid}>
                      {tt.name} (ID {tt.vmid})
                    </option>
                  ))}
                  {nodeTemplates.length === 0 && (
                    <option disabled>{t('admin.default_templates.no_templates')}</option>
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
