// p3portal.org
import { useEffect, useState } from 'react'
import api from '../../api/client'

export default function ProxmoxNodeSelector({ param, value, onChange, error }) {
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    api.get('/api/cluster/nodes')
      .then(({ data }) => {
        setNodes(data)
        if (!value && data.length > 0) {
          onChange(param.id, data[0].node)
        }
      })
      .catch(() => setFetchError('Nodes konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const base =
    'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>

      {loading ? (
        <div className={`${base} text-gray-400 dark:text-zinc-500`}>Lädt Nodes…</div>
      ) : fetchError ? (
        <div className="space-y-1">
          <input
            type="text"
            value={value ?? ''}
            onChange={e => onChange(param.id, e.target.value)}
            placeholder={param.default ?? 'Node-Name'}
            className={`${base} ${error ? 'border-portal-danger' : ''}`}
          />
          <p className="text-xs text-portal-warn">{fetchError} Bitte manuell eingeben.</p>
        </div>
      ) : (
        <select
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value)}
          className={`${base} ${error ? 'border-portal-danger' : ''}`}
        >
          {nodes.length === 0 && <option value="">– Kein Node verfügbar –</option>}
          {nodes.map(n => (
            <option key={n.node} value={n.node}>
              {n.node}{n.status === 'online' ? '' : ' (offline)'}
            </option>
          ))}
        </select>
      )}

      {error && <p className="text-xs text-portal-danger">{error}</p>}
    </div>
  )
}
