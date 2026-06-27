// p3portal.org
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteUser, setPortalPermissions } from '../../api/admin'
import UserDeleteOwnershipStep from '../../features/owners/components/UserDeleteOwnershipStep'

const roleBadgeCls = {
  admin: 'bg-portal-accent/10 text-portal-accent border border-portal-accent/30',
  operator: 'bg-portal-info/10 text-portal-info border border-portal-info/30',
  viewer: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-700',
}

export default function UserTable({ users, onRefresh, onEdit }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'en' ? 'en-GB' : 'de-DE'
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [ownershipStep, setOwnershipStep] = useState(null) // { user, ownerCount }
  const [ownershipDecision, setOwnershipDecision] = useState(null) // { action, transferToId }
  const [search, setSearch] = useState('')

  const roleLabel = (r) => t(`admin.user_table.role_${r}`, { defaultValue: r })

  const toggleLogs = async (user) => {
    setError('')
    setBusy(user.id)
    try {
      const current = user.portal_permissions ?? []
      const hasLogs = current.includes('view_logs')
      const next = hasLogs ? current.filter(p => p !== 'view_logs') : [...current, 'view_logs']
      await setPortalPermissions(user.id, next)
      onRefresh()
    } catch (err) {
      setError(err.response?.data?.detail ?? t('admin.user_table.err_update'))
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (user, ownerAction = null, transferToId = null) => {
    setError('')
    setBusy(user.id)
    setConfirmDelete(null)
    try {
      await deleteUser(user.id, ownerAction, transferToId)
      onRefresh()
    } catch (err) {
      const detail = err.response?.data?.detail ?? ''
      // PROJ-48: backend returns 409 with "user_has_ownerships:N" when user owns resources
      const ownerMatch = typeof detail === 'string' && detail.match(/^user_has_ownerships:(\d+)$/)
      if (ownerMatch && err.response?.status === 409) {
        const ownerCount = parseInt(ownerMatch[1], 10)
        setOwnershipStep({ user, ownerCount })
      } else {
        setError(detail || t('admin.user_table.err_delete'))
      }
    } finally {
      setBusy(null)
    }
  }

  const handleOwnershipConfirm = async () => {
    if (!ownershipStep || !ownershipDecision) return
    const { action, transferToId } = ownershipDecision
    setOwnershipStep(null)
    setOwnershipDecision(null)
    await handleDelete(ownershipStep.user, action, transferToId)
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return users
    return users.filter(u =>
      u.username.toLowerCase().includes(q) ||
      (u.group_names ?? []).some(g => g.toLowerCase().includes(q)) ||
      (u.preset_names ?? []).some(p => p.toLowerCase().includes(q))
    )
  }, [users, search])

  return (
    <div>
      {/* Search */}
      <div className="mb-3">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('admin.user_table.search_placeholder')}
          className="w-full text-xs px-2.5 py-1.5 border border-gray-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent"
        />
      </div>

      {error && (
        <p className="mb-3 text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">
          {error}
        </p>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="mb-3 p-3 bg-portal-danger/10 border border-portal-danger/30 flex items-center justify-between gap-4">
          <p
            className="text-sm text-portal-danger"
            dangerouslySetInnerHTML={{ __html: t('admin.user_table.confirm_delete', { username: confirmDelete.username }) }}
          />
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => handleDelete(confirmDelete)}
              className="btn-danger"
            >
              {t('admin.user_table.confirm_yes')}
            </button>
            <button
              onClick={() => setConfirmDelete(null)}
              className="btn-secondary"
            >
              {t('admin.user_table.confirm_cancel')}
            </button>
          </div>
        </div>
      )}

      {/* PROJ-48: Ownership-Transfer-Step beim User-Löschen */}
      {ownershipStep && (
        <UserDeleteOwnershipStep
          username={ownershipStep.user.username}
          ownerCount={ownershipStep.ownerCount}
          allUsers={users.filter(u => u.id !== ownershipStep.user.id)}
          onActionChange={setOwnershipDecision}
          onConfirm={handleOwnershipConfirm}
          onCancel={() => { setOwnershipStep(null); setOwnershipDecision(null) }}
          disabled={!ownershipDecision || (ownershipDecision.action === 'transfer' && !ownershipDecision.transferToId)}
        />
      )}

      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        {!users.length ? (
          <p className="text-sm text-gray-500 dark:text-zinc-500 py-10 text-center">
            {t('admin.user_table.empty')}
          </p>
        ) : !filtered.length ? (
          <p className="text-sm text-gray-500 dark:text-zinc-500 py-10 text-center">
            {t('admin.user_table.empty_filtered')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('admin.user_table.col_username')}</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('admin.user_table.col_role')}</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('admin.user_table.col_status')}</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 hidden sm:table-cell">{t('admin.user_table.col_groups')}</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 hidden md:table-cell">{t('admin.user_table.col_presets')}</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('admin.user_table.col_logs')}</th>
                  <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 hidden lg:table-cell">{t('admin.user_table.col_created')}</th>
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-gray-100 dark:border-zinc-800 last:border-0">
                    <td className="py-2.5 px-3 text-gray-900 dark:text-zinc-100 font-mono text-xs">{u.username}</td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 text-xs ${roleBadgeCls[u.role] ?? roleBadgeCls.viewer}`}>
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={`inline-block px-2 py-0.5 text-xs border ${
                        u.active
                          ? 'bg-portal-success/10 text-portal-success border-portal-success/30'
                          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500 border-zinc-300 dark:border-zinc-700'
                      }`}>
                        {u.active ? t('admin.user_table.status_active') : t('admin.user_table.status_inactive')}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 hidden sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(u.group_names ?? []).length === 0
                          ? <span className="text-xs text-gray-300 dark:text-zinc-600">—</span>
                          : (u.group_names ?? []).map(g => (
                            <span key={g} className="text-xs bg-portal-accent/10 text-portal-accent px-1.5 py-0.5 rounded-full">{g}</span>
                          ))
                        }
                      </div>
                    </td>
                    <td className="py-2.5 px-3 hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(u.preset_names ?? []).length === 0
                          ? <span className="text-xs text-gray-300 dark:text-zinc-600">—</span>
                          : (u.preset_names ?? []).map(p => (
                            <span key={p} className="text-xs bg-portal-info/10 text-portal-info border border-portal-info/30 px-1.5 py-0.5 rounded">{p}</span>
                          ))
                        }
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      {u.role === 'admin' ? (
                        <span className="text-xs text-gray-400 dark:text-zinc-600">{t('admin.user_table.logs_always')}</span>
                      ) : (
                        <button
                          onClick={() => toggleLogs(u)}
                          disabled={busy === u.id}
                          title={t('admin.user_table.logs_toggle_title')}
                          className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 border transition-colors disabled:opacity-50 ${
                            (u.portal_permissions ?? []).includes('view_logs')
                              ? 'bg-portal-success/10 text-portal-success border-portal-success/30'
                              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-500 border-zinc-300 dark:border-zinc-700'
                          }`}
                        >
                          {(u.portal_permissions ?? []).includes('view_logs') ? t('admin.user_table.logs_yes') : t('admin.user_table.logs_no')}
                        </button>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-gray-500 dark:text-zinc-500 text-xs hidden lg:table-cell">
                      {new Date(u.created_at).toLocaleDateString(locale)}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => onEdit(u)}
                          className="btn-table"
                        >
                          {t('admin.user_table.btn_edit')}
                        </button>
                        <button
                          onClick={() => { setError(''); setConfirmDelete(u) }}
                          disabled={busy === u.id}
                          className="btn-table-danger"
                        >
                          {t('admin.user_table.btn_delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
