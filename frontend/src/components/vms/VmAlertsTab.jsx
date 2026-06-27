// p3portal.org
import { useState, useEffect, useCallback, Suspense } from 'react'
import { fetchNodes } from '../../api/nodes'
import { useCapability } from '../../hooks/useCapability'
import {
  getVmAlertSummary,
  createVmRule,
  updateVmRule,
  deleteVmRule,
  listAlertStates,
  listPresets,
  assignPreset,
  removePresetAssignment,
} from '../../api/alerts'
import AlertRuleList from '../alerts/AlertRuleList'
import AlertRuleFormModal from '../alerts/AlertRuleFormModal'
import ConfirmModal from '../common/ConfirmModal'
import { PlusComponents } from '../../plus'

const VmAlertPresetSection = PlusComponents.VmAlertPresetSection

const SEVERITY_STYLE = {
  critical: {
    dot: 'bg-portal-danger',
    text: 'text-portal-danger',
    bg: 'bg-portal-danger/10 border-portal-danger/30',
    label: 'Kritisch',
  },
  warning: {
    dot: 'bg-portal-warn',
    text: 'text-portal-warn',
    bg: 'bg-portal-warn/10 border-portal-warn/30',
    label: 'Warnung',
  },
}

function ActiveAlertsSection({ vmid }) {
  const [states, setStates] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listAlertStates()
      .then(all => setStates(all.filter(s => String(s.vmid) === String(vmid) && (s.state === 'warning' || s.state === 'critical'))))
      .catch(() => setStates([]))
      .finally(() => setLoading(false))
  }, [vmid])

  if (loading) return <p className="text-xs text-gray-400 dark:text-zinc-500 animate-pulse py-2">Lade Alerts…</p>

  if (states.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-portal-success py-2">
        <span className="w-2 h-2 rounded-full bg-portal-success shrink-0" />
        Keine aktiven Alerts
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {states.map(s => {
        const style = SEVERITY_STYLE[s.severity] ?? SEVERITY_STYLE.warning
        return (
          <div key={`${s.rule_id}-${s.severity}`} className={`flex items-center gap-3 border rounded-lg px-4 py-2.5 text-sm ${style.bg}`}>
            <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
            <span className={`font-semibold shrink-0 ${style.text}`}>{style.label}</span>
            <span className={`flex-1 ${style.text}`}>{s.rule_name}</span>
            {s.last_value != null && (
              <span className={`text-xs font-mono ${style.text} opacity-80`}>{s.last_value.toFixed(1)}%</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function VmAlertsTab({ vmid, nodeName, isAdmin }) {
  const plusEnabled = useCapability('alert_presets')
  const [nodeId, setNodeId] = useState(null)
  const [summary, setSummary] = useState(null)
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showNewRule, setShowNewRule] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [confirmAction, setConfirmAction] = useState(null)

  const loadNodeId = useCallback(async () => {
    if (!isAdmin) return null
    try {
      const nodes = await fetchNodes()
      const match = nodes.find(n => n.proxmox_node === nodeName || n.name === nodeName)
      return match?.id ?? null
    } catch {
      return null
    }
  }, [isAdmin, nodeName])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!isAdmin) { setLoading(false); return }

      const nid = await loadNodeId()
      setNodeId(nid)

      if (nid == null) { setLoading(false); return }

      const [summaryRes, presetsRes] = await Promise.allSettled([
        getVmAlertSummary(nid, vmid),
        plusEnabled ? listPresets() : Promise.resolve([]),
      ])

      if (summaryRes.status === 'fulfilled') setSummary(summaryRes.value)
      if (presetsRes.status === 'fulfilled') setPresets(presetsRes.value)
    } catch (err) {
      setError(err?.response?.data?.detail ?? 'Fehler beim Laden.')
    } finally {
      setLoading(false)
    }
  }, [isAdmin, loadNodeId, vmid, plusEnabled])

  useEffect(() => { load() }, [load])

  const handleCreate = async (payload) => {
    setSaving(true)
    setSaveError(null)
    try {
      await createVmRule(nodeId, vmid, payload)
      setShowNewRule(false)
      await load()
    } catch (err) {
      setSaveError(err?.response?.data?.detail ?? 'Regel konnte nicht erstellt werden.')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (ruleId, payload) => {
    await updateVmRule(nodeId, vmid, ruleId, payload)
    await load()
  }

  const handleDelete = async (ruleId) => {
    await deleteVmRule(nodeId, vmid, ruleId)
    await load()
  }

  const requestAssignPreset = (presetId) => {
    setConfirmAction({
      title: 'Preset zuweisen',
      body: 'Eine bestehende Zuweisung dieser VM wird ersetzt.',
      confirmLabel: 'Zuweisen',
      variant: 'primary',
      onConfirm: async () => {
        try {
          await assignPreset(presetId, String(vmid), nodeId)
          await load()
        } catch (err) {
          setError(err?.response?.data?.detail ?? 'Fehler beim Zuweisen.')
        }
      },
    })
  }

  const requestRemovePreset = () => {
    if (!summary?.preset) return
    const presetName = summary.preset.name
    const presetId = summary.preset.id
    setConfirmAction({
      title: 'Preset entfernen',
      body: `Preset "${presetName}" von dieser VM lösen?`,
      confirmLabel: 'Entfernen',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await removePresetAssignment(presetId, String(vmid), nodeId)
          await load()
        } catch (err) {
          setError(err?.response?.data?.detail ?? 'Fehler beim Entfernen.')
        }
      },
    })
  }

  return (
    <div className="space-y-6 py-2">
      {/* Active alerts - visible to all */}
      <section>
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-widest mb-3">
          Aktive Alerts
        </h3>
        <ActiveAlertsSection vmid={vmid} />
      </section>

      {/* Admin-only management section */}
      {isAdmin && (
        <>
          {loading ? (
            <div className="animate-pulse">
              <div className="h-4 bg-gray-200 dark:bg-zinc-700 rounded w-48 mb-4" />
              <div className="h-24 bg-gray-100 dark:bg-zinc-800 rounded" />
            </div>
          ) : error ? (
            <div className="border border-portal-danger/30 bg-portal-danger/10 px-3 py-2 text-xs text-portal-danger rounded">
              {error}
            </div>
          ) : nodeId == null ? (
            <div className="text-xs text-gray-400 dark:text-zinc-500 py-2">
              Node-ID konnte nicht ermittelt werden – Alertverwaltung nicht verfügbar.
            </div>
          ) : (
            <>
              {/* Effective rules */}
              {summary?.effective_rules?.length > 0 && (
                <section>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-widest mb-3">
                    Effektive Regeln
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-zinc-700">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 dark:bg-zinc-800 border-b border-gray-200 dark:border-zinc-700">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-gray-500 dark:text-zinc-400">Regel</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-20">Metrik</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-32">Schwellwert</th>
                          <th className="text-left px-3 py-2 font-medium text-gray-500 dark:text-zinc-400 w-20">Quelle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.effective_rules.map(r => (
                          <tr key={r.rule_id} className="border-b border-gray-100 dark:border-zinc-800 last:border-0">
                            <td className="px-4 py-2 text-gray-900 dark:text-zinc-100">{r.name}</td>
                            <td className="px-3 py-2 text-gray-500 dark:text-zinc-400">
                              {{ cpu_percent: 'CPU', mem_percent: 'RAM', disk_percent: 'Disk', status: 'Status' }[r.metric] ?? r.metric}
                            </td>
                            <td className="px-3 py-2 font-mono text-gray-600 dark:text-zinc-300">
                              {r.warning_threshold != null && <span className="text-portal-warn">W:{r.warning_threshold}%</span>}
                              {r.warning_threshold != null && r.critical_threshold != null && ' / '}
                              {r.critical_threshold != null && <span className="text-portal-danger">C:{r.critical_threshold}%</span>}
                            </td>
                            <td className="px-3 py-2 text-gray-400 dark:text-zinc-500 capitalize">
                              {r.source}{r.override_applied && <span className="ml-1 text-portal-accent">*</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {/* Plus: Preset assignment (PROJ-43 S17 – via Plus-Registry) */}
              {plusEnabled && VmAlertPresetSection && (
                <Suspense fallback={null}>
                  <VmAlertPresetSection
                    summary={summary}
                    presets={presets}
                    onAssign={requestAssignPreset}
                    onRemove={requestRemovePreset}
                  />
                </Suspense>
              )}

              {/* VM-specific rules */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-widest">
                    VM-spezifische Regeln
                  </h3>
                  <button onClick={() => { setShowNewRule(true); setSaveError(null) }}
                    className="text-xs text-portal-accent hover:underline transition-colors">
                    + Neue Regel
                  </button>
                </div>
                <AlertRuleList
                  rules={summary?.vm_rules ?? []}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  plusEnabled={plusEnabled}
                  emptyText="Keine VM-spezifischen Regeln – globale Regeln und Preset-Regeln greifen weiterhin."
                />
              </section>
            </>
          )}
        </>
      )}

      {/* New VM rule modal */}
      {showNewRule && (
        <AlertRuleFormModal
          rule={null}
          onSave={handleCreate}
          onClose={() => setShowNewRule(false)}
          loading={saving}
          error={saveError}
          plusEnabled={plusEnabled}
        />
      )}

      {/* Themed confirm modal for preset assign/remove (replaces native confirm()) */}
      {confirmAction && (
        <ConfirmModal
          {...confirmAction}
          onClose={() => setConfirmAction(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
