// p3portal.org
// PROJ-54: Favoriten-Tab in MyAccountPage – Liste, Reorder (↑↓), Label-Edit, Löschen.
import { useTranslation } from 'react-i18next'
import { useSidebarPins } from './hooks/useSidebarPins'
import { sidebarPinsApi } from './api'
import PinListRow from './components/PinListRow'

export default function FavoritesPage() {
  const { t } = useTranslation()
  const { pins, setPins, loading, error, reload } = useSidebarPins()

  const handleMoveUp = async (index) => {
    if (index === 0) return
    const newOrder = [...pins]
    ;[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]]
    setPins(newOrder)
    try {
      const updated = await sidebarPinsApi.reorder(newOrder.map(p => p.id))
      setPins(updated)
    } catch {
      reload()
    }
  }

  const handleMoveDown = async (index) => {
    if (index === pins.length - 1) return
    const newOrder = [...pins]
    ;[newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]]
    setPins(newOrder)
    try {
      const updated = await sidebarPinsApi.reorder(newOrder.map(p => p.id))
      setPins(updated)
    } catch {
      reload()
    }
  }

  const handleSaveLabel = async (id, label) => {
    const updated = await sidebarPinsApi.updateLabel(id, label)
    setPins(prev => prev.map(p => p.id === id ? updated : p))
  }

  const handleDelete = async (id) => {
    try {
      await sidebarPinsApi.remove(id)
      setPins(prev => prev.filter(p => p.id !== id))
    } catch {
      reload()
    }
  }

  if (loading) {
    return (
      <div className="h-32 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
    )
  }

  if (error) {
    return <p className="text-sm text-portal-danger">{error}</p>
  }

  if (pins.length === 0) {
    return (
      <div className="py-12 text-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.25} className="w-10 h-10 mx-auto text-gray-300 dark:text-zinc-600 mb-3">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
        <p className="text-sm text-gray-400 dark:text-zinc-500">{t('account.favorites.no_pins_yet')}</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">{t('account.favorites.add_hint')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 dark:text-zinc-400">{t('account.favorites.description')}</p>
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-zinc-700">
              <th className="text-center px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 w-8">#</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('account.favorites.col_label')}</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500 hidden md:table-cell">{t('account.favorites.col_route')}</th>
              <th className="text-right px-2 py-2.5 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-zinc-500">{t('account.favorites.col_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {pins.map((pin, i) => (
              <PinListRow
                key={pin.id}
                pin={pin}
                isFirst={i === 0}
                isLast={i === pins.length - 1}
                onMoveUp={() => handleMoveUp(i)}
                onMoveDown={() => handleMoveDown(i)}
                onSaveLabel={handleSaveLabel}
                onDelete={handleDelete}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 dark:text-zinc-500">
        {t('account.favorites.pin_count', { count: pins.length })}
      </p>
    </div>
  )
}
