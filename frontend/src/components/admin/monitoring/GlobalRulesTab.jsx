// p3portal.org
import { useState, useEffect, useCallback } from 'react'
import { getLicenseStatus } from '../../../api/license'
import {
  listGlobalRules,
  createGlobalRule,
  updateGlobalRule,
  deleteGlobalRule,
} from '../../../api/alerts'
import AlertRuleList from '../../alerts/AlertRuleList'
import AlertRuleFormModal from '../../alerts/AlertRuleFormModal'

export default function GlobalRulesTab() {
  const [rules, setRules] = useState([])
  const [plusEnabled, setPlusEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [loadError, setLoadError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [rulesData, licenseData] = await Promise.allSettled([
        listGlobalRules(),
        getLicenseStatus(),
      ])
      if (rulesData.status === 'fulfilled') setRules(rulesData.value)
      else setLoadError('Regeln konnten nicht geladen werden.')
      if (licenseData.status === 'fulfilled') setPlusEnabled(licenseData.value?.valid ?? false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async (payload) => {
    setSaving(true)
    setSaveError(null)
    try {
      await createGlobalRule(payload)
      setShowNew(false)
      await load()
    } catch (err) {
      setSaveError(err?.response?.data?.detail ?? 'Regel konnte nicht erstellt werden.')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (ruleId, payload) => {
    await updateGlobalRule(ruleId, payload)
    await load()
  }

  const handleDelete = async (ruleId) => {
    await deleteGlobalRule(ruleId)
    await load()
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-900 dark:text-zinc-100">Globale Alert-Regeln</h3>
          <p className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">
            Gelten für alle VMs, sofern kein Preset oder VM-spezifische Regel überschreibt.
          </p>
        </div>
        <button
          onClick={() => { setShowNew(true); setSaveError(null) }}
          className="btn-primary"
        >
          + Neue Regel
        </button>
      </div>

      {loadError && (
        <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger rounded">
          {loadError}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 dark:bg-zinc-800 rounded" />
          ))}
        </div>
      ) : (
        <AlertRuleList
          rules={rules}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          plusEnabled={plusEnabled}
          emptyText="Keine globalen Regeln – Regeln gelten für alle VMs."
        />
      )}

      {showNew && (
        <AlertRuleFormModal
          rule={null}
          onSave={handleCreate}
          onClose={() => setShowNew(false)}
          loading={saving}
          error={saveError}
          plusEnabled={plusEnabled}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
