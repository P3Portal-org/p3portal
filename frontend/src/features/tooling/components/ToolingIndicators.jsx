// p3portal.org
// PROJ-66: Container – rendert alle Tool-Indikatoren dynamisch (AC-PLUS-3)
import { useToolingStatus } from '../hooks'
import ToolingIndicator from './ToolingIndicator'

// Reihenfolge: Core-Tools zuerst, dann bekannte Plus-Tools, dann unbekannte (AC-UI-8 / AC-P2-UI-3)
// Ansible → Packer → OpenTofu (Tofu nach den Core-Tools, PROJ-66 Phase 2)
const KNOWN_ORDER = ['ansible', 'packer', 'opentofu']

function sortedTools(statusObj) {
  if (!statusObj) return []
  const keys = Object.keys(statusObj)
  const known = KNOWN_ORDER.filter(k => keys.includes(k))
  const extra = keys.filter(k => !KNOWN_ORDER.includes(k)).sort()
  return [...known, ...extra]
}

export default function ToolingIndicators() {
  const { data: status } = useToolingStatus()

  const tools = sortedTools(status)
  if (tools.length === 0) return null

  return (
    <div className="flex items-center gap-0.5">
      {tools.map(tool => (
        <ToolingIndicator
          key={tool}
          tool={tool}
          toolData={status[tool]}
        />
      ))}
    </div>
  )
}
