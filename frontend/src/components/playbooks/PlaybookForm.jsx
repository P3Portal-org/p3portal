// p3portal.org
import { Suspense, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { startJob } from '../../api/jobs'
import { getNodeDefaultTemplates } from '../../api/admin'
import PlaybookFormField from './PlaybookFormField'
import { useOwnerConfig } from '../../features/owners/hooks/useOwners'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'
import { useCapability } from '../../hooks/useCapability'
import OwnershipLimitBanner from '../../features/owners/components/OwnershipLimitBanner'
// PROJ-83: In-Guest-Run-Optionen (Core-Feature, direkter Import erlaubt)
import GuestScopeSelector from '../../features/ansible_inventory/components/GuestScopeSelector'
import DeployAnsibleOptions from '../../features/ansible_inventory/components/DeployAnsibleOptions'
// PROJ-62: Pool-Dropdown + QuotaErrorBanner via Plus-Registry (lazy, Core importiert nie direkt)
import { PlusComponents } from '../../plus'
const PoolSelectorField = PlusComponents.PoolSelectorField
const QuotaErrorBanner  = PlusComponents.QuotaErrorBanner

function validate(params, values) {
  const errors = {}
  for (const p of params) {
    const val = values[p.id]
    if (p.required && (val === '' || val == null)) {
      errors[p.id] = 'Pflichtfeld'
    }
    if (p.type === 'integer' && val !== '' && val != null) {
      if (p.min != null && Number(val) < p.min) errors[p.id] = `Minimum: ${p.min}`
      if (p.max != null && Number(val) > p.max) errors[p.id] = `Maximum: ${p.max}`
    }
  }
  return errors
}

// PROJ-48: Deploy-Kategorien die Owner-Auto-Assignment auslösen
const DEPLOY_CATEGORIES = ['vm_deployment', 'lxc_deployment']

export default function PlaybookForm({ playbook }) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [values, setValues] = useState(() =>
    Object.fromEntries((playbook.parameters ?? []).map(p => [p.id, p.default ?? '']))
  )
  const [errors, setErrors] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  // PROJ-62: 412-Detail für strukturierten QuotaErrorBanner
  const [quotaError, setQuotaError] = useState(null)
  const [nodeDefaults, setNodeDefaults] = useState({})
  const [autoAssignOwner, setAutoAssignOwner] = useState(true)
  // PROJ-62: Pool-Auswahl (Plus-only)
  const [selectedPoolId, setSelectedPoolId] = useState(null)
  // PROJ-83: In-Guest-Run (Gast-Playbook) bzw. Deploy-Onboarding-Optionen
  const [guestSelection, setGuestSelection] = useState(null)
  const [deployAnsible, setDeployAnsible] = useState({ manageForAnsible: true, globalOptIn: false })

  const { data: ownerConfig } = useOwnerConfig()
  const { ownerships } = useLicenseLimits()
  // PROJ-62: Gate für Pool-Dropdown und QuotaErrorBanner
  const poolsEnabled = useCapability('pools_quotas')

  // Checkbox nur rendern wenn Feature aktiv + Playbook-Kategorie passt
  const ownerEnabled = ownerConfig?.owner_auto_assign_enabled ?? false
  const ownerCategories = ownerConfig?.owner_auto_assign_categories ?? DEPLOY_CATEGORIES
  const showOwnerCheckbox = ownerEnabled && ownerCategories.includes(playbook.category ?? '')

  const hasTemplateParam = (playbook.parameters ?? []).some(p => p.type === 'proxmox_template')

  // PROJ-83: Gast-Playbook (hosts ≠ localhost) → Scope/Host-Selektor;
  // Deploy-Playbook → Ansible-Onboarding-Optionen.
  const isGuest = playbook.targets === 'guest'
  const isDeploy = DEPLOY_CATEGORIES.includes(playbook.category ?? '')

  useEffect(() => {
    if (!hasTemplateParam) return
    getNodeDefaultTemplates().then(data => {
      setNodeDefaults(data)
      // Node may have been auto-selected before defaults loaded — apply retroactively
      setValues(v => {
        if (!v.proxmox_node || v.tmpl_vmid) return v
        const defaultTmpl = data[v.proxmox_node]
        if (defaultTmpl == null) return v
        return { ...v, tmpl_vmid: defaultTmpl }
      })
    }).catch(() => {})
  }, [hasTemplateParam])

  const handleChange = (id, val) => {
    if (id === 'proxmox_node' && hasTemplateParam) {
      const defaultTmpl = nodeDefaults[val]
      setValues(v => ({
        ...v,
        proxmox_node: val,
        ...(defaultTmpl != null ? { tmpl_vmid: defaultTmpl } : { tmpl_vmid: '' }),
      }))
      setErrors(e => ({ ...e, proxmox_node: undefined, tmpl_vmid: undefined }))
    } else {
      setValues(v => ({ ...v, [id]: val }))
      setErrors(e => ({ ...e, [id]: undefined }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate(playbook.parameters ?? [], values)
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    setSubmitting(true)
    setSubmitError(null)
    setQuotaError(null)
    try {
      const cleaned = Object.fromEntries(
        Object.entries(values).filter(([id, val]) => {
          const p = (playbook.parameters ?? []).find(param => param.id === id)
          if (p?.type === 'ssh_key' && (val === '' || val == null)) return false
          if (p?.type === 'vm_access') return false
          return true
        })
      )
      // PROJ-83: In-Guest-Run + Deploy-Onboarding-Optionen
      const opts = {}
      if (isGuest && guestSelection) {
        opts.guestScope = guestSelection.guestScope
        opts.targetHosts = guestSelection.targetHosts
      }
      if (isDeploy) {
        opts.manageForAnsible = deployAnsible.manageForAnsible
        opts.globalOptIn = deployAnsible.globalOptIn
      }
      const result = await startJob(
        playbook.id,
        cleaned,
        showOwnerCheckbox ? autoAssignOwner : false,
        selectedPoolId,
        opts,
      )
      // PROJ-50: HTTP 202 → Freigabe erforderlich, Weiterleitung zur Pending-Page
      if (result?.approval_id) {
        navigate(`/approvals/pending/${result.approval_id}`)
      } else {
        navigate(`/events/${result.id}`)
      }
    } catch (err) {
      // PROJ-62: HTTP 412 Pool-Quota-Verletzung strukturiert anzeigen
      const detail = err.response?.data?.detail
      if (err.response?.status === 412 && detail?.error === 'pool_quota_exceeded') {
        setQuotaError(detail)
      } else {
        setSubmitError(
          typeof detail === 'string' ? detail : (detail?.msg ?? 'Fehler beim Starten des Jobs.')
        )
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-5">
      {(playbook.presets ?? []).length > 0 && (
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">
            Preset
          </label>
          <select
            className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent"
            defaultValue=""
            onChange={(e) => {
              const preset = (playbook.presets ?? []).find(p => p.label === e.target.value)
              if (preset) setValues(v => ({ ...v, ...preset.values }))
            }}
          >
            <option value="">– Preset wählen –</option>
            {(playbook.presets ?? []).map(p => (
              <option key={p.label} value={p.label}>{p.label}</option>
            ))}
          </select>
        </div>
      )}

      {(playbook.parameters ?? []).map(param => (
        <PlaybookFormField
          key={param.id}
          param={param}
          value={values[param.id]}
          onChange={handleChange}
          error={errors[param.id]}
          formValues={values}
        />
      ))}

      {/* PROJ-83: Gast-Playbook → Scope- und Host-Auswahl für den In-Guest-Run */}
      {isGuest && (
        <GuestScopeSelector onChange={setGuestSelection} />
      )}

      {/* PROJ-83: Deploy-Playbook → Opt-out-Haken „Für Ansible verwalten" */}
      {isDeploy && (
        <DeployAnsibleOptions onChange={setDeployAnsible} />
      )}

      {/* PROJ-62: Pool-Dropdown – nur bei Plus-Lizenz und Deploy-Playbooks */}
      {poolsEnabled && PoolSelectorField && (
        <Suspense fallback={null}>
          <PoolSelectorField value={selectedPoolId} onChange={setSelectedPoolId} />
        </Suspense>
      )}

      {/* PROJ-48: Owner-Auto-Assignment Checkbox + Limit-Banner */}
      {showOwnerCheckbox && (
        <div className="space-y-2">
          <OwnershipLimitBanner
            current={ownerships?.current ?? 0}
            max={ownerships?.max ?? null}
          />
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoAssignOwner}
              onChange={e => setAutoAssignOwner(e.target.checked)}
              disabled={ownerships?.used_at_limit}
              className="w-4 h-4 accent-orange-500 disabled:cursor-not-allowed"
            />
            <span className="text-sm text-gray-700 dark:text-zinc-300">
              {t('owners.deploy_checkbox_label')}
            </span>
          </label>
        </div>
      )}

      {/* PROJ-62: Quota-Fehler strukturiert (412) */}
      {quotaError && QuotaErrorBanner && (
        <Suspense fallback={null}>
          <QuotaErrorBanner detail={quotaError} />
        </Suspense>
      )}

      {submitError && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="btn-primary w-full flex items-center justify-center gap-2"
      >
        {submitting ? (
          <>
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            {t('playbooks.job_starting')}
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            {t('playbooks.job_start_btn')}
          </>
        )}
      </button>
    </form>
  )
}
// p3portal.org
