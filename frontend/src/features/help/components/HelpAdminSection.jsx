// p3portal.org
// PROJ-57: Admin-Sektion „Hilfetexte" im SystemSettings → Inhalte-Tab.
// Sichtbar bei manage_help-Permission. Zeigt alle Overrides + Orphan-Detection + Promote/Delete.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useHelpAdminOverrides, useDeleteOverride, usePromoteOverride, useDeleteGlobalOverride } from '../hooks'
import { REGISTRY_MAP, HELP_REGISTRY } from '../registry'
import { useLicenseLimits } from '../../../hooks/useLicenseLimits'
import PlusBadge from '../../../components/common/PlusBadge'
import ConfirmModal from '../../../components/common/ConfirmModal'

export default function HelpAdminSection() {
  const { t } = useTranslation()
  const { data: overrides = [], isLoading, error } = useHelpAdminOverrides()
  const { isPlus } = useLicenseLimits()
  const deleteOverride    = useDeleteOverride()
  const promoteOverride   = usePromoteOverride()
  const deleteGlobal      = useDeleteGlobalOverride()
  const [confirm, setConfirm] = useState(null) // { action, label, fn }
  const [activeTab, setActiveTab] = useState('all') // 'all' | 'global' | 'orphans'

  if (isLoading) return <p className="text-sm text-gray-400">{t('common.loading')}</p>
  if (error)     return <p className="text-sm text-portal-danger">{t('help.admin.load_error')}</p>

  // Orphan-Detection: Overrides deren Key nicht mehr in der Registry ist
  const registeredKeys = new Set(HELP_REGISTRY.map(e => e.key))
  const orphans  = overrides.filter(o => !registeredKeys.has(o.key))
  const globals  = overrides.filter(o => o.scope === 'global')
  const shown    = activeTab === 'all' ? overrides
    : activeTab === 'global'  ? globals
    : orphans

  const tabCls = (id) =>
    `px-3 py-1.5 text-xs rounded-md transition-colors ${
      activeTab === id
        ? 'bg-[var(--accent)] text-white'
        : 'text-gray-500 dark:text-zinc-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
    }`

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {/* Card-Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-zinc-700">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              {t('help.admin.section_title')}
            </p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              {t('help.admin.section_desc', { total: overrides.length, global: globals.length, orphans: orphans.length })}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            {!isPlus && <PlusBadge />}
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400">
              {overrides.length}
            </span>
          </div>
        </div>

        {/* Filter-Tabs + Inhalt */}
        <div className="px-4 py-3 space-y-3">
          {/* Tabs */}
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => setActiveTab('all')}     className={tabCls('all')}>
              {t('help.admin.tab_all')} ({overrides.length})
            </button>
            <button onClick={() => setActiveTab('global')}  className={tabCls('global')}>
              {t('help.admin.tab_global')} ({globals.length})
            </button>
            <button onClick={() => setActiveTab('orphans')} className={tabCls('orphans')}>
              {t('help.admin.tab_orphans')} ({orphans.length})
            </button>
          </div>

          {/* Plus-inaktiv Banner */}
          {!isPlus && (
            <div className="flex items-center gap-2 text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded-lg px-3 py-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              {t('help.admin.plus_disabled_banner')}
            </div>
          )}
        </div>

        {/* Tabelle */}
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">
            {t('help.admin.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-gray-100 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100 dark:border-zinc-800">
                  <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">Key</th>
                  <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('help.admin.col_lang')}</th>
                  <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('help.admin.col_scope')}</th>
                  <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('help.admin.col_user')}</th>
                  <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('help.admin.col_date')}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                {shown.map(o => {
                  const inRegistry = registeredKeys.has(o.key)
                  const regEntry = REGISTRY_MAP[o.key]
                  return (
                    <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                      <td className="px-4 py-3 font-mono text-gray-700 dark:text-zinc-300">
                        {o.key}
                        {!inRegistry && (
                          <span className="ml-1 text-[10px] bg-portal-warn/10 text-portal-warn border border-portal-warn/30 rounded-full px-1.5">
                            {t('help.admin.orphan_badge')}
                          </span>
                        )}
                        {inRegistry && regEntry && (
                          <span className="ml-1 text-[10px] text-gray-400 dark:text-zinc-500 truncate max-w-[120px] inline-block">
                            ({regEntry.titleDe})
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 uppercase text-gray-500 dark:text-zinc-400">{o.lang}</td>
                      <td className="px-4 py-3">
                        <ScopeBadge scope={o.scope} t={t} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 dark:text-zinc-400">
                        {o.owner_username || o.original_uploader_username || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 dark:text-zinc-500 whitespace-nowrap">
                        {new Date(o.updated_at).toLocaleDateString('de-DE')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end flex-wrap">
                          {o.scope === 'user' && (
                            <button
                              disabled={!isPlus || promoteOverride.isPending}
                              onClick={() => setConfirm({
                                action: 'promote',
                                label: `${t('help.admin.promote_button')}: ${o.key} (${o.lang})`,
                                fn: () => promoteOverride.mutateAsync(o.id),
                              })}
                              className="btn-table disabled:opacity-40"
                              title={!isPlus ? t('help.admin.promote_needs_plus') : undefined}
                            >
                              {t('help.admin.promote_button')}
                            </button>
                          )}
                          {o.scope === 'global' && (
                            <button
                              disabled={deleteGlobal.isPending}
                              onClick={() => setConfirm({
                                action: 'delete_global',
                                label: `${t('help.admin.remove_global')}: ${o.key} (${o.lang})`,
                                fn: () => deleteGlobal.mutateAsync({ key: o.key, lang: o.lang }),
                              })}
                              className="btn-table-danger"
                            >
                              {t('help.admin.remove_global')}
                            </button>
                          )}
                          {o.scope === 'user' && (
                            <button
                              disabled={deleteOverride.isPending}
                              onClick={() => setConfirm({
                                action: 'delete_user',
                                label: `${t('help.admin.moderate')}: ${o.key} (${o.lang})`,
                                fn: () => deleteOverride.mutateAsync(o.id),
                              })}
                              className="btn-table-danger"
                            >
                              {t('help.admin.moderate')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          isOpen
          title={confirm.label}
          message={t('help.admin.confirm_action')}
          variant={confirm.action.startsWith('delete') || confirm.action === 'moderate' ? 'danger' : 'primary'}
          onConfirm={async () => { await confirm.fn(); setConfirm(null) }}
          onCancel={() => setConfirm(null)}
          busy={deleteOverride.isPending || deleteGlobal.isPending || promoteOverride.isPending}
        />
      )}
    </>
  )
}

function ScopeBadge({ scope, t }) {
  if (scope === 'global') {
    return <span className="inline-flex text-[10px] border rounded-full px-2 py-0.5 bg-portal-info/10 text-portal-info border-portal-info/30">{t('help.source.global')}</span>
  }
  return <span className="inline-flex text-[10px] border rounded-full px-2 py-0.5 bg-gray-50 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700">{t('help.source.user')}</span>
}
