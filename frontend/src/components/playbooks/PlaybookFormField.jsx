// p3portal.org
import { useState, useEffect, useCallback, useRef } from 'react'
import SshKeyField from './SshKeyField'
import TargetVmSelector from './TargetVmSelector'
import ProxmoxNodeSelector from './ProxmoxNodeSelector'
import ProxmoxTemplateSelector from './ProxmoxTemplateSelector'
import ProxmoxBridgeSelector from './ProxmoxBridgeSelector'
import IpConfigField from './IpConfigField'
import VmAccessField from './VmAccessField'
import { getPlaybookNextVmid } from '../../api/cluster'

// ── VM-ID-Feld mit Autofill ───────────────────────────────────────────────────

function PlaybookVmIdField({ param, value, onChange, error }) {
  const [vmidRange, setVmidRange] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange  // always current, without triggering effect deps

  const fetchNext = useCallback(async () => {
    setRefreshing(true)
    try {
      const data = await getPlaybookNextVmid()
      setVmidRange({ min: data.min, max: data.max })
      onChangeRef.current(param.id, data.vmid)
    } catch {
      // graceful: leave existing value
    } finally {
      setRefreshing(false)
    }
  }, [param.id])  // stable: onChange accessed via ref, not as dep

  useEffect(() => { fetchNext() }, [fetchNext])

  const base =
    'flex-1 border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'

  return (
    <div className="space-y-1">
      <label htmlFor={`field-${param.id}`} className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`field-${param.id}`}
          type="number"
          value={value ?? ''}
          min={vmidRange?.min ?? param.min}
          max={vmidRange?.max ?? param.max}
          required={param.required}
          onChange={e => onChange(param.id, e.target.value === '' ? '' : Number(e.target.value))}
          className={`${base} ${error ? 'border-portal-danger' : ''}`}
        />
        <button
          type="button"
          onClick={fetchNext}
          disabled={refreshing}
          title="Nächste freie ID laden"
          className="shrink-0 px-2.5 py-2 border border-gray-300 dark:border-zinc-600 text-gray-500 dark:text-zinc-400 hover:border-portal-accent hover:text-portal-accent transition disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}>
            <path d="M23 4v6h-6" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
        </button>
      </div>
      {vmidRange && (
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          Bereich: {vmidRange.min}–{vmidRange.max}
        </p>
      )}
      {error && <p className="text-xs text-portal-danger">{error}</p>}
    </div>
  )
}

// ── Haupt-Dispatcher ──────────────────────────────────────────────────────────

export default function PlaybookFormField({ param, value, onChange, error, formValues }) {
  if (param.type === 'ssh_key') {
    return <SshKeyField param={param} value={value} onChange={onChange} error={error} />
  }
  if (param.type === 'vm_access') {
    return <VmAccessField param={param} onChange={onChange} />
  }
  if (param.type === 'target_host') {
    return <TargetVmSelector param={param} value={value} onChange={onChange} error={error} />
  }
  if (param.type === 'proxmox_node') {
    return <ProxmoxNodeSelector param={param} value={value} onChange={onChange} error={error} />
  }
  if (param.type === 'proxmox_template') {
    return (
      <ProxmoxTemplateSelector
        param={param}
        value={value}
        onChange={onChange}
        error={error}
        nodeValue={formValues?.proxmox_node ?? null}
      />
    )
  }
  if (param.type === 'proxmox_bridge') {
    return (
      <ProxmoxBridgeSelector
        param={param}
        value={value}
        onChange={onChange}
        error={error}
        nodeValue={formValues?.proxmox_node ?? null}
      />
    )
  }
  if (param.type === 'ip_config') {
    return <IpConfigField param={param} value={value} onChange={onChange} error={error} />
  }
  if (param.id === 'vm_id' && param.type === 'integer') {
    return <PlaybookVmIdField param={param} value={value} onChange={onChange} error={error} />
  }

  const base =
    'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'
  const errClass = error ? 'border-portal-danger' : ''

  return (
    <div className="space-y-1">
      <label htmlFor={`field-${param.id}`} className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>

      {param.type === 'string' && (
        <input
          id={`field-${param.id}`}
          type="text"
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value)}
          placeholder={param.default ?? ''}
          className={`${base} ${errClass}`}
        />
      )}

      {param.type === 'password' && (
        <input
          id={`field-${param.id}`}
          type="password"
          autoComplete="new-password"
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value)}
          className={`${base} ${errClass}`}
        />
      )}

      {param.type === 'integer' && (
        <input
          id={`field-${param.id}`}
          type="number"
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value === '' ? '' : Number(e.target.value))}
          min={param.min}
          max={param.max}
          placeholder={param.default != null ? String(param.default) : ''}
          className={`${base} ${errClass}`}
        />
      )}

      {param.type === 'dropdown' && (
        <select
          id={`field-${param.id}`}
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value)}
          className={`${base} ${errClass}`}
        >
          <option value="">– Auswählen –</option>
          {param.options?.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {param.type === 'bool' && (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            id={`field-${param.id}`}
            type="checkbox"
            checked={value ?? param.default ?? false}
            onChange={e => onChange(param.id, e.target.checked)}
            className="w-4 h-4 border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent"
          />
          <span className="text-sm text-gray-600 dark:text-zinc-400">Aktiviert</span>
        </label>
      )}

      {error && <p className="text-xs text-portal-danger">{error}</p>}
      {param.min != null && param.max != null && param.type === 'integer' && (
        <p className="text-xs text-gray-400 dark:text-zinc-500">Min: {param.min} · Max: {param.max}</p>
      )}
    </div>
  )
}
