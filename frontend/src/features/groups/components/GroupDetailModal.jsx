// p3portal.org
// PROJ-45: Mitglieder-Verwaltungs-Modal für eine Gruppe.
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { groupsApi } from '../api'
import { formatApiError } from '../../../api/errors'
import ConfirmModal from '../../../components/common/ConfirmModal'

export default function GroupDetailModal({ groupId, users, onClose }) {
  const { t } = useTranslation()

  const [group, setGroup]           = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [search, setSearch]         = useState('')
  const [addUserId, setAddUserId]   = useState('')
  const [addBusy, setAddBusy]       = useState(false)
  const [addError, setAddError]     = useState('')
  const [confirm, setConfirm]       = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await groupsApi.get(groupId)
      setGroup(data)
    } catch (err) {
      setError(formatApiError(err, t('groups.load_error')))
    } finally {
      setLoading(false)
    }
  }, [groupId, t])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const localUsers = (users ?? []).filter(u => u.auth_type === 'local' || !u.auth_type)

  // Users not already in group
  const memberIds     = new Set((group?.members ?? []).map(m => m.id ?? m.user_id))
  const availableAdd  = localUsers.filter(u => !memberIds.has(u.id))

  const filteredMembers = (group?.members ?? []).filter(m =>
    !search || m.username.toLowerCase().includes(search.toLowerCase())
  )

  const handleAddMember = async (e) => {
    e.preventDefault()
    if (!addUserId) return
    setAddBusy(true)
    setAddError('')
    try {
      await groupsApi.addMember(groupId, Number(addUserId))
      setAddUserId('')
      await load()
    } catch (err) {
      setAddError(formatApiError(err, t('groups.add_member_error')))
    } finally {
      setAddBusy(false)
    }
  }

  const handleRemoveMember = (member) => {
    setConfirm({
      title: t('groups.remove_member_title'),
      body: t('groups.remove_member_confirm', { username: member.username }),
      variant: 'danger',
      confirmLabel: t('common.delete'),
      onConfirm: async () => {
        // member.id here is actually the local_user id from MemberResponse
        await groupsApi.removeMember(groupId, member.user_id ?? member.id)
        await load()
      },
    })
  }

  const ownerIsNotMember = group && group.owner_user_id && !memberIds.has(group.owner_user_id)

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div
          className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
          role="dialog"
          aria-modal="true"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
                {group?.name ?? t('groups.modal_members')}
              </h2>
              {group && (
                <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
                  {t('groups.member_count', { count: group.member_count })}
                  {group.owner_username && (
                    <span> · {t('groups.owner_label')}: <span className="text-gray-600 dark:text-zinc-300">{group.owner_username}</span></span>
                  )}
                </p>
              )}
            </div>
            <button type="button" onClick={onClose} className="btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            {loading && <p className="text-sm text-gray-400 dark:text-zinc-500 text-center py-8">{t('common.loading')}</p>}
            {error   && <p className="text-sm text-portal-danger py-4">{error}</p>}

            {!loading && !error && group && (
              <>
                {/* Owner-not-member banner */}
                {ownerIsNotMember && (
                  <div className="flex items-center gap-2 text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 rounded-lg px-3 py-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    {t('groups.owner_not_member_hint', { owner: group.owner_username })}
                  </div>
                )}

                {/* Tags */}
                {group.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {group.tags.map(tag => (
                      <span key={tag} className="text-xs bg-portal-accent/10 text-portal-accent px-2 py-0.5 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                {group.description && (
                  <p className="text-sm text-gray-500 dark:text-zinc-400">{group.description}</p>
                )}

                {/* Add member form */}
                <form onSubmit={handleAddMember} className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
                      {t('groups.add_member_label')}
                    </label>
                    <select
                      value={addUserId}
                      onChange={e => setAddUserId(e.target.value)}
                      className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent"
                    >
                      <option value="">{t('groups.add_member_select_placeholder')}</option>
                      {availableAdd.map(u => (
                        <option key={u.id} value={u.id}>{u.username}</option>
                      ))}
                    </select>
                    {addError && <p className="text-xs text-portal-danger mt-1">{addError}</p>}
                  </div>
                  <button
                    type="submit"
                    disabled={!addUserId || addBusy}
                    className="btn-primary shrink-0"
                  >
                    {addBusy ? '…' : t('groups.add_member_btn')}
                  </button>
                </form>

                {/* Search */}
                {group.members.length > 5 && (
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('groups.member_search_placeholder')}
                    className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent"
                  />
                )}

                {/* Members table */}
                {filteredMembers.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-lg py-8 text-center">
                    <p className="text-sm text-gray-400 dark:text-zinc-500">{t('groups.members_empty')}</p>
                  </div>
                ) : (
                  <div className="border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 dark:border-zinc-700">
                          <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('groups.col_username')}</th>
                          <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('groups.col_role')}</th>
                          <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('groups.col_added_by')}</th>
                          <th className="text-left px-4 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('groups.col_added_at')}</th>
                          <th className="px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMembers.map((m, idx) => (
                          <tr
                            key={m.id ?? m.user_id ?? idx}
                            className="border-t border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/30"
                          >
                            <td className="px-4 py-2.5 text-gray-900 dark:text-zinc-100 font-medium">{m.username}</td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-zinc-400">{m.role}</td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-zinc-400">{m.added_by}</td>
                            <td className="px-4 py-2.5 text-gray-400 dark:text-zinc-500 text-xs">{m.added_at?.slice(0, 10)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => handleRemoveMember(m)}
                                className="text-xs text-portal-danger hover:text-portal-danger transition-colors"
                                title={t('groups.remove_member_btn')}
                              >
                                {t('groups.remove_member_btn')}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex justify-end bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              {t('common.close')}
            </button>
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          {...confirm}
          onClose={() => setConfirm(null)}
        />
      )}
      <span className="rq hidden" aria-hidden="true" />
    </>
  )
}
