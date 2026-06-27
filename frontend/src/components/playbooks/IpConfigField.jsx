// p3portal.org
import { useState, useEffect } from 'react'

function parseIpConfig(value) {
  if (!value || value === 'ip=dhcp') return { mode: 'dhcp', ip: '', prefix: '24', gateway: '' }
  const match = value.match(/ip=([^/]+)\/(\d+)(?:,gw=(.+))?/)
  if (match) return { mode: 'static', ip: match[1], prefix: match[2], gateway: match[3] ?? '' }
  return { mode: 'dhcp', ip: '', prefix: '24', gateway: '' }
}

function buildValue(mode, ip, prefix, gateway) {
  if (mode === 'dhcp') return 'ip=dhcp'
  if (!ip) return 'ip=dhcp'
  return gateway ? `ip=${ip}/${prefix},gw=${gateway}` : `ip=${ip}/${prefix}`
}

export default function IpConfigField({ param, value, onChange, error }) {
  const parsed = parseIpConfig(value)
  const [mode, setMode] = useState(parsed.mode)
  const [ip, setIp] = useState(parsed.ip)
  const [prefix, setPrefix] = useState(parsed.prefix)
  const [gateway, setGateway] = useState(parsed.gateway)

  useEffect(() => {
    if (!value) onChange(param.id, 'ip=dhcp')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function update(newMode, newIp, newPrefix, newGateway) {
    onChange(param.id, buildValue(newMode, newIp, newPrefix, newGateway))
  }

  function handleMode(m) {
    setMode(m)
    update(m, ip, prefix, gateway)
  }

  const base =
    'border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 ' +
    'focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>

      <select
        value={mode}
        onChange={e => handleMode(e.target.value)}
        className={`w-full ${base}`}
      >
        <option value="dhcp">DHCP (automatisch)</option>
        <option value="static">Statisch</option>
      </select>

      {mode === 'static' && (
        <div className="grid grid-cols-12 gap-2">
          <div className="col-span-7 space-y-1">
            <label className="block text-xs text-gray-500 dark:text-zinc-400">IP-Adresse</label>
            <input
              type="text"
              value={ip}
              onChange={e => { setIp(e.target.value); update(mode, e.target.value, prefix, gateway) }}
              placeholder="192.168.1.100"
              className={`w-full ${base} ${error ? 'border-portal-danger' : ''}`}
            />
          </div>
          <div className="col-span-2 space-y-1">
            <label className="block text-xs text-gray-500 dark:text-zinc-400">Präfix</label>
            <input
              type="number"
              value={prefix}
              min={1}
              max={32}
              onChange={e => { setPrefix(e.target.value); update(mode, ip, e.target.value, gateway) }}
              className={`w-full ${base}`}
            />
          </div>
          <div className="col-span-3 space-y-1">
            <label className="block text-xs text-gray-500 dark:text-zinc-400">Gateway</label>
            <input
              type="text"
              value={gateway}
              onChange={e => { setGateway(e.target.value); update(mode, ip, prefix, e.target.value) }}
              placeholder="192.168.1.1"
              className={`w-full ${base}`}
            />
          </div>
        </div>
      )}

      {error && <p className="text-xs text-portal-danger">{error}</p>}
    </div>
  )
}
