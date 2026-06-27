// p3portal.org
// PROJ-83: Scope- + Host-Auswahl im PlaybookForm für Gast-Playbooks
// (meta.targets === 'guest'). User-Scope ist Core; Pool/Global sind Plus-gated.
import { Suspense, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useCapability } from '../../../hooks/useCapability'
import { PlusComponents } from '../../../plus'
import { useInventoryHosts } from '../hooks'
import GuestHostList from './GuestHostList'

const PoolSelectorField = PlusComponents.PoolSelectorField

/**
 * @param {function} onChange – ({ guestScope: {kind, ref}, targetHosts: string[]|null }) => void
 */
export default function GuestScopeSelector({ onChange }) {
  const { t } = useTranslation()
  const plus = useCapability('ansible_inventory')

  const [scope, setScope] = useState('user')
  const [poolId, setPoolId] = useState(null)
  // selectAll = ganzer Scope (target_hosts = null); sonst explizite host_refs
  const [selectAll, setSelectAll] = useState(true)
  const [selected, setSelected] = useState(() => new Set())

  const scopeRef = scope === 'pool' ? poolId : null
  const enabled = scope !== 'pool' || poolId != null
  const { data, isLoading, error } = useInventoryHosts(scope, scopeRef, enabled)
  const hosts = data?.hosts ?? []

  // Propagiert die aktuelle Auswahl nach oben.
  useEffect(() => {
    onChange?.({
      guestScope: { kind: scope, ref: scope === 'pool' ? poolId : null },
      targetHosts: selectAll ? null : Array.from(selected),
    })
  }, [scope, poolId, selectAll, selected, onChange])

  const switchScope = (s) => {
    setScope(s)
    setSelected(new Set())
    setSelectAll(true)
    if (s !== 'pool') setPoolId(null)
  }

  const toggleHost = (ref) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  const SCOPES = [
    { id: 'user', label: t('ansible_inventory.scope.user'), plus: false },
    { id: 'pool', label: t('ansible_inventory.scope.pool'), plus: true },
    { id: 'global', label: t('ansible_inventory.scope.global'), plus: true },
  ].filter(s => !s.plus || plus)

  return (
    <div className="space-y-3 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
          {t('ansible_inventory.run_scope_label')}
        </label>
        <p className="text-xs text-gray-400 dark:text-zinc-500 mb-2">{t('ansible_inventory.run_scope_hint')}</p>
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
      </div>

      {scope === 'pool' && PoolSelectorField && (
        <Suspense fallback={null}>
          <PoolSelectorField value={poolId} onChange={setPoolId} />
        </Suspense>
      )}

      {scope === 'pool' && poolId == null ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500">{t('ansible_inventory.scope_pool_select')}</p>
      ) : (
        <>
          <div>
            <span className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {t('ansible_inventory.host_select_label')}
            </span>
            <div className="flex w-fit border border-gray-200 dark:border-zinc-700 text-xs rounded-md overflow-hidden">
              {[
                { id: true, label: t('ansible_inventory.host_select_all') },
                { id: false, label: t('ansible_inventory.host_select_specific') },
              ].map(m => (
                <button
                  key={String(m.id)}
                  type="button"
                  onClick={() => setSelectAll(m.id)}
                  className={`px-3 py-1.5 transition-colors ${
                    selectAll === m.id
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading && <div className="text-xs text-gray-400 dark:text-zinc-500">{t('common.loading')}</div>}
          {error && (
            <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger">
              {t('ansible_inventory.load_error')}
            </div>
          )}
          {data?.error === 'empty_scope' && (
            <p className="text-xs text-gray-500 dark:text-zinc-400">{t('ansible_inventory.empty_scope')}</p>
          )}
          {data?.error === 'no_scope_key' && (
            <p className="text-xs text-portal-warn">{t('ansible_inventory.no_key')}</p>
          )}

          {!isLoading && !error && hosts.length > 0 && (
            <div className={selectAll ? 'opacity-60 pointer-events-none' : ''}>
              <GuestHostList
                hosts={hosts}
                selected={selected}
                onToggle={toggleHost}
                selectable={!selectAll}
              />
            </div>
          )}
          {selectAll && hosts.some(h => h.group === 'managed') && (
            <p className="text-xs text-gray-400 dark:text-zinc-500">{t('ansible_inventory.host_all_hint')}</p>
          )}
        </>
      )}
    </div>
  )
}
