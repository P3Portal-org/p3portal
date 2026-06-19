// p3portal.org
/**
 * PROJ-90: Firewall options editor (level-aware: datacenter / node / guest).
 *   - Datacenter: policy_in/out, log_ratelimit, ebtables editable; ``enable`` is
 *     READ-ONLY (Entscheidung #4 – the global on/off is a footgun, set it in Proxmox).
 *   - Node: enable, log levels, conntrack, ndp, nosmurfs.
 *   - Guest: enable, dhcp, macfilter, ndp, radv, ipfilter, policy_in/out, log levels.
 *
 * AC-OPT-4: enabling the node/VM firewall while the default policy is DROP shows a
 * soft warning ("kann diesen Node/diese VM von eingehendem Verkehr abschneiden") –
 * no hard block. Options apply live.
 */
import { useState } from 'react'
import { firewallErrMsg } from '../../api/firewall'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const LOG_LEVELS = ['', 'nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']
const POLICIES = ['', 'ACCEPT', 'DROP', 'REJECT']

function Check({ id, label, checked, onChange, disabled }) {
  return (
    <label htmlFor={id} className={`flex items-center gap-2 text-sm cursor-pointer ${disabled ? 'opacity-60 cursor-not-allowed' : 'text-gray-700 dark:text-zinc-300'}`}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} disabled={disabled}
        className="rounded border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent" />
      {label}
    </label>
  )
}

function Sel({ id, label, value, onChange, opts, emptyLabel = '– unverändert –' }) {
  return (
    <div>
      <label className={labelCls} htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ''} onChange={onChange} className={inputCls}>
        {opts.map(o => <option key={o} value={o}>{o === '' ? emptyLabel : o}</option>)}
      </select>
    </div>
  )
}

function seed(level, options) {
  const o = options || {}
  if (level === 'datacenter') {
    return { policy_in: o.policy_in ?? '', policy_out: o.policy_out ?? '', log_ratelimit: o.log_ratelimit ?? '', ebtables: !!o.ebtables }
  }
  if (level === 'node') {
    return {
      enable: !!o.enable,
      log_level_in: o.log_level_in ?? '', log_level_out: o.log_level_out ?? '',
      smurf_log_level: o.smurf_log_level ?? '', tcp_flags_log_level: o.tcp_flags_log_level ?? '',
      nf_conntrack_max: o.nf_conntrack_max != null ? String(o.nf_conntrack_max) : '',
      nf_conntrack_tcp_timeout_established: o.nf_conntrack_tcp_timeout_established != null ? String(o.nf_conntrack_tcp_timeout_established) : '',
      ndp: !!o.ndp, nosmurfs: !!o.nosmurfs,
    }
  }
  // guest
  return {
    enable: !!o.enable, dhcp: !!o.dhcp, macfilter: !!o.macfilter, ndp: !!o.ndp, radv: !!o.radv, ipfilter: !!o.ipfilter,
    policy_in: o.policy_in ?? '', policy_out: o.policy_out ?? '',
    log_level_in: o.log_level_in ?? '', log_level_out: o.log_level_out ?? '',
  }
}

function buildPayload(level, form) {
  const p = {}
  const str = (v) => (v !== '' ? v : undefined)
  if (level === 'datacenter') {
    if (str(form.policy_in) !== undefined) p.policy_in = form.policy_in
    if (str(form.policy_out) !== undefined) p.policy_out = form.policy_out
    if (str(form.log_ratelimit) !== undefined) p.log_ratelimit = form.log_ratelimit
    p.ebtables = form.ebtables
    return p
  }
  if (level === 'node') {
    p.enable = form.enable
    for (const f of ['log_level_in', 'log_level_out', 'smurf_log_level', 'tcp_flags_log_level']) {
      if (str(form[f]) !== undefined) p[f] = form[f]
    }
    if (form.nf_conntrack_max !== '') p.nf_conntrack_max = parseInt(form.nf_conntrack_max, 10)
    if (form.nf_conntrack_tcp_timeout_established !== '') p.nf_conntrack_tcp_timeout_established = parseInt(form.nf_conntrack_tcp_timeout_established, 10)
    p.ndp = form.ndp; p.nosmurfs = form.nosmurfs
    return p
  }
  // guest
  for (const f of ['enable', 'dhcp', 'macfilter', 'ndp', 'radv', 'ipfilter']) p[f] = form[f]
  for (const f of ['policy_in', 'policy_out', 'log_level_in', 'log_level_out']) {
    if (str(form[f]) !== undefined) p[f] = form[f]
  }
  return p
}

export default function FirewallOptionsForm({ level, options, onSave, onChanged }) {
  const [form, setForm] = useState(() => seed(level, options))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm(prev => ({ ...prev, [key]: v }))
    setSaved(false)
  }

  // AC-OPT-4: enabling node/VM firewall with a DROP default policy is risky.
  const enablingWithDrop =
    level !== 'datacenter' && form.enable && !options?.enable &&
    ((level === 'guest' && form.policy_in === 'DROP') || level === 'node')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      await onSave(buildPayload(level, form))
      setSaved(true)
      onChanged?.()
    } catch (err) {
      setError(firewallErrMsg(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl">
      {error && <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>}
      {saved && <div className="text-sm text-portal-success bg-portal-success/10 border border-portal-success/30 px-3 py-2 rounded">Optionen gespeichert.</div>}

      {/* Datacenter ── enable read-only (AC-OPT-3) */}
      {level === 'datacenter' && (
        <>
          <div className="rounded-lg border border-portal-border bg-portal-bg px-3 py-2 text-xs text-gray-600 dark:text-zinc-400 flex items-center gap-2">
            <span className="font-medium">Globale Firewall:</span>
            {options?.enable ? <span className="text-portal-success font-medium">aktiviert</span> : <span className="text-portal-warn font-medium">deaktiviert</span>}
            <span className="text-gray-400 dark:text-zinc-500">(nur lesbar – das globale Ein-/Ausschalten erfolgt direkt in Proxmox)</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Sel id="dc-pin" label="Default-Policy eingehend" value={form.policy_in} onChange={set('policy_in')} opts={POLICIES} />
            <Sel id="dc-pout" label="Default-Policy ausgehend" value={form.policy_out} onChange={set('policy_out')} opts={POLICIES} />
          </div>
          <div>
            <label className={labelCls} htmlFor="dc-logrl">Log-Ratelimit</label>
            <input id="dc-logrl" type="text" value={form.log_ratelimit} onChange={set('log_ratelimit')} placeholder="enable=1,rate=1/second,burst=5" className={inputCls} />
          </div>
          <Check id="dc-ebt" label="ebtables (Layer-2-Filter)" checked={form.ebtables} onChange={set('ebtables')} />
        </>
      )}

      {/* Node */}
      {level === 'node' && (
        <>
          <Check id="nd-en" label="Firewall auf diesem Node aktiviert" checked={form.enable} onChange={set('enable')} />
          <div className="grid grid-cols-2 gap-4">
            <Sel id="nd-lin" label="Log-Level eingehend" value={form.log_level_in} onChange={set('log_level_in')} opts={LOG_LEVELS} />
            <Sel id="nd-lout" label="Log-Level ausgehend" value={form.log_level_out} onChange={set('log_level_out')} opts={LOG_LEVELS} />
            <Sel id="nd-smurf" label="Smurf-Log-Level" value={form.smurf_log_level} onChange={set('smurf_log_level')} opts={LOG_LEVELS} />
            <Sel id="nd-tcpf" label="TCP-Flags-Log-Level" value={form.tcp_flags_log_level} onChange={set('tcp_flags_log_level')} opts={LOG_LEVELS} />
            <div>
              <label className={labelCls} htmlFor="nd-ctmax">nf_conntrack_max</label>
              <input id="nd-ctmax" type="number" min="0" value={form.nf_conntrack_max} onChange={set('nf_conntrack_max')} placeholder="z. B. 262144" className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nd-cttmo">nf_conntrack TCP-Timeout (s)</label>
              <input id="nd-cttmo" type="number" min="0" value={form.nf_conntrack_tcp_timeout_established} onChange={set('nf_conntrack_tcp_timeout_established')} placeholder="z. B. 432000" className={inputCls} />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <Check id="nd-ndp" label="NDP" checked={form.ndp} onChange={set('ndp')} />
            <Check id="nd-nosmurf" label="nosmurfs" checked={form.nosmurfs} onChange={set('nosmurfs')} />
          </div>
        </>
      )}

      {/* Guest */}
      {level === 'guest' && (
        <>
          <Check id="g-en" label="Firewall für diesen Gast aktiviert" checked={form.enable} onChange={set('enable')} />
          <div className="grid grid-cols-2 gap-4">
            <Sel id="g-pin" label="Default-Policy eingehend" value={form.policy_in} onChange={set('policy_in')} opts={POLICIES} />
            <Sel id="g-pout" label="Default-Policy ausgehend" value={form.policy_out} onChange={set('policy_out')} opts={POLICIES} />
            <Sel id="g-lin" label="Log-Level eingehend" value={form.log_level_in} onChange={set('log_level_in')} opts={LOG_LEVELS} />
            <Sel id="g-lout" label="Log-Level ausgehend" value={form.log_level_out} onChange={set('log_level_out')} opts={LOG_LEVELS} />
          </div>
          <div className="flex items-center gap-6 flex-wrap">
            <Check id="g-dhcp" label="DHCP" checked={form.dhcp} onChange={set('dhcp')} />
            <Check id="g-macf" label="MAC-Filter" checked={form.macfilter} onChange={set('macfilter')} />
            <Check id="g-ndp" label="NDP" checked={form.ndp} onChange={set('ndp')} />
            <Check id="g-radv" label="Router-Advertisement" checked={form.radv} onChange={set('radv')} />
            <Check id="g-ipf" label="IP-Filter" checked={form.ipfilter} onChange={set('ipfilter')} />
          </div>
        </>
      )}

      {enablingWithDrop && (
        <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-3 py-2 text-xs text-portal-warn">
          ⚠ Achtung: Das Aktivieren der Firewall {level === 'node' ? 'auf diesem Node' : 'für diesen Gast'} kann bei einer
          restriktiven Default-Policy (DROP) eingehenden Verkehr blockieren. Stelle sicher, dass passende Regeln existieren.
        </div>
      )}

      <div className="pt-1">
        <button type="submit" disabled={saving} className="btn-primary">{saving ? '…' : 'Optionen speichern'}</button>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </form>
  )
}
