// p3portal.org
import { useState, useEffect } from 'react'
import { getVms } from '../../api/cluster'

const MODES = [
  { id: 'dropdown', label: 'Aus Cluster wählen' },
  { id: 'manual', label: 'Manuell eingeben' },
]

export default function TargetVmSelector({ param, value, onChange, error }) {
  const [mode, setMode] = useState('dropdown')
  const [vms, setVms] = useState([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(null)

  useEffect(() => {
    getVms()
      .then(data => {
        setVms(data.filter(vm => vm.status === 'running'))
        setFetchError(null)
      })
      .catch(err => setFetchError(err))
      .finally(() => setLoading(false))
  }, [])

  const switchMode = (m) => {
    setMode(m)
    onChange(param.id, '')
  }

  const base =
    'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent ' +
    'focus:border-portal-accent transition'
  const errCls = error ? 'border-portal-danger' : ''

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>

      {/* Mode toggle */}
      <div className="flex w-fit border border-gray-200 dark:border-zinc-700 text-xs">
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            onClick={() => switchMode(m.id)}
            className={`px-3 py-1.5 transition-colors ${
              mode === m.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'dropdown' ? (
        fetchError ? (
          <div className="border border-portal-warn/30 bg-portal-warn/10 px-3 py-2 text-xs text-portal-warn">
            Cluster nicht erreichbar – bitte manuelle Eingabe verwenden.
          </div>
        ) : (
          <select
            value={value ?? ''}
            onChange={e => onChange(param.id, e.target.value)}
            disabled={loading}
            className={`${base} ${errCls} disabled:opacity-50`}
          >
            <option value="">– Laufende VM / LXC wählen –</option>
            {vms.map(vm => {
              const displayVal = vm.ip || vm.name || String(vm.vmid)
              const label = vm.ip
                ? `${vm.name || `VM ${vm.vmid}`} (${vm.ip}) · ${vm.type.toUpperCase()} · ${vm.node}`
                : `${vm.name || `VM ${vm.vmid}`} · ${vm.type.toUpperCase()} · ${vm.node}`
              return (
                <option key={vm.vmid} value={displayVal}>
                  {label}
                </option>
              )
            })}
          </select>
        )
      ) : (
        <input
          type="text"
          value={value ?? ''}
          onChange={e => onChange(param.id, e.target.value)}
          placeholder="192.168.1.100, DHCP-IP oder hostname.example.com"
          className={`${base} ${errCls}`}
        />
      )}

      <p className="text-xs text-gray-400 dark:text-zinc-500">
        Wird als <code className="font-mono">target_host</code>-Variable an Ansible übergeben.
      </p>
      {error && <p className="text-xs text-portal-danger">{error}</p>}
    </div>
  )
}
