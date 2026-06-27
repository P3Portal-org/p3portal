// p3portal.org
// PROJ-47: NodeAccessModal – Verwaltung der Node-Scope-Permissions (System Settings → Nodes).
// Default-Export heißt NodeAccessModal (kein Routing, kein Top-Level-Route).
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useNodeAssignments } from './hooks/useNodeAssignments'
import { nodeAssignmentsApi } from './api'
import { fetchPresets } from '../../api/rbac'
import { fetchUsers } from '../../api/admin'
import { groupsApi } from '../groups/api'
import ModalHelpButton from '../help/components/ModalHelpButton'
import { formatApiError } from '../../api/errors'
import ConfirmModal from '../../components/common/ConfirmModal'
import AssignmentModal from './components/AssignmentModal'

const NODE_ACTION_LABELS = {
  'node:view_tasks':      'node_assignments.action_view_tasks',
  'node:view_backups':    'node_assignments.action_view_backups',
  'node:upload_iso':      'node_assignments.action_upload_iso',
  'node:view_updates':    'node_assignments.action_view_updates',
  'node:refresh_updates': 'node_assignments.action_refresh_updates',
  'node:manage_network':  'node_assignments.action_manage_network',
  'node:manage_firewall': 'node_assignments.action_manage_firewall',
}

function NodeActionBadge({ action }) {
  const { t } = useTranslation()
  const label = t(NODE_ACTION_LABELS[action] ?? action, { defaultValue: action })
  return (
    <span className="inline-block text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800/50 px-1.5 py-0.5 rounded mr-1 mb-0.5">
      {label}
    </span>
  )
}

export default function NodeAccessModal({ node, isPlus, onClose }) {
  const { t } = useTranslation()

  const { assignments, loading: assignLoading, error: assignError, reload } = useNodeAssignments(node?.id)
  const [presets,  setPresets]  = useState([])
  const [users,    setUsers]    = useState([])
  const [groups,   setGroups]   = useState([])
  const [metaLoading, setMetaLoading] = useState(true)

  const [showAdd,      setShowAdd]      = useState(false)
  const [editTarget,   setEditTarget]   = useState(null) // assignment to edit
  const [confirm,      setConfirm]      = useState(null)
  const [removeError,  setRemoveError]  = useState('')

  // Lade Presets, Nutzer, Gruppen einmalig beim Öffnen
  const loadMeta = useCallback(async () => {
    try {
      const [p, u, g] = await Promise.all([
        fetchPresets(),
        fetchUsers().catch(() => []),
        groupsApi.list().catch(() => []),
      ])
      setPresets(p)
      setUsers(u)
      setGroups(g)
    } finally {
      setMetaLoading(false)
    }
  }, [])

  useEffect(() => { loadMeta() }, [loadMeta])

  // ESC-Taste schließt Modal
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleRemove = (assignment) => {
    setRemoveError('')
    setConfirm({
      title:        t('node_assignments.remove_title'),
      body:         t('node_assignments.remove_confirm', { subject: assignment.subject_display ?? `ID ${assignment.subject_id}` }),
      variant:      'danger',
      confirmLabel: t('common.delete'),
      onConfirm:    async () => {
        try {
          await nodeAssignmentsApi.remove(node.id, assignment.subject_type, assignment.subject_id)
          await reload()
        } catch (err) {
          setRemoveError(formatApiError(err, t('node_assignments.remove_error')))
          throw err // ConfirmModal bleibt auf busy wenn wir rethrow
        }
      },
    })
  }

  const handleSaved = async () => {
    setShowAdd(false)
    setEditTarget(null)
    await reload()
  }

  const isLoading = assignLoading || metaLoading

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
        <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-3xl flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
            <div>
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t('node_assignments.modal_title', { node: node?.name })}
              </h2>
              <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                {t('node_assignments.modal_description')}
              </p>
            </div>
            <div className="flex items-center gap-1 ml-4">
              <ModalHelpButton helpKey="modal.node_access" />
              <button
                type="button"
                onClick={onClose}
                className="btn-ghost transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Core-Downgrade-Banner */}
          {!isPlus && assignments.length > 0 && (
            <div className="mx-6 mt-4 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-lg px-3 py-2.5 shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 shrink-0 mt-0.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              {t('node_assignments.core_downgrade_banner')}
            </div>
          )}

          {/* Body – Zuweisungsliste */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">

            {/* Fehler-Banner */}
            {(assignError || removeError) && (
              <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {assignError || removeError}
              </p>
            )}

            {isLoading ? (
              <div className="space-y-2">
                {[1, 2].map(i => <div key={i} className="h-14 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />)}
              </div>
            ) : assignments.length === 0 ? (
              <div className="border-2 border-dashed border-gray-200 dark:border-zinc-700 rounded-lg px-6 py-8 text-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600 mb-3">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <line x1="23" y1="11" x2="17" y2="11"/>
                </svg>
                <p className="text-sm text-gray-500 dark:text-zinc-400">
                  {t('node_assignments.empty_state')}
                </p>
              </div>
            ) : (
              <div className="border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-zinc-700">
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                        {t('node_assignments.col_subject')}
                      </th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
                        {t('node_assignments.col_preset')}
                      </th>
                      <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider hidden sm:table-cell">
                        {t('node_assignments.col_added_at')}
                      </th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-700/50">
                    {assignments.map(a => (
                      <tr key={`${a.subject_type}-${a.subject_id}`} className="bg-white dark:bg-zinc-900 hover:bg-gray-50 dark:hover:bg-zinc-800 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-block text-xs px-1.5 py-0.5 rounded font-medium ${
                              a.subject_type === 'user'
                                ? 'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400'
                                : 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800/50'
                            }`}>
                              {a.subject_type === 'user' ? t('node_assignments.subject_type_user') : t('node_assignments.subject_type_group')}
                            </span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {a.subject_display ?? `ID ${a.subject_id}`}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <span className="text-gray-800 dark:text-zinc-200">{a.preset_name ?? `ID ${a.role_preset_id}`}</span>
                            {a.preset_node_actions?.length > 0 && (
                              <div className="mt-1">
                                {a.preset_node_actions.map(action => (
                                  <NodeActionBadge key={action} action={action} />
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 dark:text-zinc-500 hidden sm:table-cell">
                          <span title={a.added_by}>
                            {a.added_at ? new Date(a.added_at).toLocaleDateString('de-DE') : '–'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditTarget(a)}
                              className="btn-table"
                            >
                              {t('common.edit')}
                            </button>
                            <button
                              onClick={() => handleRemove(a)}
                              className="text-xs text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                            >
                              {t('common.delete')}
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

          {/* Sticky Footer */}
          <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-gray-50/50 dark:bg-zinc-900/40 flex items-center justify-between shrink-0 rounded-b-xl">
            <span className="text-xs text-gray-400 dark:text-zinc-500">
              {!isLoading && t('node_assignments.assignment_count', { count: assignments.length })}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="btn-secondary"
              >
                {t('common.close')}
              </button>
              {isPlus && (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  disabled={metaLoading}
                  className="flex items-center gap-1.5 btn-primary"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  {t('node_assignments.add_assignment')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Modal: Zuweisung hinzufügen */}
      {(showAdd || editTarget) && (
        <AssignmentModal
          node={node}
          users={users}
          groups={groups}
          presets={presets}
          existing={editTarget}
          onClose={() => { setShowAdd(false); setEditTarget(null) }}
          onSaved={handleSaved}
        />
      )}

      {/* Confirm-Modal: Entfernen */}
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
