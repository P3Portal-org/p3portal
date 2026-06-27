// p3portal.org
const CONFIG = {
  online:  { dot: 'bg-portal-success', text: 'text-portal-success', label: 'online' },
  offline: { dot: 'bg-portal-danger',   text: 'text-portal-danger',   label: 'offline' },
  running: { dot: 'bg-portal-success', text: 'text-portal-success', label: 'running' },
  stopped: { dot: 'bg-zinc-500',  text: 'text-zinc-400',  label: 'stopped' },
  paused:  { dot: 'bg-portal-warn',text: 'text-portal-warn',label: 'paused' },
}

export default function StatusBadge({ status }) {
  const cfg = CONFIG[status] ?? CONFIG.offline
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 ${cfg.dot}`} />
      <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
    </span>
  )
}
