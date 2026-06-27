// p3portal.org
// PROJ-47: Modal zum Hinzufügen / Bearbeiten einer Node-Assignment.
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { nodeAssignmentsApi } from '../api'
import { formatApiError } from '../../../api/errors'

const NODE_ACTION_LABELS = {
  'node:view_tasks':      'node_assignments.action_view_tasks',
  'node:view_backups':    'node_assignments.action_view_backups',
  'node:upload_iso':      'node_assignments.action_upload_iso',
  'node:view_updates':    'node_assignments.action_view_updates',
  'node:refresh_updates': 'node_assignments.action_refresh_updates',
  'node:manage_network':  'node_assignments.action_manage_network',
  'node:manage_firewall': 'node_assignments.action_manage_firewall',
}

const selectCls =
  'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent/50 focus:ring-1 focus:ring-portal-accent transition rounded-md'

export default function AssignmentModal({ node, users, groups, presets, existing, onClose, onSaved }) {
  const { t } = useTranslation()
  const isEdit = !!existing

  const [subjectType, setSubjectType] = useState(existing?.subject_type ?? 'user')
  const [subjectId,   setSubjectId]   = useState(existing ? String(existing.subject_id) : '')
  const [presetId,    setPresetId]    = useState(existing ? String(existing.role_preset_id) : '')
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState('')

  useEffect(() => {
    if (!isEdit) {
      setSubjectId('')
      setPresetId('')
    }
  }, [subjectType, isEdit])

  const selectedPreset = presets.find(p => String(p.id) === presetId)
  const subjectOptions = subjectType === 'user' ? users : groups

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!subjectId || !presetId) return
    setBusy(true)
    setError('')
    try {
      if (isEdit) {
        await nodeAssignmentsApi.update(node.id, existing.subject_type, existing.subject_id, {
          role_preset_id: Number(presetId),
        })
      } else {
        await nodeAssignmentsApi.add(node.id, {
          subject_type: subjectType,
          subject_id:   Number(subjectId),
          role_preset_id: Number(presetId),
        })
      }
      onSaved()
    } catch (err) {
      setError(formatApiError(err, t('node_assignments.assign_add_error')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl border border-zinc-200 dark:border-zinc-700 w-full max-w-lg flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {isEdit
              ? t('node_assignments.assign_edit_title')
              : t('node_assignments.assign_add_title', { node: node.name })}
          </h2>
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

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Sektion: Subjekt */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              {t('node_assignments.section_subject')}
            </p>
            {/* Typ-Toggle */}
            {!isEdit && (
              <div className="flex gap-2 mb-3">
                {['user', 'group'].map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setSubjectType(type)}
                    className={`flex-1 text-xs px-3 py-1.5 border transition-colors rounded-md ${
                      subjectType === type
                        ? 'bg-portal-accent border-portal-accent/50 text-white'
                        : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:border-portal-accent/50'
                    }`}
                  >
                    {t(`node_assignments.subject_type_${type}`)}
                  </button>
                ))}
              </div>
            )}

            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {t(`node_assignments.subject_type_${isEdit ? existing.subject_type : subjectType}`)} *
            </label>
            {isEdit ? (
              <p className="text-sm text-gray-900 dark:text-zinc-100 px-3 py-2 bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-md">
                {existing.subject_display ?? `ID ${existing.subject_id}`}
              </p>
            ) : (
              <select
                required
                value={subjectId}
                onChange={e => setSubjectId(e.target.value)}
                className={selectCls}
              >
                <option value="">{t('node_assignments.subject_placeholder')}</option>
                {subjectOptions.map(s => (
                  <option key={s.id} value={s.id}>{s.username ?? s.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Sektion: Preset */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
              {t('node_assignments.section_preset')}
            </p>
            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {t('node_assignments.field_preset')} *
            </label>
            <select
              required
              value={presetId}
              onChange={e => setPresetId(e.target.value)}
              className={selectCls}
            >
              <option value="">{t('node_assignments.preset_placeholder')}</option>
              {presets.map(p => {
                const vmCount   = p.permissions?.length ?? 0
                const nodeCount = p.node_actions?.length ?? 0
                const hint = `${vmCount} VM-Akt. · ${nodeCount} Node-Akt.`
                return (
                  <option key={p.id} value={p.id}>
                    {p.name} ({hint})
                  </option>
                )
              })}
            </select>
          </div>

          {/* Vorschau */}
          {selectedPreset && (
            <div className="bg-gray-50 dark:bg-zinc-800/50 border border-gray-200 dark:border-zinc-700 rounded-lg px-4 py-3 space-y-1.5">
              <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
                {t('node_assignments.preview_title')}
              </p>
              <p className="text-xs text-gray-700 dark:text-zinc-300">
                {t('node_assignments.preview_vms', { node: node.name })}
              </p>
              {selectedPreset.node_actions?.length > 0 && (
                <p className="text-xs text-gray-500 dark:text-zinc-400">
                  {t('node_assignments.preview_node_actions')}:{' '}
                  {selectedPreset.node_actions
                    .map(a => t(NODE_ACTION_LABELS[a] ?? a, { defaultValue: a }))
                    .join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </form>

        {/* Sticky Footer */}
        <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 bg-gray-50/50 dark:bg-zinc-900/40 flex items-center justify-end gap-2 shrink-0 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form="assign-form"
            disabled={busy || !subjectId || !presetId}
            onClick={handleSubmit}
            className="btn-primary"
          >
            {busy ? '…' : isEdit ? t('node_assignments.assign_edit_save') : t('node_assignments.assign_add_btn')}
          </button>
        </div>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
