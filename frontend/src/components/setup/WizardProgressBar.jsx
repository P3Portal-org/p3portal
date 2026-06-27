// p3portal.org
import { useTranslation } from 'react-i18next'

export default function WizardProgressBar({ current }) {
  const { t } = useTranslation()
  const STEPS = [
    t('setup.step_licence'),
    t('setup.step_database'),
    t('setup.step_admin'),
    t('setup.step_proxmox'),
    t('setup.step_tokens'),
    t('setup.step_packer'),
    t('setup.step_done'),
  ]

  return (
    <div className="flex items-center gap-0 w-full mb-8">
      {STEPS.map((label, i) => {
        const step = i + 1
        const done = step < current
        const active = step === current
        return (
          <div key={step} className="flex items-center flex-1 min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                  done
                    ? 'bg-portal-accent border-portal-accent text-white'
                    : active
                    ? 'bg-white dark:bg-zinc-900 border-portal-accent text-portal-accent'
                    : 'bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-600 text-zinc-400'
                }`}
              >
                {done ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  step
                )}
              </div>
              <span
                className={`text-xs mt-1 whitespace-nowrap hidden sm:block ${
                  active ? 'text-portal-accent font-medium' : done ? 'text-zinc-500' : 'text-zinc-400'
                }`}
              >
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-1 min-w-0 transition-colors ${
                  done ? 'bg-portal-accent' : 'bg-zinc-200 dark:bg-zinc-700'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
