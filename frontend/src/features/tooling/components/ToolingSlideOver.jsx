// p3portal.org
// PROJ-66: Globaler Tooling-Slide-Over (Singleton, analog HelpSlideOver PROJ-57)
// AC-SLIDE-1..8: z-[60], w-96/w-full, ARIA-Dialog, Focus-Trap, ESC, Backdrop-Klick
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useToolingSlideOver } from '../context'
import { useToolingStatus } from '../hooks'
import ToolingStatusSection  from './ToolingStatusSection'
import ToolingOutputSection  from './ToolingOutputSection'
import ToolingHistorySection from './ToolingHistorySection'
import ToolingRecheckButton  from './ToolingRecheckButton'

const STATUS_BADGE = {
  ready:    'bg-portal-success/15 text-portal-success border-portal-success/30',
  degraded: 'bg-portal-warn/15 text-portal-warn border-portal-warn/30',
  down:     'bg-portal-danger/15 text-portal-danger border-portal-danger/30',
  unknown:  'bg-portal-text/10 text-portal-text/50 border-portal-border',
}

function ToolIcon({ className = 'w-4 h-4' }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2L3 7v10l9 5 9-5V7L12 2z" />
    </svg>
  )
}

export default function ToolingSlideOver() {
  const { t } = useTranslation()
  const { openTool, closeSlideOver } = useToolingSlideOver()
  const { data: status } = useToolingStatus()
  const panelRef = useRef(null)
  const closeRef = useRef(null)

  const isOpen = !!openTool
  const toolData = openTool && status ? status[openTool] : null
  // PROJ-66 Phase 2: OpenTofu als dritter Indikator (AC-P2-UI-2)
  const displayName = openTool === 'ansible' ? 'Ansible'
    : openTool === 'packer' ? 'Packer'
    : openTool === 'opentofu' ? 'OpenTofu'
    : openTool ?? ''

  const toolStatus = toolData?.status ?? 'unknown'
  const badgeCls = STATUS_BADGE[toolStatus] ?? STATUS_BADGE.unknown

  // ESC schließt (AC-SLIDE-6)
  useEffect(() => {
    if (!isOpen) return
    const handle = (e) => { if (e.key === 'Escape') closeSlideOver() }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [isOpen, closeSlideOver])

  // Focus auf Close-Button beim Öffnen (AC-SLIDE-7)
  useEffect(() => {
    if (isOpen) closeRef.current?.focus()
  }, [isOpen, openTool])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop (AC-SLIDE-1/6) */}
      <div
        className="fixed inset-0 bg-black/20 dark:bg-black/40 z-[59]"
        onClick={closeSlideOver}
        aria-hidden="true"
      />

      {/* Slide-Over Panel (AC-SLIDE-1) */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tooling-slideover-title"
        className="fixed right-0 top-0 h-full w-full sm:w-96 bg-portal-bg border-l border-portal-border shadow-2xl z-[60] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (AC-SLIDE-2) */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-portal-border shrink-0">
          <ToolIcon className="w-4 h-4 text-portal-text/50 shrink-0" />
          <h2 id="tooling-slideover-title" className="flex-1 min-w-0 text-sm font-semibold text-portal-text truncate">
            {displayName}
          </h2>
          <span className={`inline-flex items-center text-xs border rounded-full px-2 py-0.5 shrink-0 ${badgeCls}`}>
            {t(`tooling.status_${toolStatus}`, { defaultValue: toolStatus })}
          </span>
          <button
            ref={closeRef}
            type="button"
            onClick={closeSlideOver}
            className="btn-ghost p-1 shrink-0"
            aria-label={t('common.close')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body — scrollbar */}
        <div className="flex-1 overflow-y-auto">
          {/* PROJ-66 Phase 2: OpenTofu-spezifischer Hilfetext (AC-P2-UI-5) */}
          {openTool === 'opentofu' && (
            <p className="px-4 py-3 border-b border-portal-border text-xs text-portal-text/60">
              {t('tooling.opentofu_hint')}
            </p>
          )}

          {/* §1 Version + Status */}
          <ToolingStatusSection toolData={toolData} />

          {/* §2 Output letzter Check */}
          <ToolingOutputSection toolData={toolData} />

          {/* §3 Status-Historie */}
          <ToolingHistorySection tool={openTool} />

          {/* §4 Jetzt prüfen */}
          <ToolingRecheckButton />
        </div>
      </div>
    </>
  )
}
