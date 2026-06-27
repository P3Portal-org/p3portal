// p3portal.org
import { useState } from 'react'
import AlertRuleFormModal from './AlertRuleFormModal'

const METRIC_LABEL = {
  cpu_percent: 'CPU',
  mem_percent: 'RAM',
  disk_percent: 'Disk',
  status: 'Status',
}

function ThresholdCell({ warning, critical }) {
  if (warning != null && critical != null) {
    return (
      <span className="font-mono text-xs">
        <span className="text-portal-warn">W:{warning}%</span>
        {' / '}
        <span className="text-portal-danger">C:{critical}%</span>
      </span>
    )
  }
  if (warning != null) return <span className="font-mono text-xs text-portal-warn">W:{warning}%</span>
  if (critical != null) return <span className="font-mono text-xs text-portal-danger">C:{critical}%</span>
  return <span className="text-gray-400 text-xs">—</span>
}

export default function AlertRuleList({
  rules,
  onUpdate,
  onDelete,
  plusEnabled,
  emptyText = 'Keine Regeln konfiguriert.',
}) {
  const [editRule, setEditRule] = useState(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const handleSave = async (payload) => {
    setSaving(true)
    setSaveError(null)
    try {
      await onUpdate(editRule.id, payload)
      setEditRule(null)
    } catch (err) {
      setSaveError(err?.response?.data?.detail ?? 'Speichern fehlgeschlagen.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (rule) => {
    if (!confirm(`Regel "${rule.name}" wirklich löschen?`)) return
    try {
      await onDelete(rule.id)
    } catch {
      // ignore
    }
  }

  if (rules.length === 0) {
    return (
      <p className="text-sm text-gray-400 dark:text-zinc-500 py-4 text-center">{emptyText}</p>
    )
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
            <tr>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-400">Name</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-400 w-20">Metrik</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-400 w-36">Schwellwert</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-400 w-16">Polls</th>
              <th className="text-left px-3 py-2.5 text-xs font-medium text-gray-500 dark:text-zinc-400 w-16">Aktiv</th>
              <th className="px-3 py-2.5 w-20" />
            </tr>
          </thead>
          <tbody>
            {rules.map(rule => (
              <tr key={rule.id} className="border-b border-gray-100 dark:border-zinc-800 last:border-0 hover:bg-gray-50 dark:hover:bg-zinc-800/40">
                <td className="px-4 py-2.5 text-gray-900 dark:text-zinc-100 font-medium truncate max-w-xs">
                  {rule.name}
                  {rule.filesystem && (
                    <span className="ml-1.5 text-xs text-gray-400 dark:text-zinc-500 font-mono">({rule.filesystem})</span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-gray-600 dark:text-zinc-300 text-xs">
                  {METRIC_LABEL[rule.metric] ?? rule.metric}
                </td>
                <td className="px-3 py-2.5">
                  <ThresholdCell warning={rule.warning_threshold} critical={rule.critical_threshold} />
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-zinc-400 font-mono">
                  {rule.sustained_polls}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block w-2 h-2 rounded-full ${rule.enabled ? 'bg-portal-success' : 'bg-gray-300 dark:bg-zinc-600'}`} />
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2 justify-end">
                    <button
                      onClick={() => { setEditRule(rule); setSaveError(null) }}
                      className="btn-table"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => handleDelete(rule)}
                      className="btn-table-danger"
                    >
                      Löschen
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editRule && (
        <AlertRuleFormModal
          rule={editRule}
          onSave={handleSave}
          onClose={() => setEditRule(null)}
          loading={saving}
          error={saveError}
          plusEnabled={plusEnabled}
        />
      )}
    </>
  )
}
