// p3portal.org
// PROJ-73: Updates-Tab in der Compute-Node-Detailseite
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeUpdates, useRefreshNodeUpdates } from '../hooks'
import { useAuth } from '../../../hooks/useAuth'
import PackageTable from './PackageTable'
import StaleWarning from './StaleWarning'
import RefreshButton from './RefreshButton'
import { formatRelative, formatDate } from '../utils'

function ErrorBanner({ error, lastSuccessAt }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-[var(--portal-danger,#dc2626)] bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm">
      <p className="font-medium text-red-700 dark:text-red-400">{t('nodeUpdates.last_refresh_failed')}</p>
      <p className="mt-1 text-xs text-red-600 dark:text-red-400/80">{error}</p>
      {lastSuccessAt && (
        <p className="mt-1 text-xs text-red-500 dark:text-red-400/60">
          {t('nodeUpdates.last_success')}: {formatDate(lastSuccessAt)}
        </p>
      )}
    </div>
  )
}

function NoDataState({ canRefresh, onRefresh, loading }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-lg border border-dashed border-gray-300 dark:border-zinc-600 bg-gray-50 dark:bg-zinc-800/40 px-6 py-10 text-center space-y-4">
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-700 dark:text-zinc-300">
          {t('nodeUpdates.no_data_title')}
        </p>
        <p className="text-xs text-gray-400 dark:text-zinc-500">
          {t('nodeUpdates.no_data_hint')}
        </p>
      </div>
      {canRefresh && (
        <div className="flex justify-center">
          <RefreshButton onClick={onRefresh} loading={loading} />
        </div>
      )}
    </div>
  )
}

export default function UpdatesTab({ portalNodeId, active }) {
  const { t } = useTranslation()
  const { role } = useAuth()
  const isAdmin = role === 'admin'
  // node:refresh_updates → Admins und Operatoren (PROJ-47-Pattern)
  const canRefresh = isAdmin || role === 'operator'

  const { data, isLoading, error } = useNodeUpdates(active ? portalNodeId : null)
  const refresh = useRefreshNodeUpdates(portalNodeId)
  const [refreshError, setRefreshError] = useState(null)
  const [refreshSuccess, setRefreshSuccess] = useState(false)

  // Merge packages aus allen Members mit optionaler Node-Spalte
  const allMembers  = data?.members ?? []
  const isMulti     = allMembers.length > 1
  const allPackages = allMembers.flatMap(m =>
    (m.packages ?? []).map(p => ({ ...p, node_name: m.proxmox_node_name }))
  )
  const totalPkgs   = allMembers.reduce((s, m) => s + m.package_count, 0)
  const totalSec    = allMembers.reduce((s, m) => s + m.security_count, 0)

  // Ältestes last_success_at über alle Member
  const lastSuccessAt = allMembers
    .map(m => m.last_success_at)
    .filter(Boolean)
    .sort()[0] ?? null

  const isStale = allMembers.some(m => m.is_stale)

  // Fehler: mind. ein Member hat last_error gesetzt und last_check > last_success
  const errorMember = allMembers.find(m => m.last_error && m.last_check_at &&
    (!m.last_success_at || m.last_check_at > m.last_success_at))
  const lastError = errorMember?.last_error ?? null

  async function handleRefresh() {
    setRefreshError(null)
    setRefreshSuccess(false)
    try {
      await refresh.mutateAsync()
      setRefreshSuccess(true)
      setTimeout(() => setRefreshSuccess(false), 3000)
    } catch (err) {
      const detail = err?.response?.data?.detail
      if (detail === 'refresh_already_running') {
        setRefreshError(t('nodeUpdates.already_running'))
      } else {
        setRefreshError(t('nodeUpdates.refresh_failed'))
      }
    }
  }

  if (!active) return null

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-8 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
        ))}
      </div>
    )
  }

  if (error?.response?.status === 403) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-8 text-center">
        <p className="text-sm font-medium text-portal-text">{t('nodeUpdates.no_access')}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">{t('nodeUpdates.no_access_hint')}</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400">
        {t('nodeUpdates.load_error')}
      </div>
    )
  }

  // Noch nie gecheckt
  if (!lastSuccessAt && !lastError) {
    return <NoDataState canRefresh={canRefresh} onRefresh={handleRefresh} loading={refresh.isPending} />
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-zinc-400">
            <span>{t('nodeUpdates.last_check')}: </span>
            <span className="font-medium text-gray-700 dark:text-zinc-200">
              {lastSuccessAt ? formatRelative(lastSuccessAt) : t('nodeUpdates.never')}
            </span>
            {lastSuccessAt && (
              <span className="text-gray-400 dark:text-zinc-600 font-mono">
                ({formatDate(lastSuccessAt)})
              </span>
            )}
          </div>
          {totalPkgs > 0 && (
            <p className="text-xs text-gray-400 dark:text-zinc-500">
              {totalPkgs} {t('nodeUpdates.packages_available')}
              {totalSec > 0 && (
                <span className="ml-1.5 font-semibold text-[var(--portal-warn,#ca8a04)]">
                  ({totalSec} {t('nodeUpdates.security_label')})
                </span>
              )}
            </p>
          )}
        </div>
        {canRefresh && (
          <div className="flex items-center gap-2">
            {refreshSuccess && (
              <span className="text-xs text-[var(--portal-success,#16a34a)]">
                ✓ {t('nodeUpdates.refresh_success')}
              </span>
            )}
            <RefreshButton onClick={handleRefresh} loading={refresh.isPending} />
          </div>
        )}
      </div>

      {/* Fehler / Stale-Banner */}
      {refreshError && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-xs text-red-700 dark:text-red-400">
          {refreshError}
        </div>
      )}
      {lastError && <ErrorBanner error={lastError} lastSuccessAt={lastSuccessAt} />}
      {isStale && !lastError && <StaleWarning lastSuccessAt={lastSuccessAt} />}

      {/* Pakettabelle */}
      {totalPkgs === 0 ? (
        <div className="py-8 text-center text-sm text-[var(--portal-success,#16a34a)]">
          <svg viewBox="0 0 20 20" fill="currentColor" className="w-6 h-6 mx-auto mb-2 opacity-70" aria-hidden="true">
            <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5z" clipRule="evenodd"/>
          </svg>
          {t('nodeUpdates.all_up_to_date')}
        </div>
      ) : (
        <PackageTable packages={allPackages} showNodeColumn={isMulti} />
      )}
    </div>
  )
}
