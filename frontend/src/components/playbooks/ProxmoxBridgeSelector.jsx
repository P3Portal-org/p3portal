// p3portal.org
import { useEffect, useState, useMemo } from 'react'
import { getNodeVmOptions } from '../../api/cluster'

// Node-abhängiges Netzwerk-Interface-Dropdown: bietet die Bridges UND SDN-VNets
// des gewählten Proxmox-Node an (beides wird per Name referenziert: net0:
// bridge=<name>). Freitext-Fallback, wenn die Optionen nicht ladbar sind oder
// ein nicht gelisteter Name gebraucht wird. Muster analog ProxmoxTemplateSelector.
export default function ProxmoxBridgeSelector({ param, value, onChange, error, nodeValue }) {
  const [options, setOptions] = useState({ bridges: [], vnets: [] })
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState('')

  useEffect(() => {
    if (!nodeValue) return
    setLoading(true)
    setFetchError('')
    getNodeVmOptions(nodeValue)
      .then(data => setOptions({
        bridges: Array.isArray(data?.bridges) ? data.bridges : [],
        vnets: Array.isArray(data?.vnets) ? data.vnets : [],
      }))
      .catch(() => setFetchError('Netzwerk-Optionen konnten nicht geladen werden.'))
      .finally(() => setLoading(false))
  }, [nodeValue])

  const [customMode, setCustomMode] = useState(false)

  const names = useMemo(
    () => [...new Set([...(options.bridges || []), ...(options.vnets || [])].filter(Boolean))],
    [options]
  )
  // Freitext-Modus aktiv, wenn der Nutzer ihn wählt ODER ein bereits gesetzter
  // Wert nicht (mehr) in der Liste steht.
  const showCustom = customMode || (!!value && !names.includes(value))

  const base =
    'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 transition'

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-red-500 ml-1">*</span>}
      </label>

      {!nodeValue && !loading && (
        <p className="text-xs text-gray-400 dark:text-zinc-500 italic py-2">
          Erst einen Proxmox-Node auswählen.
        </p>
      )}

      {nodeValue && loading && (
        <div className={`${base} text-gray-400 dark:text-zinc-500`}>Lädt Netzwerke…</div>
      )}

      {nodeValue && !loading && (
        <>
          <select
            value={showCustom ? '__custom__' : (value ?? '')}
            onChange={e => {
              const v = e.target.value
              if (v === '__custom__') {
                setCustomMode(true)
              } else {
                setCustomMode(false)
                onChange(param.id, v)
              }
            }}
            className={`${base} ${error ? 'border-red-500' : ''}`}
          >
            <option value="">– Template-Standard (vom Klon geerbt) –</option>
            {options.bridges?.length > 0 && (
              <optgroup label="Bridges">
                {options.bridges.map(b => <option key={`b-${b}`} value={b}>{b}</option>)}
              </optgroup>
            )}
            {options.vnets?.length > 0 && (
              <optgroup label="SDN-VNets">
                {options.vnets.map(v => <option key={`v-${v}`} value={v}>{v}</option>)}
              </optgroup>
            )}
            <option value="__custom__">Eigener Wert…</option>
          </select>

          {showCustom && (
            <input
              type="text"
              value={value ?? ''}
              onChange={e => onChange(param.id, e.target.value)}
              placeholder="z. B. vmbr0 oder vnet5"
              className={`${base} ${error ? 'border-red-500' : ''}`}
            />
          )}

          {fetchError && (
            <p className="text-xs text-amber-500">{fetchError} Bitte Namen manuell eingeben.</p>
          )}
          {!fetchError && names.length === 0 && (
            <p className="text-xs text-gray-400 dark:text-zinc-500">
              Keine Bridges/VNets auf Node &ldquo;{nodeValue}&rdquo; gefunden &ndash; &bdquo;Eigener Wert&ldquo; nutzen.
            </p>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}
// p3portal.org
