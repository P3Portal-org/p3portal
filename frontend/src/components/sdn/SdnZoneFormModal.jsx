// p3portal.org
/**
 * PROJ-80: Modal for creating or fully editing an SDN zone (Simple or VLAN).
 * Simple zone: id (+ optional MTU/nodes/DNS). VLAN zone: id + bridge (required)
 * + optional MTU/nodes. The zone id is alphanumeric, ≤ 8 chars, must start with a
 * letter (PVE limit). The type is immutable on edit (PVE). Staged as pending –
 * only real after the cluster-wide Apply.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createSdnZone, updateSdnZone, listSdnBridges } from '../../api/sdn'

const CUSTOM = '__custom__'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls = 'space-y-1'

const ZONE_ID_RE = /^[A-Za-z][A-Za-z0-9]{0,7}$/

function errMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('sdn.zone.err_403')
  if (s === 503) return t('sdn.zone.err_503')
  if (s === 422) return (typeof d === 'string' ? d : t('sdn.zone.err_422'))
  if (s === 409) return t('sdn.zone.err_409')
  if (s === 502) return t('sdn.zone.err_502')
  return (typeof d === 'string' ? d : null) ?? t('sdn.zone.err_generic')
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
  const { t } = useTranslation()
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
      setError(t('sdn.zone.id_invalid')); return
    }
    if (form.type === 'vlan' && !form.bridge.trim()) {
      setError(t('sdn.zone.bridge_required')); return
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
      setError(errMsg(err, t))
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
            {isEdit ? t('sdn.zone.title_edit', { id: zone.id }) : t('sdn.zone.title_new')}
          </h2>
          <button onClick={onClose} aria-label={t('sdn.btn_close')} className="btn-ghost">
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
            <label className={labelCls} htmlFor="sdnz-type">{t('sdn.zone.field_type')} <span className="text-portal-danger">*</span></label>
            <select
              id="sdnz-type"
              value={form.type}
              onChange={set('type')}
              disabled={isEdit}
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <option value="simple">{t('sdn.zone.type_simple')}</option>
              <option value="vlan">{t('sdn.zone.type_vlan')}</option>
            </select>
            <p className={smallCls}>{isEdit ? t('sdn.zone.type_hint_edit') : t('sdn.zone.type_hint_new')}</p>
          </div>

          {/* ID */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="sdnz-id">{t('sdn.zone.field_id')} <span className="text-portal-danger">*</span></label>
            <input
              id="sdnz-id"
              type="text"
              value={form.id}
              onChange={set('id')}
              disabled={isEdit}
              placeholder={t('sdn.zone.id_ph')}
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            <p className={smallCls}>{isEdit ? t('sdn.zone.id_hint_edit') : t('sdn.zone.id_hint_new')}</p>
          </div>

          {/* Bridge (VLAN only) — dropdown of cluster bridges + free-text fallback */}
          {form.type === 'vlan' && (
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="sdnz-bridge">{t('sdn.zone.field_bridge')} <span className="text-portal-danger">*</span></label>
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
                  <option value="">{t('sdn.zone.bridge_select')}</option>
                  {bridges.map(b => <option key={b} value={b}>{b}</option>)}
                  <option value={CUSTOM}>{t('sdn.zone.bridge_custom')}</option>
                </select>
              ) : (
                <input id="sdnz-bridge" type="text" value={form.bridge} onChange={set('bridge')} placeholder="vmbr0" className={inputCls} />
              )}
              <p className={smallCls}>
                {bridges.length > 0
                  ? t('sdn.zone.bridge_hint_list')
                  : t('sdn.zone.bridge_hint_text')}
                {customBridge && bridges.length > 0 && (
                  <button type="button" onClick={() => { setCustomBridge(false); setForm(prev => ({ ...prev, bridge: '' })) }} className="ml-2 underline">
                    {t('sdn.zone.bridge_from_list')}
                  </button>
                )}
              </p>
            </div>
          )}

          {/* MTU + Nodes */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="sdnz-mtu">{t('sdn.zone.field_mtu')}</label>
              <input id="sdnz-mtu" type="number" min="128" max="65520" value={form.mtu} onChange={set('mtu')} placeholder={t('sdn.zone.mtu_ph')} className={inputCls} />
              <p className={smallCls}>{t('sdn.zone.mtu_hint')}</p>
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="sdnz-nodes">{t('sdn.zone.field_nodes')}</label>
              <input id="sdnz-nodes" type="text" value={form.nodes} onChange={set('nodes')} placeholder={t('sdn.zone.nodes_ph')} className={inputCls} />
              <p className={smallCls}>{t('sdn.zone.nodes_hint')}</p>
            </div>
          </div>

          {/* DNS (optional, Simple-typisch) */}
          {form.type === 'simple' && (
            <div className="grid grid-cols-2 gap-4">
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="sdnz-dns">{t('sdn.zone.field_dns')}</label>
                <input id="sdnz-dns" type="text" value={form.dns} onChange={set('dns')} placeholder={t('sdn.zone.dns_ph')} className={inputCls} />
              </div>
              <div className={fieldCls}>
                <label className={labelCls} htmlFor="sdnz-dnszone">{t('sdn.zone.field_dnszone')}</label>
                <input id="sdnz-dnszone" type="text" value={form.dnszone} onChange={set('dnszone')} placeholder={t('sdn.zone.dnszone_ph')} className={inputCls} />
              </div>
            </div>
          )}
        </form>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">{t('sdn.zone.cancel')}</button>
          <button type="submit" form="sdn-zone-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? t('sdn.zone.save') : t('sdn.zone.create')}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
