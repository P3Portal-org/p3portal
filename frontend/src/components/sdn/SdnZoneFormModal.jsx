// p3portal.org
/**
 * PROJ-80: Modal for creating or fully editing an SDN zone (Simple or VLAN).
 * Simple zone: id (+ optional MTU/nodes/DNS). VLAN zone: id + bridge (required)
 * + optional MTU/nodes. The zone id is alphanumeric, ≤ 8 chars, must start with a
 * letter (PVE limit). The type is immutable on edit (PVE). Staged as pending –
 * only real after the cluster-wide Apply.
 */
import { useState, useEffect } from 'react'
import { createSdnZone, updateSdnZone, listSdnBridges } from '../../api/sdn'

const CUSTOM = '__custom__'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls = 'space-y-1'

const ZONE_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,7}$/

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien (SDN.Allocate auf /sdn erforderlich).'
  if (s === 503) return 'Admin-Token (SDN.Allocate) für diesen Cluster nicht konfiguriert.'
  if (s === 422) return (typeof d === 'string' ? d : 'Ungültige Parameter – bitte Eingaben prüfen.')
  if (s === 409) return 'Eine Zone mit dieser ID existiert bereits.'
  if (s === 502) return 'Proxmox-API nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Speichern der Zone.'
}

function buildInitialState(zone) {
  if (!zone) {
    return { type: 'simple', id: '', bridge: '', mtu: '', nodes: '', dns: '', dnszone: '' }
  }
  return {
    type: zone.type === 'vlan' ? 'vlan' : 'simple',
    id: zone.id ?? '',
    bridge: zone.bridge ?? '',
    mtu: zone.mtu != null ? String(zone.mtu) : '',
    nodes: zone.nodes ?? '',
    dns: zone.dns ?? '',
    dnszone: zone.dnszone ?? '',
  }
}

function buildPayload(form) {
  const payload = { type: form.type, zone: form.id.trim() }
  if (form.type === 'vlan' && form.bridge.trim()) payload.bridge = form.bridge.trim()
  if (form.mtu !== '')        payload.mtu = parseInt(form.mtu, 10)
  if (form.nodes.trim())      payload.nodes = form.nodes.trim()
  if (form.dns.trim())        payload.dns = form.dns.trim()
  if (form.dnszone.trim())    payload.dnszone = form.dnszone.trim()
  return payload
}

export default function SdnZoneFormModal({ zone, portalNodeId = null, onClose, onSuccess }) {
  const isEdit = Boolean(zone)
  const [form, setForm]     = useState(() => buildInitialState(zone))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const [warnings, setWarnings] = useState([])
  const [bridges, setBridges] = useState([])
  const [customBridge, setCustomBridge] = useState(false)

  // Fetch the cluster-wide bridge list once for the VLAN-zone bridge dropdown.
  useEffect(() => {
    let active = true
    listSdnBridges(portalNodeId)
      .then(d => {
        if (!active) return
        const list = Array.isArray(d?.bridges) ? d.bridges : []
        setBridges(list)
        // Editing a VLAN zone whose bridge isn't among the found bridges → free text.
        if (form.type === 'vlan' && form.bridge && !list.includes(form.bridge)) setCustomBridge(true)
      })
      .catch(() => {})
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setWarnings([])
    if (!isEdit && !ZONE_ID_RE.test(form.id.trim())) {
      setError('Zone-ID muss mit einem Buchstaben beginnen, alphanumerisch und ≤ 8 Zeichen sein.'); return
    }
    if (form.type === 'vlan' && !form.bridge.trim()) {
      setError('Eine VLAN-Zone benötigt eine Bridge (z. B. vmbr0).'); return
    }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      const res = isEdit
        ? await updateSdnZone(zone.id, payload, portalNodeId)
        : await createSdnZone(payload, portalNodeId)
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
        aria-labelledby="sdn-zone-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="sdn-zone-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? `Zone bearbeiten – ${zone.id}` : 'SDN-Zone anlegen'}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form id="sdn-zone-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>
          )}
          {warnings.length > 0 && (
            <div className="text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 px-3 py-2 rounded">
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {/* Type */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdnz-type">Typ <span className="text-portal-danger">*</span></label>
            <select
              id="sdnz-type"
              value={form.type}
              onChange={set('type')}
              disabled={isEdit}
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <option value="simple">Simple (einfaches Overlay, NAT-fähig)</option>
              <option value="vlan">VLAN (Bridge + VLAN-Trunk)</option>
            </select>
            <p className={smallCls}>{isEdit ? 'Typ kann nicht geändert werden.' : 'Simple = ohne VLAN; VLAN = VNets als VLANs auf einer Bridge.'}</p>
          </div>

          {/* ID */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdnz-id">Zone-ID <span className="text-portal-danger">*</span></label>
            <input
              id="sdnz-id"
              type="text"
              value={form.id}
              onChange={set('id')}
              disabled={isEdit}
              placeholder="z. B. zone1"
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            <p className={smallCls}>{isEdit ? 'ID kann nicht geändert werden.' : 'Buchstabe zuerst, alphanumerisch, ≤ 8 Zeichen.'}</p>
          </div>

          {/* Bridge (VLAN only) — dropdown of cluster bridges + free-text fallback */}
          {form.type === 'vlan' && (
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="sdnz-bridge">Bridge <span className="text-portal-danger">*</span></label>
              {!customBridge && bridges.length > 0 ? (
                <select
                  id="sdnz-bridge"
                  value={bridges.includes(form.bridge) ? form.bridge : ''}
                  onChange={e => {
                    if (e.target.value === CUSTOM) {
                      setCustomBridge(true)
                      setForm(prev => ({ ...prev, bridge: '' }))
                    } else {
                      setForm(prev => ({ ...prev, bridge: e.target.value }))
                    }
                  }}
                  className={inputCls}
                >
                  <option value="">– Bridge wählen –</option>
                  {bridges.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value={CUSTOM}>Eigener Wert…</option>
                </select>
              ) : (
                <input id="sdnz-bridge" type="text" value={form.bridge} onChange={set('bridge')} placeholder="vmbr0" className={inputCls} />
              )}
              <p className={smallCls}>
                {bridges.length > 0
                  ? 'Physische/Linux-Bridge als VLAN-Trunk – Auswahl aus den im Cluster gefundenen Bridges.'
                  : 'Physische/Linux-Bridge, die als VLAN-Trunk dient (z. B. vmbr0).'}
                {customBridge && bridges.length > 0 && (
                  <button type="button" onClick={() => { setCustomBridge(false); setForm(prev => ({ ...prev, bridge: '' })) }} className="ml-2 underline">
                    Aus Liste wählen
                  </button>
                )}
              </p>
            </div>
          )}

          {/* MTU + Nodes */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="sdnz-mtu">MTU (optional)</label>
              <input id="sdnz-mtu" type="number" min="128" max="65520" value={form.mtu} onChange={set('mtu')} placeholder="1500" className={inputCls} />
              <p className={smallCls}>Üblich 1500; VXLAN-Overheads beachten.</p>
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="sdnz-nodes">Nodes (optional)</label>
              <input id="sdnz-nodes" type="text" value={form.nodes} onChange={set('nodes')} placeholder="pve1,pve2" className={inputCls} />
              <p className={smallCls}>Beschränkung auf bestimmte Nodes (kommasepariert).</p>
            </div>
          </div>

          {/* DNS (optional, Simple-typisch) */}
          {form.type === 'simple' && (
            <div className="grid grid-cols-2 gap-4">
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="sdnz-dns">DNS-Server (optional)</label>
                <input id="sdnz-dns" type="text" value={form.dns} onChange={set('dns')} placeholder="pve-dns" className={inputCls} />
              </div>
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="sdnz-dnszone">DNS-Zone (optional)</label>
                <input id="sdnz-dnszone" type="text" value={form.dnszone} onChange={set('dnszone')} placeholder="example.local" className={inputCls} />
              </div>
            </div>
          )}
        </form>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Abbrechen</button>
          <button type="submit" form="sdn-zone-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? 'Speichern' : 'Zone anlegen'}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
