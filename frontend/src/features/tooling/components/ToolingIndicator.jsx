// p3portal.org
// PROJ-66: Einzel-Indikator für ein Tool in der Topbar (AC-UI-2/3/4/5/6/7)
import { useTranslation } from 'react-i18next'
import { useToolingSlideOver } from '../context'

function timeAgo(isoStr) {
  if (!isoStr) return ''
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000)
  if (diff < 60) return `vor ${diff}s`
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min`
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std`
  return `vor ${Math.floor(diff / 86400)} Tagen`
}

// Farbmapping AC-UI-4: portal-* Tokens
function statusDotClass(status) {
  switch (status) {
    case 'ready':    return 'bg-portal-success'
    case 'degraded': return 'bg-portal-warn'
    case 'down':     return 'bg-portal-danger'
    default:         return 'bg-portal-text/30'
  }
}

// Major.Minor-Extraktion aus Voll-Version
function shortVersion(version) {
  if (!version) return null
  const m = version.match(/(\d+\.\d+)/)
  return m ? m[1] : version
}

export default function ToolingIndicator({ tool, toolData }) {
  const { t } = useTranslation()
  const { openSlideOver } = useToolingSlideOver()

  const status   = toolData?.status ?? 'unknown'
  const version  = toolData?.version ?? null
  const lastCheck = toolData?.last_check ?? null

  const dotCls = statusDotClass(status)
  // PROJ-66 Phase 2: OpenTofu als dritter Indikator (AC-P2-UI-2)
  const displayName = tool === 'ansible' ? 'Ansible'
    : tool === 'packer' ? 'Packer'
    : tool === 'opentofu' ? 'OpenTofu'
    : tool

  // Tooltip-Text AC-UI-5
  const tooltip = (() => {
    const parts = [displayName]
    if (version) parts.push(version)
    parts.push(t(`tooling.status_${status}`, { defaultValue: status }))
    if (lastCheck) {
      parts.push(t('tooling.last_check_ago', { time: timeAgo(lastCheck) }))
    }
    return parts.join(' · ')
  })()

  return (
    <button
      type="button"
      onClick={() => openSlideOver(tool)}
      title={tooltip}
      aria-label={t('tooling.indicator_label', { tool: displayName, status })}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded-md transition-colors hover:bg-portal-bg3 cursor-pointer text-portal-text2 text-xs"
    >
      {/* Label + Version: nur auf md+ (AC-UI-2/3) */}
      <span className="hidden md:flex items-center gap-1">
        <span>{displayName}</span>
        {version && <span className="tabular-nums">{shortVersion(version)}</span>}
      </span>

      {/* Status-Punkt – immer sichtbar */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${dotCls}`} />
    </button>
  )
}
