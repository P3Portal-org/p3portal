// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { listAlertStates, acknowledgeAlert } from '../../api/alerts'

const SEVERITY_STYLE = {
  critical: {
    bar: 'border-portal-danger/50 bg-portal-danger/10',
    text: 'text-portal-danger',
    dot: 'bg-portal-danger',
    label: 'Kritisch',
  },
  warning: {
    bar: 'border-portal-warn/50 bg-portal-warn/10',
    text: 'text-portal-warn',
    dot: 'bg-portal-warn',
    label: 'Warnung',
  },
}

function MetricLabel({ metric, value, threshold }) {
  const pct = value != null ? `${value.toFixed(1)} %` : null
  if (metric === 'status') return <span>VM gestoppt</span>
  if (metric === 'disk_percent') return <span>Disk {pct ?? '—'} (Schwellwert {threshold ?? '?'} %)</span>
  if (metric === 'cpu_percent') return <span>CPU {pct ?? '—'} (Schwellwert {threshold ?? '?'} %)</span>
  if (metric === 'mem_percent') return <span>RAM {pct ?? '—'} (Schwellwert {threshold ?? '?'} %)</span>
  return <span>{metric} {pct ?? ''}</span>
}

function AlertStateItem({ state, onAck, acking }) {
  const style = SEVERITY_STYLE[state.severity] ?? SEVERITY_STYLE.warning
  return (
    <div className={`flex items-center gap-3 border rounded-lg px-4 py-2.5 text-sm ${style.bar}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
      <span className={`font-semibold shrink-0 ${style.text}`}>{style.label}</span>
      <span className={`${style.text} flex-1 min-w-0 truncate`}>
        <span className="font-mono mr-1">{state.vmid}</span>
        <span className="mx-1 opacity-60">·</span>
        {state.rule_name}
        {state.last_value != null && (
          <span className="ml-2 opacity-80 text-xs">
            <MetricLabel metric={state.metric} value={state.last_value} threshold={null} />
          </span>
        )}
      </span>
      <button
        onClick={() => onAck(state)}
        disabled={acking}
        className={`shrink-0 text-xs hover:underline disabled:opacity-40 transition-opacity ${style.text}`}
        aria-label="Bestätigen"
      >
        Bestätigen
      </button>
    </div>
  )
}

export default function AlertsBanner() {
  const [states, setStates] = useState([])
  const [dismissed, setDismissed] = useState([])
  const [acking, setAcking] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await listAlertStates()
      setStates(data)
    } catch {
      // silent – Banner ist optional
    }
  }, [])

  useEffect(() => {
    load()
    const iv = setInterval(load, 60_000)
    return () => clearInterval(iv)
  }, [load])

  const handleAck = useCallback(async (state) => {
    setAcking(true)
    try {
      if (state.last_event_id != null) {
        await acknowledgeAlert(state.last_event_id)
      }
      setDismissed(d => [...d, `${state.rule_id}-${state.vmid}-${state.node_id}`])
    } catch {
      // ignore – banner still dismissed locally
    } finally {
      setAcking(false)
    }
  }, [])

  const visible = states.filter(
    s => !dismissed.includes(`${s.rule_id}-${s.vmid}-${s.node_id}`) &&
         (s.state === 'warning' || s.state === 'critical')
  )

  // Show critical first, then warning
  const sorted = [...visible].sort((a, b) => {
    if (a.severity === b.severity) return 0
    return a.severity === 'critical' ? -1 : 1
  })

  if (sorted.length === 0) return null

  return (
    <div className="space-y-2">
      {sorted.map(s => (
        <AlertStateItem
          key={`${s.rule_id}-${s.vmid}-${s.node_id}-${s.severity}`}
          state={s}
          onAck={handleAck}
          acking={acking}
        />
      ))}
    </div>
  )
}
