// p3portal.org
// PROJ-45: Modal zum Anlegen / Bearbeiten einer Gruppe.
// Layout-Standard: form-Wrapper, max-w-3xl, Labels mit *, Sticky-Footer.
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { groupsApi } from '../api'
import { useTagsPool } from '../hooks/useGroups'
import { formatApiError } from '../../../api/errors'
import ModalHelpButton from '../../help/components/ModalHelpButton'

export default function GroupFormModal({ group, users, groupLimit, onSuccess, onClose }) {
  const { t } = useTranslation()
  const isEdit = Boolean(group)

  const [name, setName]               = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [tags, setTags]               = useState(group?.tags ?? [])
  const [tagInput, setTagInput]       = useState('')
  const [ownerId, setOwnerId]         = useState(group?.owner_user_id ?? '')
  const [clearOwner, setClearOwner]   = useState(false)
  const [busy, setBusy]               = useState(false)
  const [error, setError]             = useState('')

  const tagSuggestions = useTagsPool()
  const tagInputRef    = useRef(null)

  // close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // local users only (owner dropdown)
  const localUsers = (users ?? []).filter(u => u.auth_type === 'local' || !u.auth_type)

  const addTag = (raw) => {
    const t = raw.trim()
    if (!t || t.length > 32) return
    if (tags.includes(t)) { setTagInput(''); return }
    if (tags.length >= 10) { setTagInput(''); return }
    setTags(prev => [...prev, t])
    setTagInput('')
  }

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(tagInput)
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      setTags(prev => prev.slice(0, -1))
    }
  }

  const removeTag = (idx) => setTags(prev => prev.filter((_, i) => i !== idx))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const payload = { name, description: description || null, tags }
      if (clearOwner) {
        Object.assign(payload, { clear_owner: true })
      } else if (ownerId !== '') {
        payload.owner_user_id = Number(ownerId)
      }

      if (isEdit) {
        await groupsApi.update(group.id, payload)
      } else {
        await groupsApi.create(payload)
      }
      onSuccess()
    } catch (err) {
      setError(formatApiError(err, t('groups.save_error')))
    } finally {
      setBusy(false)
    }
  }

  const filteredSuggestions = tagSuggestions.filter(
    s => s.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(s)
  ).slice(0, 6)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
              {isEdit ? t('groups.modal_edit', { name: group.name }) : t('groups.modal_create')}
            </h2>
            {!isEdit && groupLimit && !groupLimit.unlimited && (
              <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                groupLimit.current >= groupLimit.max
                  ? 'bg-portal-danger/10 text-portal-danger'
                  : 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
              }`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3 shrink-0">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {groupLimit.current} / {groupLimit.max} {t('groups.limit_badge_label')}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.group_form" />
            <button type="button" onClick={onClose} className="btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {error && (
            <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {t('groups.field_name')} <span className="text-portal-danger">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              minLength={2}
              maxLength={64}
              placeholder={t('groups.field_name_placeholder')}
              className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {t('groups.field_description')}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              placeholder={t('groups.field_description_placeholder')}
              className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent resize-none"
            />
          </div>

          {/* Tags */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {t('groups.field_tags')}
              <span className="ml-1 text-gray-400 dark:text-zinc-500 font-normal">{t('groups.field_tags_hint')}</span>
            </label>
            <div
              onClick={() => tagInputRef.current?.focus()}
              className="flex flex-wrap gap-1.5 min-h-[2.25rem] px-2 py-1.5 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 cursor-text"
            >
              {tags.map((tag, idx) => (
                <span key={idx} className="flex items-center gap-1 text-xs bg-portal-accent/10 text-portal-accent px-2 py-0.5 rounded-full">
                  {tag}
                  <button type="button" onClick={() => removeTag(idx)} className="text-portal-accent hover:text-portal-accent leading-none">×</button>
                </span>
              ))}
              <input
                ref={tagInputRef}
                type="text"
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => { if (tagInput) addTag(tagInput) }}
                placeholder={tags.length === 0 ? t('groups.field_tags_placeholder') : ''}
                disabled={tags.length >= 10}
                className="flex-1 min-w-[8rem] text-sm bg-transparent outline-none text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500"
              />
            </div>
            {tagInput && filteredSuggestions.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-md shadow-lg text-sm overflow-hidden">
                {filteredSuggestions.map(s => (
                  <li
                    key={s}
                    onClick={() => addTag(s)}
                    className="px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-700 text-gray-800 dark:text-zinc-200"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Owner */}
          <div>
            <label className="block text-xs font-medium text-gray-700 dark:text-zinc-300 mb-1">
              {t('groups.field_owner')}
            </label>
            <select
              value={clearOwner ? '' : ownerId}
              onChange={e => { setClearOwner(false); setOwnerId(e.target.value) }}
              className="w-full text-sm px-3 py-2 border border-gray-300 dark:border-zinc-700 rounded-md bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent"
            >
              <option value="">{t('groups.field_owner_none')}</option>
              {localUsers.map(u => (
                <option key={u.id} value={u.id}>{u.username}</option>
              ))}
            </select>
            {isEdit && group?.owner_user_id && (
              <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearOwner}
                  onChange={e => { setClearOwner(e.target.checked); if (e.target.checked) setOwnerId('') }}
                  className="rounded border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent"
                />
                <span className="text-xs text-gray-500 dark:text-zinc-400">{t('groups.field_owner_clear')}</span>
              </label>
            )}
          </div>
        </div>

        {/* Sticky Footer */}
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
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
            disabled={busy}
            className="btn-primary"
          >
            {busy ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
