// p3portal.org
/**
 * PROJ-79: Modal for creating or fully editing a Linux bridge (vmbrN).
 * Fields: name, bridge ports (multiselect of node devices), VLAN-aware + VIDs,
 * IPv4 CIDR + gateway, optional IPv6 CIDR + gateway, MTU, autostart, comment.
 * On edit the interface name is read-only (Proxmox cannot rename an interface).
 */
import { useState, useEffect } from 'react'
import { createNetworkInterface, updateNetworkInterface, listNetworkDevices } from '../../api/networks'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500 rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'
const fieldCls = 'space-y-1'

const BRIDGE_NAME_RE = /^vmbr\d{1,4}$/

function errMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 403) return 'Fehlende Proxmox-Privilegien (Sys.Modify auf /nodes erforderlich).'
  if (s === 503) return 'Admin-Token für diese Node nicht konfiguriert.'
  if (s === 422) return (typeof d === 'string' ? d : 'Ungültige Parameter – bitte Eingaben prüfen.')
  if (s === 409) return 'Ein Interface mit diesem Namen existiert bereits.'
  if (s === 502) return 'Proxmox-API nicht erreichbar.'
  return (typeof d === 'string' ? d : null) ?? 'Fehler beim Speichern der Bridge.'
}

function buildInitialState(iface) {
  if (!iface) {
    return {
      name: '', bridgePorts: [], vlanAware: false, vids: '',
      cidr: '', gateway: '', cidr6: '', gateway6: '',
      mtu: '', autostart: true, comments: '',
    }
  }
  return {
    name: iface.iface ?? '',
    bridgePorts: iface.bridge_ports ?? [],
    vlanAware: Boolean(iface.bridge_vlan_aware),
    vids: iface.bridge_vids ?? '',
    cidr: iface.cidr ?? '',
    gateway: iface.gateway ?? '',
    cidr6: iface.cidr6 ?? '',
    gateway6: iface.gateway6 ?? '',
    mtu: iface.mtu != null ? String(iface.mtu) : '',
    autostart: iface.autostart ?? true,
    comments: iface.comments ?? '',
  }
}

function buildPayload(form) {
  const payload = {
    type: 'bridge',
    iface: form.name.trim(),
    bridge_ports: form.bridgePorts,
    bridge_vlan_aware: form.vlanAware,
    autostart: form.autostart,
  }
  if (form.vlanAware && form.vids.trim()) payload.bridge_vids = form.vids.trim()
  if (form.cidr.trim())     payload.cidr = form.cidr.trim()
  if (form.gateway.trim())  payload.gateway = form.gateway.trim()
  if (form.cidr6.trim())    payload.cidr6 = form.cidr6.trim()
  if (form.gateway6.trim()) payload.gateway6 = form.gateway6.trim()
  if (form.mtu !== '')      payload.mtu = parseInt(form.mtu, 10)
  if (form.comments.trim()) payload.comments = form.comments.trim()
  return payload
}

export default function NetworkBridgeFormModal({ node, iface, onClose, onSuccess }) {
  const isEdit = Boolean(iface)
  const [form, setForm]       = useState(() => buildInitialState(iface))
  const [devices, setDevices] = useState([])
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [warnings, setWarnings] = useState([])

  // Load available raw devices/ports for the port multiselect.
  useEffect(() => {
    if (!node) return
    listNetworkDevices(node)
      .then(d => setDevices((d ?? []).filter(name => name !== form.name)))
      .catch(() => setDevices([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node])

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))
  const setBool = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.checked }))

  const togglePort = (dev) => setForm(prev => ({
    ...prev,
    bridgePorts: prev.bridgePorts.includes(dev)
      ? prev.bridgePorts.filter(p => p !== dev)
      : [...prev.bridgePorts, dev],
  }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setWarnings([])
    if (!isEdit && !BRIDGE_NAME_RE.test(form.name.trim())) {
      setError('Bridge-Name muss dem Muster vmbrN entsprechen (z. B. vmbr1).'); return
    }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form)
      const res = isEdit
        ? await updateNetworkInterface(node, iface.iface, payload)
        : await createNetworkInterface(node, payload)
      if (res?.warnings?.length) {
        // Surface non-blocking advisories but still succeed.
        setWarnings(res.warnings)
      }
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
        className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl w-full max-w-2xl rounded-xl flex flex-col max-h-[90vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bridge-modal-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="bridge-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? `Bridge bearbeiten – ${iface.iface}` : 'Linux-Bridge anlegen'}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <form id="bridge-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-5 flex-1">
          {error && (
            <div className="text-sm text-red-400 bg-red-950/40 border border-red-800 px-3 py-2 rounded">
              {error}
            </div>
          )}
          {warnings.length > 0 && (
            <div className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 px-3 py-2 rounded">
              {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
            </div>
          )}

          {/* Name */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="br-name">Name <span className="text-red-400">*</span></label>
            <input
              id="br-name"
              type="text"
              value={form.name}
              onChange={set('name')}
              disabled={isEdit}
              placeholder="vmbr1"
              className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            <p className={smallCls}>{isEdit ? 'Name kann nicht geändert werden.' : 'Muster vmbrN – z. B. vmbr1, vmbr10.'}</p>
          </div>

          {/* Bridge ports */}
          <div className={fieldCls}>
            <label className={labelCls}>Bridge-Ports (optional)</label>
            {devices.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {devices.map(dev => {
                  const sel = form.bridgePorts.includes(dev)
                  return (
                    <button
                      key={dev}
                      type="button"
                      onClick={() => togglePort(dev)}
                      className={`px-3 py-1.5 text-xs rounded border font-mono transition-colors ${
                        sel
                          ? 'bg-orange-500 border-orange-500 text-white'
                          : 'border-gray-300 dark:border-zinc-600 text-gray-600 dark:text-zinc-400 hover:border-orange-400'
                      }`}
                    >
                      {dev}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className={smallCls}>Keine weiteren Geräte gefunden – Bridge bleibt portlos (internes Netz).</p>
            )}
          </div>

          {/* VLAN-aware toggle + VIDs */}
          <div className="flex items-center gap-3">
            <input
              id="br-vlanaware"
              type="checkbox"
              checked={form.vlanAware}
              onChange={setBool('vlanAware')}
              className="w-4 h-4 rounded accent-orange-500"
            />
            <label htmlFor="br-vlanaware" className="text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
              VLAN-aware (802.1q)
            </label>
          </div>
          {form.vlanAware && (
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="br-vids">Erlaubte VIDs</label>
              <input
                id="br-vids"
                type="text"
                value={form.vids}
                onChange={set('vids')}
                placeholder="2-4094"
                className={inputCls}
              />
              <p className={smallCls}>Leerzeichen/Komma-getrennte VIDs oder Bereiche, z. B. &bdquo;2-4094&ldquo; oder &bdquo;10 20 30-40&ldquo;.</p>
            </div>
          )}

          {/* IPv4 */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="br-cidr">IPv4 CIDR (optional)</label>
              <input id="br-cidr" type="text" value={form.cidr} onChange={set('cidr')} placeholder="10.0.0.1/24" className={inputCls} />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="br-gw">IPv4 Gateway (optional)</label>
              <input id="br-gw" type="text" value={form.gateway} onChange={set('gateway')} placeholder="10.0.0.254" className={inputCls} />
            </div>
          </div>

          {/* IPv6 */}
          <div className="grid grid-cols-2 gap-4">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="br-cidr6">IPv6 CIDR (optional)</label>
              <input id="br-cidr6" type="text" value={form.cidr6} onChange={set('cidr6')} placeholder="fd00::1/64" className={inputCls} />
            </div>
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="br-gw6">IPv6 Gateway (optional)</label>
              <input id="br-gw6" type="text" value={form.gateway6} onChange={set('gateway6')} placeholder="fd00::ffff" className={inputCls} />
            </div>
          </div>

          {/* MTU + Autostart */}
          <div className="grid grid-cols-2 gap-4 items-end">
            <div className={fieldCls}>
              <label className={labelCls} htmlFor="br-mtu">MTU (optional)</label>
              <input id="br-mtu" type="number" min="128" max="65520" value={form.mtu} onChange={set('mtu')} placeholder="1500" className={inputCls} />
              <p className={smallCls}>Üblich 1500; Jumbo-Frames bis 9000.</p>
            </div>
            <div className="flex items-center gap-3 pb-2">
              <input
                id="br-autostart"
                type="checkbox"
                checked={form.autostart}
                onChange={setBool('autostart')}
                className="w-4 h-4 rounded accent-orange-500"
              />
              <label htmlFor="br-autostart" className="text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
                Autostart (beim Boot aktivieren)
              </label>
            </div>
          </div>

          {/* Comment */}
          <div className={fieldCls}>
            <label className={labelCls} htmlFor="br-comments">Kommentar (optional)</label>
            <input id="br-comments" type="text" value={form.comments} onChange={set('comments')} placeholder="z. B. DMZ-Bridge" className={inputCls} />
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Abbrechen
          </button>
          <button type="submit" form="bridge-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? 'Speichern' : 'Bridge anlegen'}
          </button>
        </div>

        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
