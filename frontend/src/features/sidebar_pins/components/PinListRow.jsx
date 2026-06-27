// p3portal.org
// PROJ-54: Eine Zeile in der Favoriten-Liste (Profil-Tab).
// Zeigt Label (editierbar), Default-Label, Route, ↑↓-Buttons, Speichern, Löschen.
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function PinListRow({ pin, isFirst, isLast, onMoveUp, onMoveDown, onSaveLabel, onDelete }) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [label, setLabel]     = useState(pin.label ?? '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      await onSaveLabel(pin.id, label.trim() || null)
      setEditing(false)
    } catch {
      setError(t('account.favorites.save_error'))
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setLabel(pin.label ?? '')
    setEditing(false)
    setError('')
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleSave()
    if (e.key === 'Escape') handleCancel()
  }

  return (
    <tr className="border-t border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/30">
      {/* Position */}
      <td className="px-3 py-3 text-xs text-gray-400 dark:text-zinc-500 w-8 text-center">
        {pin.position + 1}
      </td>

      {/* Label / Edit */}
      <td className="px-3 py-3 min-w-[8rem]">
        {editing ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              type="text"
              value={label}
              maxLength={40}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('account.favorites.label_placeholder')}
              className="flex-1 text-sm px-2 py-1 border border-portal-accent/50 rounded bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-portal-accent"
            />
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary text-xs px-2 py-1"
            >
              {saving ? '…' : t('common.save')}
            </button>
            <button
              onClick={handleCancel}
              className="btn-secondary text-xs px-2 py-1"
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setLabel(pin.label ?? ''); setEditing(true) }}
            className="text-sm text-left text-gray-900 dark:text-zinc-100 hover:text-portal-accent transition-colors group flex items-center gap-1.5"
            title={t('account.favorites.click_to_edit_label')}
          >
            <span>{pin.label || <span className="text-gray-400 dark:text-zinc-500 italic">{t('account.favorites.no_custom_label')}</span>}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 dark:text-zinc-500">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
          </button>
        )}
        {error && <p className="text-xs text-portal-danger mt-0.5">{error}</p>}
      </td>

      {/* Route */}
      <td className="px-3 py-3 hidden md:table-cell">
        <span className="text-xs font-mono text-gray-400 dark:text-zinc-500 truncate max-w-[14rem] block">
          {pin.route}
        </span>
      </td>

      {/* ↑↓ Reorder */}
      <td className="px-2 py-3 text-right whitespace-nowrap">
        <div className="inline-flex items-center gap-0.5">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="p-1 rounded text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            title={t('account.favorites.move_up')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <polyline points="18 15 12 9 6 15" />
            </svg>
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="p-1 rounded text-gray-400 dark:text-zinc-500 hover:text-gray-700 dark:hover:text-zinc-200 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            title={t('account.favorites.move_down')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(pin.id)}
            className="p-1 rounded text-gray-400 dark:text-zinc-500 hover:text-portal-danger transition-colors"
            title={t('account.favorites.delete')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" /><path d="M14 11v6" />
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
            </svg>
          </button>
        </div>
      </td>
    </tr>
  )
}
