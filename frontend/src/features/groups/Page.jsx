// p3portal.org
// PROJ-45: Admin-Seite für User-Gruppen / Teams.
// Route: /admin/groups (sichtbar nur mit manage_groups oder admin)
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useGroups } from './hooks/useGroups'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'
import { fetchUsers } from '../../api/admin'
import GroupFormModal from './components/GroupFormModal'
import GroupDetailModal from './components/GroupDetailModal'
import DeleteGroupConfirmModal from './components/DeleteGroupConfirmModal'

export default function GroupsPage({ embedded = false }) {
  const { t } = useTranslation()
  const { groups, loading, error, filters, setFilters, reload } = useGroups()
  const { isPlus, groupLimit } = useLicenseLimits()

  const [users, setUsers]         = useState([])
  const [modal, setModal]         = useState(null) // null | 'create' | { mode:'edit', group } | { mode:'detail', group } | { mode:'delete', group }
  const [tagFilterInput, setTagFilterInput] = useState('')

  const loadUsers = useCallback(() => {
    fetchUsers().then(setUsers).catch(() => {})
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const CORE_MAX = 3
  const atLimit   = !isPlus && groups.length >= CORE_MAX

  const openCreate = () => {
    if (atLimit) return
    setModal('create')
  }

  const handleSuccess = () => {
    setModal(null)
    reload()
  }

  const applyTagFilter = () => {
    setFilters(f => ({ ...f, tag: tagFilterInput }))
  }

  const clearFilters = () => {
    setFilters({ search: '', no_owner: false, tag: '' })
    setTagFilterInput('')
  }

  const hasActiveFilter = filters.search || filters.no_owner || filters.tag

  const innerContent = (
    <div className="space-y-4">

      {/* Limit banner (Core edition) */}
      {atLimit && (
        <div className="flex items-center gap-2 text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded-lg px-4 py-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          {t('groups.limit_reached_banner', { current: groups.length, max: CORE_MAX })}
        </div>
      )}

      {/* Row 1: description + create button – identisch zu Nutzer/Rollenpresets */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-zinc-500">{t('groups.description')}</p>
        <div className="relative group">
          <button
            onClick={openCreate}
            disabled={atLimit}
            className="btn-primary flex items-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('groups.create_btn')}
          </button>
          {atLimit && (
            <div className="absolute right-0 top-full mt-1 z-20 hidden group-hover:block w-56 bg-zinc-900 dark:bg-zinc-800 text-white text-xs rounded px-2.5 py-1.5 shadow-lg pointer-events-none">
              {t('groups.limit_reached_tooltip', { max: CORE_MAX })}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Suchfilter (sekundär, kompakt) */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={filters.search}
          onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
          placeholder={t('groups.search_placeholder')}
          className="flex-1 min-w-[160px] text-xs px-2.5 py-1.5 border border-gray-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        />
        <div className="flex gap-1">
          <input
            type="text"
            value={tagFilterInput}
            onChange={e => setTagFilterInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') applyTagFilter() }}
            placeholder={t('groups.tag_filter_placeholder')}
            className="text-xs px-2.5 py-1.5 border border-gray-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent w-28"
          />
          <button
            onClick={applyTagFilter}
            className="btn-secondary text-xs px-2.5 py-1.5"
          >
            #
          </button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-zinc-400 cursor-pointer select-none whitespace-nowrap">
          <input
            type="checkbox"
            checked={filters.no_owner}
            onChange={e => setFilters(f => ({ ...f, no_owner: e.target.checked }))}
            className="rounded border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent"
          />
          {t('groups.filter_no_owner')}
        </label>
        {hasActiveFilter && (
          <button
            onClick={clearFilters}
            className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
          >
            {t('groups.filter_clear')}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {loading ? (
          <p className="text-sm text-gray-500 dark:text-zinc-500 py-10 text-center">{t('common.loading')}</p>
        ) : error ? (
          <p className="text-sm text-portal-danger py-10 text-center">{error}</p>
        ) : groups.length === 0 ? (
          <div className="py-14 text-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600 mb-3">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p className="text-sm text-gray-400 dark:text-zinc-500">
              {hasActiveFilter ? t('groups.empty_filtered') : t('groups.empty')}
            </p>
            {!hasActiveFilter && !atLimit && (
              <button
                onClick={openCreate}
                className="mt-3 text-sm text-portal-accent hover:text-portal-accent transition-colors"
              >
                {t('groups.create_first')}
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700">
                <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('groups.col_name')}</th>
                <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 hidden sm:table-cell">{t('groups.col_tags')}</th>
                <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 hidden md:table-cell">{t('groups.col_owner')}</th>
                <th className="text-center py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('groups.col_members')}</th>
                <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 hidden lg:table-cell">{t('groups.col_created')}</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr
                  key={g.id}
                  className="border-b border-gray-100 dark:border-zinc-800 last:border-0"
                >
                  <td className="py-2.5 px-3">
                    <p className="font-medium text-gray-900 dark:text-zinc-100">{g.name}</p>
                    {g.description && (
                      <p className="text-xs text-gray-400 dark:text-zinc-500 truncate max-w-xs">{g.description}</p>
                    )}
                  </td>
                  <td className="py-2.5 px-3 hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(g.tags ?? []).slice(0, 3).map(tag => (
                        <span key={tag} className="text-xs bg-portal-accent/10 text-portal-accent px-1.5 py-0.5 rounded-full">{tag}</span>
                      ))}
                      {(g.tags ?? []).length > 3 && (
                        <span className="text-xs text-gray-400 dark:text-zinc-500">+{g.tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 hidden md:table-cell text-gray-500 dark:text-zinc-400">
                    {g.owner_username ?? <span className="text-gray-300 dark:text-zinc-600">—</span>}
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <button
                      onClick={() => setModal({ mode: 'detail', group: g })}
                      className="text-xs text-portal-accent hover:text-portal-accent font-medium transition-colors"
                    >
                      {g.member_count}
                    </button>
                  </td>
                  <td className="py-2.5 px-3 text-xs text-gray-400 dark:text-zinc-500 hidden lg:table-cell">
                    {g.created_at?.slice(0, 10)}
                  </td>
                  <td className="py-2.5 px-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setModal({ mode: 'detail', group: g })}
                        className="btn-table"
                      >
                        {t('groups.action_members')}
                      </button>
                      <button
                        onClick={() => setModal({ mode: 'edit', group: g })}
                        className="btn-table"
                      >
                        {t('common.edit')}
                      </button>
                      <button
                        onClick={() => setModal({ mode: 'delete', group: g })}
                        className="btn-table-danger"
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )

  const modals = (
    <>
      {modal === 'create' && (
        <GroupFormModal
          group={null}
          users={users}
          groupLimit={groupLimit}
          onSuccess={handleSuccess}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'edit' && (
        <GroupFormModal
          group={modal.group}
          users={users}
          onSuccess={handleSuccess}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === 'detail' && (
        <GroupDetailModal
          groupId={modal.group.id}
          users={users}
          onClose={() => { setModal(null); reload() }}
        />
      )}
      {modal?.mode === 'delete' && (
        <DeleteGroupConfirmModal
          group={modal.group}
          onSuccess={handleSuccess}
          onClose={() => setModal(null)}
        />
      )}
      <span className="rq hidden" aria-hidden="true" />
    </>
  )

  if (embedded) {
    return <>{innerContent}{modals}</>
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <header className="h-12 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('groups.title')}</h1>
      </header>

      <div className="flex-1 overflow-y-auto p-6 min-w-0">
        <div className="max-w-5xl mx-auto">
          {innerContent}
        </div>
      </div>

      {modals}
    </div>
  )
}
