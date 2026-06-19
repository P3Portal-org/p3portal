// p3portal.org
/**
 * PROJ-80: Modal for creating or fully editing an SDN subnet (always under a VNet).
 * Fields: VNet (dropdown), CIDR, optional gateway, optional SNAT.
 * The PVE subnet id is {zone}-{cidr-dash}, so on edit the VNet + CIDR are read-only
 * (they identify the subnet); only gateway + SNAT can change. Staged as pending.
 */
import { useState } from 'react'
import { createSdnSubnet, updateSdnSubnet } from '../../api/sdn'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls = 'space-y-1'

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien (SDN.Allocate auf /sdn erforderlich).'
  if (s === 503) return 'Admin-Token (SDN.Allocate) für diesen Cluster nicht konfiguriert.'
  if (s === 422) return (typeof d === 'string' ? d : 'Ungültige Parameter – bitte Eingaben prüfen.')
  if (s === 502) return 'Proxmox-API nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Speichern des Subnets.'
}

function buildInitialState(subnet, vnets) {
  if (!subnet) {
    return { vnet: vnets[0]?.id ?? '', cidr: '', gateway: '', snat: false }
  }
  return {
    vnet: subnet.vnet ?? '',
    cidr: subnet.cidr ?? '',
    gateway: subnet.gateway ?? '',
    snat: Boolean(subnet.snat),
  }
}

function buildPayload(form) {
  const payload = { vnet: form.vnet, cidr: form.cidr.trim(), snat: form.snat }
  if (form.gateway.trim()) payload.gateway = form.gateway.trim()
  return payload
}

export default function SdnSubnetFormModal({ subnet, vnets = [], portalNodeId = null, onClose, onSuccess }) {
  const isEdit = Boolean(subnet)
  const [form, setForm]     = useState(() => buildInitialState(subnet, vnets))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [warnings, setWarnings] = useState([])

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setBool = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setWarnings([])
    if (!form.vnet) { setError('Bitte ein VNet wählen.'); return }
    if (!form.cidr.trim()) { setError('Bitte ein CIDR angeben (z. B. 10.0.0.0/24).'); return }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      const res = isEdit
        ? await updateSdnSubnet(subnet.vnet, subnet.id, payload, portalNodeId)
        : await createSdnSubnet(payload, portalNodeId)
      if (res?.warnings?.length) { setWarnings(res.warnings); }
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
        aria-labelledby="sdn-subnet-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="sdn-subnet-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? `Subnet bearbeiten – ${subnet.cidr || subnet.id}` : 'Subnet anlegen'}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form id="sdn-subnet-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>
          )}
          {warnings.length > 0 && (
            <div className="text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 px-3 py-2 rounded">
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {!isEdit && vnets.length === 0 && (
            <div className="text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 px-3 py-2 rounded">
              ⚠ Es existiert noch kein VNet. Bitte zuerst ein VNet anlegen.
            </div>
          )}

          {/* VNet */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdns-vnet">VNet <span className="text-portal-danger">*</span></label>
            <select
              id="sdns-vnet"
              value={form.vnet}
              onChange={set('vnet')}
              disabled={isEdit}
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <option value="">– VNet wählen –</option>
              {vnets.map(v => (
                <option key={v.id} value={v.id}>{v.id}{v.zone ? ` (Zone ${v.zone})` : ''}</option>
              ))}
            </select>
            {isEdit && <p className={smallCls}>VNet kann nicht geändert werden.</p>}
          </div>

          {/* CIDR */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdns-cidr">CIDR <span className="text-portal-danger">*</span></label>
            <input
              id="sdns-cidr"
              type="text"
              value={form.cidr}
              onChange={set('cidr')}
              disabled={isEdit}
              placeholder="10.0.0.0/24"
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            <p className={smallCls}>{isEdit ? 'CIDR ist Teil der Subnet-ID und nicht änderbar.' : 'Netz in CIDR-Notation, z. B. 10.0.0.0/24.'}</p>
          </div>

          {/* Gateway */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdns-gw">Gateway (optional)</label>
            <input id="sdns-gw" type="text" value={form.gateway} onChange={set('gateway')} placeholder="10.0.0.1" className={inputCls} />
            <p className={smallCls}>Sollte innerhalb des Subnetzes liegen (sonst nur Warnung).</p>
          </div>

          {/* SNAT */}
          <div className="flex items-center gap-3">
            <input
              id="sdns-snat"
              type="checkbox"
              checked={form.snat}
              onChange={setBool('snat')}
              className="w-4 h-4 rounded accent-portal-accent"
            />
            <label htmlFor="sdns-snat" className="text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
              SNAT (Source-NAT für ausgehenden Verkehr)
            </label>
          </div>
        </form>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Abbrechen</button>
          <button type="submit" form="sdn-subnet-form" disabled={saving || (!isEdit && vnets.length === 0)} className="btn-primary">
            {saving ? '…' : isEdit ? 'Speichern' : 'Subnet anlegen'}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
