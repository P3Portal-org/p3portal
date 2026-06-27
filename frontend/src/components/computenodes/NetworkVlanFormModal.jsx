// p3portal.org
/**
 * PROJ-79: Modal for creating or fully editing a VLAN interface (e.g. vmbr0.100).
 * The name is auto-derived as <raw-device>.<tag>; raw-device + tag are always sent
 * so the backend validation (either dotted name OR raw_device+tag) is satisfied.
 * On edit the interface name + raw device + tag are read-only.
 */
import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { createNetworkInterface, updateNetworkInterface, listNetworkDevices } from '../../api/networks'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent/50 focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const fieldCls = 'space-y-1'

function errMsg(err, t) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return t('networks.vlan.err_403')
  if (s === 503) return t('networks.vlan.err_503')
  if (s === 422) return (typeof d === 'string' ? d : t('networks.vlan.err_422'))
  if (s === 409) return t('networks.vlan.err_409')
  if (s === 502) return t('networks.vlan.err_502')
  return (typeof d === 'string' ? d : null) ?? t('networks.vlan.err_generic')
}

function buildInitialState(iface) {
  if (!iface) {
    return {
      rawDevice: '', tag: '',
      cidr: '', gateway: '', mtu: '', autostart: true, comments: '',
    }
  }
  // Derive raw device + tag either from the explicit fields or the dotted name.
  let rawDevice = iface.vlan_raw_device ?? ''
  let tag = iface.vlan_id != null ? String(iface.vlan_id) : ''
  if ((!rawDevice || !tag) && iface.iface?.includes('.')) {
    const [dev, vid] = iface.iface.split('.')
    if (!rawDevice) rawDevice = dev
    if (!tag && /^\d+$/.test(vid)) tag = vid
  }
  return {
    rawDevice,
    tag,
    cidr: iface.cidr ?? '',
    gateway: iface.gateway ?? '',
    mtu: iface.mtu != null ? String(iface.mtu) : '',
    autostart: iface.autostart ?? true,
    comments: iface.comments ?? '',
  }
}

function derivedName(form) {
  if (form.rawDevice && form.tag !== '') return `${form.rawDevice}.${form.tag}`
  return ''
}

function buildPayload(form, ifaceName) {
  const payload = {
    type: 'vlan',
    iface: ifaceName,
    vlan_raw_device: form.rawDevice,
    vlan_id: parseInt(form.tag, 10),
    autostart: form.autostart,
  }
  if (form.cidr.trim())     payload.cidr = form.cidr.trim()
  if (form.gateway.trim())  payload.gateway = form.gateway.trim()
  if (form.mtu !== '')      payload.mtu = parseInt(form.mtu, 10)
  if (form.comments.trim()) payload.comments = form.comments.trim()
  return payload
}

export default function NetworkVlanFormModal({ node, iface, onClose, onSuccess }) {
  const { t } = useTranslation()
  const isEdit = Boolean(iface)
  const [form, setForm]       = useState(() => buildInitialState(iface))
  const [devices, setDevices] = useState([])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [warnings, setWarnings] = useState([])

  useEffect(() => {
    if (!node) return
    listNetworkDevices(node)
      // a VLAN raw device is typically a bridge or physical NIC, not a VLAN sub-iface
      .then(d => setDevices((d ?? []).filter(name => !name.includes('.'))))
      .catch(() => setDevices([]))
  }, [node])

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setBool = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))

  const name = isEdit ? iface.iface : derivedName(form)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setWarnings([])
    if (!isEdit) {
      if (!form.rawDevice) { setError(t('networks.vlan.raw_device_required')); return }
      const tagNum = parseInt(form.tag, 10)
      if (!Number.isInteger(tagNum) || tagNum < 1 || tagNum > 4094) {
        setError(t('networks.vlan.tag_invalid')); return
      }
    }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form, name)
      const res = isEdit
        ? await updateNetworkInterface(node, iface.iface, payload)
        : await createNetworkInterface(node, payload)
      if (res?.warnings?.length) {
        setWarnings(res.warnings)
      }
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
        className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl w-full max-w-2xl rounded-xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vlan-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="vlan-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? t('networks.vlan.title_edit', { name: iface.iface }) : t('networks.vlan.title_new')}
          </h2>
          <button onClick={onClose} aria-label={t('networks.vlan.aria_close')} className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form id="vlan-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">
              {error}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="text-xs text-portal-warn bg-portal-warn/10 border border-portal-warn/30 px-3 py-2 rounded">
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {/* Raw device + Tag */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="vl-rawdev">{t('networks.vlan.raw_device_label')} <span className="text-portal-danger">*</span></label>
              {devices.length > 0 && !isEdit ? (
                <select id="vl-rawdev" value={form.rawDevice} onChange={set('rawDevice')} className={inputCls}>
                  <option value="">{t('networks.vlan.raw_device_select_ph')}</option>
                  {devices.map(dev => <option key={dev} value={dev}>{dev}</option>)}
                </select>
              ) : (
                <input
                  id="vl-rawdev"
                  type="text"
                  value={form.rawDevice}
                  onChange={set('rawDevice')}
                  disabled={isEdit}
                  placeholder="vmbr0"
                  className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
                />
              )}
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="vl-tag">{t('networks.vlan.tag_label')} <span className="text-portal-danger">*</span></label>
              <input
                id="vl-tag"
                type="number"
                min="1"
                max="4094"
                value={form.tag}
                onChange={set('tag')}
                disabled={isEdit}
                placeholder="100"
                className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>
          </div>

          {/* Derived name preview */}
          <div className="text-xs text-gray-500 dark:text-zinc-400">
            {t('networks.vlan.iface_name_label')}{' '}
            <span className="font-mono text-gray-700 dark:text-zinc-200">{name || '—'}</span>
          </div>

          {/* IPv4 */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="vl-cidr">{t('networks.vlan.cidr4_label')}</label>
              <input id="vl-cidr" type="text" value={form.cidr} onChange={set('cidr')} placeholder="10.0.100.1/24" className={inputCls} />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="vl-gw">{t('networks.vlan.gw4_label')}</label>
              <input id="vl-gw" type="text" value={form.gateway} onChange={set('gateway')} placeholder="10.0.100.254" className={inputCls} />
            </div>
          </div>

          {/* MTU + Autostart */}
          <div className="grid grid-cols-2 gap-4 items-end">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="vl-mtu">{t('networks.vlan.mtu_label')}</label>
              <input id="vl-mtu" type="number" min="128" max="65520" value={form.mtu} onChange={set('mtu')} placeholder="1500" className={inputCls} />
            </div>
            <div className="flex items-center gap-3 pb-2">
              <input
                id="vl-autostart"
                type="checkbox"
                checked={form.autostart}
                onChange={setBool('autostart')}
                className="w-4 h-4 rounded accent-portal-accent"
              />
              <label htmlFor="vl-autostart" className="text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
                {t('networks.vlan.autostart_label')}
              </label>
            </div>
          </div>

          {/* Comment */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="vl-comments">{t('networks.vlan.comment_label')}</label>
            <input id="vl-comments" type="text" value={form.comments} onChange={set('comments')} placeholder={t('networks.vlan.comment_ph')} className={inputCls} />
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            {t('networks.vlan.cancel')}
          </button>
          <button type="submit" form="vlan-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? t('networks.vlan.submit_edit') : t('networks.vlan.submit_new')}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
