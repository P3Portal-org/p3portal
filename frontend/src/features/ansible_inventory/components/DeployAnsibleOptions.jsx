// p3portal.org
// PROJ-83: Opt-out-Haken „Für Ansible verwalten" (default AN) + Plus-Global-Key-Haken
// (default AUS) für Deploy-Playbooks. Zeigt zusätzlich den Onboarding-Block.
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCapability } from '../../../hooks/useCapability'
import OnboardingBlockModal from './OnboardingBlockModal'

/**
 * @param {function} onChange – ({ manageForAnsible, globalOptIn }) => void
 */
export default function DeployAnsibleOptions({ onChange }) {
  const { t } = useTranslation()
  const plus = useCapability('ansible_inventory')
  const [manageForAnsible, setManageForAnsible] = useState(true)
  const [globalOptIn, setGlobalOptIn] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    onChange?.({ manageForAnsible, globalOptIn: plus ? globalOptIn : false })
  }, [manageForAnsible, globalOptIn, plus, onChange])

  return (
    <div className="space-y-2 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
      <label className="flex items-center gap-2.5 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={manageForAnsible}
          onChange={e => setManageForAnsible(e.target.checked)}
          className="w-4 h-4 accent-orange-500"
        />
        <span className="text-sm text-gray-700 dark:text-zinc-300">{t('ansible_inventory.deploy_manage_label')}</span>
      </label>
      <p className="text-xs text-gray-400 dark:text-zinc-500 pl-7">{t('ansible_inventory.deploy_manage_hint')}</p>

      {plus && manageForAnsible && (
        <>
          <label className="flex items-center gap-2.5 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={globalOptIn}
              onChange={e => setGlobalOptIn(e.target.checked)}
              className="w-4 h-4 accent-orange-500"
            />
            <span className="text-sm text-gray-700 dark:text-zinc-300">{t('ansible_inventory.deploy_global_label')}</span>
          </label>
          <p className="text-xs text-gray-400 dark:text-zinc-500 pl-7">{t('ansible_inventory.deploy_global_hint')}</p>
        </>
      )}

      {manageForAnsible && (
        <button
          type="button"
          onClick={() => setShowOnboarding(true)}
          className="btn-table text-xs mt-1"
        >
          {t('ansible_inventory.show_onboarding')}
        </button>
      )}

      {showOnboarding && (
        <OnboardingBlockModal
          scope="user"
          globalOptIn={plus && globalOptIn}
          onClose={() => setShowOnboarding(false)}
        />
      )}
    </div>
  )
}
