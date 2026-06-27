// p3portal.org
// PROJ-83: Inventory-Sicht (Automation-Tab „Ansible-Inventar").
// Zeigt die Hosts je Scope (managed/unmanaged/no_ip), Host-Key-Reset pro managed
// Host und „Onboarding-Block anzeigen". Pool/Global-Tabs nur bei Plus.
// PROJ-84: zusätzlicher „Installation"-Scope (Discovery, nur manage_ansible_inventory)
// + „Als verwaltet markieren"/„Verbindung testen" in der Eigene-Sicht.
import { Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCapability } from '../../../hooks/useCapability'
import { useAuth } from '../../../hooks/useAuth'
import { PlusComponents } from '../../../plus'
import { useInventoryHosts } from '../hooks'
import GuestHostList from './GuestHostList'
import HostKeyResetButton from './HostKeyResetButton'
import MarkManagedButton from './MarkManagedButton'
import ConnectivityTestButton from './ConnectivityTestButton'
import OnboardingBlockModal from './OnboardingBlockModal'
import InstallationDiscoveryView from './InstallationDiscoveryView'
import HelpButton from '../../help/components/HelpButton'

const PoolSelectorField = PlusComponents.PoolSelectorField

export default function InventoryView() {
  const { t } = useTranslation()
  const plus = useCapability('ansible_inventory')
  const { role, portalPermissions } = useAuth()
  const canManageInventory =
    role === 'admin' || (portalPermissions ?? []).includes('manage_ansible_inventory')
  // „Installation"-Discovery ist inhärent Plus (Global-Key) und manage-gated.
  const canDiscover = plus && canManageInventory

  const [scope, setScope] = useState('user')
  const [poolId, setPoolId] = useState(null)
  const [showOnboarding, setShowOnboarding] = useState(false)

  const scopeRef = scope === 'pool' ? poolId : null
  // Discovery-Scope hat eigene Datenquelle → Inventory-Query deaktivieren.
  const inventoryEnabled = scope !== 'installation' && (scope !== 'pool' || poolId != null)
  const { data, isLoading, error } = useInventoryHosts(scope, scopeRef, inventoryEnabled)
  const hosts = data?.hosts ?? []

  const SCOPES = [
    { id: 'user', label: t('ansible_inventory.scope.user'), show: true },
    { id: 'pool', label: t('ansible_inventory.scope.pool'), show: plus },
    { id: 'global', label: t('ansible_inventory.scope.global'), show: plus },
    { id: 'installation', label: t('ansible_inventory.scope.installation'), show: canDiscover },
  ].filter(s => s.show)

  const switchScope = (s) => {
    setScope(s)
    if (s !== 'pool') setPoolId(null)
  }

  // Aktionen pro Host in der scope-basierten Sicht (Eigene/Pool/Global):
  //  - unmanaged (eigener/adoptierter Host) → „Als verwaltet markieren"
  //  - managed → Verbindung testen + Host-Key zurücksetzen
  const renderActions = (h) => {
    if (h.group === 'unmanaged') return <MarkManagedButton host={h} />
    if (h.group === 'managed') {
      return (
        <span className="flex items-center gap-2">
          <ConnectivityTestButton host={h} />
          <HostKeyResetButton host={h} />
        </span>
      )
    }
    return null // no_ip: managed ohne IP – Test nicht verfügbar
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{t('ansible_inventory.title')}</h2>
            <HelpButton helpKey="automation.tabs.inventory" />
          </div>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-zinc-400">{t('ansible_inventory.subtitle')}</p>
        </div>
        <button type="button" onClick={() => setShowOnboarding(true)} className="btn-secondary text-xs shrink-0">
          {t('ansible_inventory.show_onboarding')}
        </button>
      </div>

      <div className="flex w-fit border border-gray-200 dark:border-zinc-700 text-xs rounded-md overflow-hidden">
        {SCOPES.map(s => (
          <button
            key={s.id}
            type="button"
            onClick={() => switchScope(s.id)}
            className={`px-3 py-1.5 transition-colors ${
              scope === s.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {scope === 'installation' ? (
        <InstallationDiscoveryView />
      ) : (
        <>
          {scope === 'pool' && PoolSelectorField && (
            <Suspense fallback={null}>
              <PoolSelectorField value={poolId} onChange={setPoolId} />
            </Suspense>
          )}

          {scope === 'pool' && poolId == null ? (
            <p className="text-sm text-gray-500 dark:text-zinc-400">{t('ansible_inventory.scope_pool_select')}</p>
          ) : isLoading ? (
            <div className="text-sm text-gray-400 dark:text-zinc-500">{t('common.loading')}</div>
          ) : error ? (
            <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-sm text-portal-danger">
              {t('ansible_inventory.load_error')}
            </div>
          ) : data?.error === 'no_scope_key' ? (
            <p className="text-sm text-portal-warn">{t('ansible_inventory.no_key')}</p>
          ) : hosts.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-zinc-400">{t('ansible_inventory.empty')}</p>
          ) : (
            <GuestHostList
              hosts={hosts}
              selected={new Set()}
              onToggle={() => {}}
              selectable={false}
              renderActions={renderActions}
            />
          )}
        </>
      )}

      {showOnboarding && (
        <OnboardingBlockModal
          scope={scope === 'installation' ? 'global' : scope}
          scopeRef={scope === 'installation' ? null : scopeRef}
          globalOptIn={scope === 'installation'}
          onClose={() => setShowOnboarding(false)}
        />
      )}
    </div>
  )
}
