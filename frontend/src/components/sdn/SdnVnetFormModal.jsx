// p3portal.org
/**
 * PROJ-80: Modal for creating or fully editing an SDN VNet.
 * Fields: id, zone (dropdown of existing zones), VLAN tag (required + shown only
 * when the chosen zone is a VLAN zone), optional alias, vlan-aware flag.
 * The id is alphanumeric, ≤ 8 chars, letter-first. Staged as pending.
 */
import { useState } from 'react'
import { createSdnVnet, updateSdnVnet } from '../../api/sdn'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls = 'space-y-1'

const VNET_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,7}$/

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien (SDN.Allocate auf /sdn erforderlich).'
  if (s === 503) return 'Admin-Token (SDN.Allocate) für diesen Cluster nicht konfiguriert.'
  if (s === 422) return (typeof d === 'string' ? d : 'Ungültige Parameter – bitte Eingaben prüfen.')
  if (s === 409) return 'Ein VNet mit dieser ID existiert bereits.'
  if (s === 502) return 'Proxmox-API nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Speichern des VNets.'
}

function buildInitialState(vnet, zones) {
  if (!vnet) {
    return { id: '', zone: zones[0]?.id ?? '', tag: '', alias: '', vlanaware: false }
  }
  return {
    id: vnet.id ?? '',
    zone: vnet.zone ?? '',
    tag: vnet.tag != null ? String(vnet.tag) : '',
    alias: vnet.alias ?? '',
    vlanaware: Boolean(vnet.vlanaware),
  }
}

function buildPayload(form) {
  const payload = { vnet: form.id.trim(), zone: form.zone, vlanaware: form.vlanaware }
  if (form.tag !== '')      payload.tag = parseInt(form.tag, 10)
  if (form.alias.trim())    payload.alias = form.alias.trim()
  return payload
}

export default function SdnVnetFormModal({ vnet, zones = [], portalNodeId = null, onClose, onSuccess }) {
  const isEdit = Boolean(vnet)
  const [form, setForm]     = useState(() => buildInitialState(vnet, zones))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setBool = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))

  const selectedZone = zones.find(z => z.id === form.zone)
  const zoneIsVlan = selectedZone?.type === 'vlan'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isEdit && !VNET_ID_RE.test(form.id.trim())) {
      setError('VNet-ID muss mit einem Buchstaben beginnen, alphanumerisch und ≤ 8 Zeichen sein.'); return
    }
    if (!form.zone) { setError('Bitte eine Zone wählen.'); return }
    if (zoneIsVlan && form.tag === '') {
      setError('Ein VNet in einer VLAN-Zone benötigt einen VLAN-Tag (1–4094).'); return
    }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      if (isEdit) await updateSdnVnet(vnet.id, payload, portalNodeId)
      else await createSdnVnet(payload, portalNodeId)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(errMsg(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl w-full max-w-xl rounded-xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sdn-vnet-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="sdn-vnet-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? `VNet bearbeiten – ${vnet.id}` : 'VNet anlegen'}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form id="sdn-vnet-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>
          )}

          {zones.length === 0 && (
            <div className="text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 px-3 py-2 rounded">
              ⚠ Es existiert noch keine Zone. Bitte zuerst eine SDN-Zone anlegen.
            </div>
          )}

          {/* ID */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdnv-id">VNet-ID <span className="text-portal-danger">*</span></label>
            <input
              id="sdnv-id"
              type="text"
              value={form.id}
              onChange={set('id')}
              disabled={isEdit}
              placeholder="z. B. vnet1"
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            <p className={smallCls}>{isEdit ? 'ID kann nicht geändert werden.' : 'Buchstabe zuerst, alphanumerisch, ≤ 8 Zeichen.'}</p>
          </div>

          {/* Zone */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdnv-zone">Zone <span className="text-portal-danger">*</span></label>
            <select id="sdnv-zone" value={form.zone} onChange={set('zone')} className={inputCls}>
              <option value="">– Zone wählen –</option>
              {zones.map(z => (
                <option key={z.id} value={z.id}>{z.id} ({z.type})</option>
              ))}
            </select>
          </div>

          {/* VLAN Tag (only for VLAN zones) */}
          {zoneIsVlan && (
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="sdnv-tag">VLAN-Tag <span className="text-portal-danger">*</span></label>
              <input id="sdnv-tag" type="number" min="1" max="4094" value={form.tag} onChange={set('tag')} placeholder="100" className={inputCls} />
              <p className={smallCls}>Pflicht in VLAN-Zonen. Gültiger Bereich 1–4094.</p>
            </div>
          )}

          {/* Alias */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdnv-alias">Alias (optional)</label>
            <input id="sdnv-alias" type="text" value={form.alias} onChange={set('alias')} placeholder="z. B. Frontend-Netz" className={inputCls} />
          </div>

          {/* VLAN-aware */}
          <div className="flex items-center gap-3">
            <input
              id="sdnv-vlanaware"
              type="checkbox"
              checked={form.vlanaware}
              onChange={setBool('vlanaware')}
              className="w-4 h-4 rounded accent-portal-accent"
            />
            <label htmlFor="sdnv-vlanaware" className="text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
              VLAN-aware (Gäste dürfen eigene VLAN-Tags setzen)
            </label>
          </div>
        </form>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Abbrechen</button>
          <button type="submit" form="sdn-vnet-form" disabled={saving || zones.length === 0} className="btn-primary">
            {saving ? '…' : isEdit ? 'Speichern' : 'VNet anlegen'}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
