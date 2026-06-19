// p3portal.org
/**
 * PROJ-90: Create / fully edit a firewall rule (any level – datacenter, node,
 * security group, VM/LXC). The same editor serves all levels; the scope-bound
 * CRUD lives in `rulesApi` ({ create(payload), update(pos, payload) }).
 *
 * Macro and explicit proto/ports are mutually exclusive (EC-4) → a "Modus" toggle
 * picks one. type=group rules choose a security group as their action (AC-RULE-1);
 * in/out rules pick ACCEPT/DROP/REJECT. Position can be chosen on create (AC-RULE-3);
 * reordering an existing rule uses the dedicated move action in the table, not here.
 * Rules apply live (no pending/apply).
 */
import { useState } from 'react'
import { firewallErrMsg } from '../../api/firewall'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'
const smallCls = 'text-[11px] text-gray-400 dark:text-zinc-500 mt-1'

const LOG_LEVELS = ['nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']
// Common IP protocols for the proto dropdown (free-text fallback for the rest).
const PROTO_OPTIONS = ['tcp', 'udp', 'icmp', 'icmpv6', 'igmp', 'gre', 'esp', 'ah', 'sctp']
// ICMP types shown (instead of ports) when proto is icmp/icmpv6, like Proxmox.
const ICMP_TYPES = ['echo-request', 'echo-reply', 'destination-unreachable', 'time-exceeded', 'redirect', 'parameter-problem']
const CUSTOM = '__custom__'

// Dropdown with a curated option list + an "Eigener Wert…" escape to free text
// (the established SdnZoneFormModal bridge-picker pattern). Empty options → plain
// text input (so callers can opt out without a dropdown).
function ComboField({ id, value, onChange, options, placeholder, emptyLabel = '– wählen –' }) {
  const [custom, setCustom] = useState(
    () => options.length > 0 && value !== '' && !options.includes(value),
  )
  if (options.length === 0) {
    return <input id={id} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
  }
  if (custom) {
    return (
      <div className="flex gap-2">
        <input id={id} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
        <button type="button" onClick={() => { setCustom(false); onChange('') }} className="btn-secondary text-xs shrink-0">Liste</button>
      </div>
    )
  }
  return (
    <select
      id={id}
      value={options.includes(value) ? value : ''}
      onChange={e => { if (e.target.value === CUSTOM) { setCustom(true); onChange('') } else onChange(e.target.value) }}
      className={inputCls}
    >
      <option value="">{emptyLabel}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value={CUSTOM}>Eigener Wert…</option>
    </select>
  )
}

// Source / destination field (Proxmox-like): a free-text input for raw IP/CIDR/
// range (the common case) PLUS a dropdown to insert an existing Alias / IPSet
// reference (from /datacenter/refs), grouped by type. An alias inserts its bare
// name, an IPSet inserts "+name" — both accepted by the server's address parser.
function AddrField({ id, value, onChange, refs, placeholder, hint }) {
  const aliasRefs = refs.filter(r => r.type === 'alias')
  const ipsetRefs = refs.filter(r => r.type === 'ipset')
  const tokenOf = (r) => (r.type === 'ipset' ? `+${r.name}` : r.name)
  return (
    <>
      <input id={id} type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      {refs.length > 0 && (
        <select
          aria-label="Alias oder IPSet einsetzen"
          value=""
          onChange={e => { if (e.target.value) onChange(e.target.value) }}
          className="mt-1 w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-600 dark:text-zinc-400 px-2 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent"
        >
          <option value="">＋ Alias / IPSet einsetzen…</option>
          {aliasRefs.length > 0 && (
            <optgroup label="Aliases">
              {aliasRefs.map(r => <option key={`a-${r.name}`} value={tokenOf(r)}>{r.name}{r.comment ? ` – ${r.comment}` : ''}</option>)}
            </optgroup>
          )}
          {ipsetRefs.length > 0 && (
            <optgroup label="IPSets">
              {ipsetRefs.map(r => <option key={`i-${r.name}`} value={tokenOf(r)}>+{r.name}{r.comment ? ` – ${r.comment}` : ''}</option>)}
            </optgroup>
          )}
        </select>
      )}
      {hint && <p className={smallCls}>{hint}</p>}
    </>
  )
}

function buildInitial(rule) {
  if (!rule) {
    return {
      type: 'in', action: 'ACCEPT', group: '', enable: true,
      protoMode: 'custom', macro: '', proto: '', sport: '', dport: '', icmp_type: '',
      source: '', dest: '', iface: '', log: '', comment: '',
      posMode: 'end', posValue: '',
    }
  }
  const isGroup = rule.type === 'group'
  return {
    type: rule.type || 'in',
    action: isGroup ? 'ACCEPT' : (rule.action || 'ACCEPT'),
    group: isGroup ? (rule.action || '') : '',
    enable: rule.enable !== false,
    protoMode: rule.macro ? 'macro' : 'custom',
    macro: rule.macro || '',
    proto: rule.proto || '',
    sport: rule.sport || '',
    dport: rule.dport || '',
    icmp_type: rule.icmp_type || '',
    source: rule.source || '',
    dest: rule.dest || '',
    iface: rule.iface || '',
    log: rule.log || '',
    comment: rule.comment || '',
    posMode: 'end', posValue: '',
  }
}

function buildPayload(form, { isEdit }) {
  const payload = {
    type: form.type,
    enable: form.enable,
  }
  // action depends on direction (in/out → ACCEPT/DROP/REJECT, group → SG name)
  payload.action = form.type === 'group' ? form.group.trim() : form.action
  if (form.protoMode === 'macro') {
    if (form.macro.trim()) payload.macro = form.macro.trim()
  } else {
    if (form.proto.trim()) payload.proto = form.proto.trim()
    if (form.sport.trim()) payload.sport = form.sport.trim()
    if (form.dport.trim()) payload.dport = form.dport.trim()
    // ICMP type only applies to icmp / icmpv6 protocols
    if (form.icmp_type.trim() && /^icmp/i.test(form.proto.trim())) payload.icmp_type = form.icmp_type.trim()
  }
  if (form.source.trim()) payload.source = form.source.trim()
  if (form.dest.trim())   payload.dest = form.dest.trim()
  if (form.iface.trim())  payload.iface = form.iface.trim()
  if (form.log)           payload.log = form.log
  // comment: send '' so it can be cleared on edit; on create only when non-empty
  if (form.comment.trim() || isEdit) payload.comment = form.comment
  // position (create only)
  if (!isEdit && form.posMode === 'start') payload.pos = 0
  if (!isEdit && form.posMode === 'custom' && form.posValue !== '') payload.pos = parseInt(form.posValue, 10)
  return payload
}

export default function FirewallRuleFormModal({
  rule,
  rulesApi,
  macros = [],
  securityGroups = [],
  refs = [],
  withIface = true,
  ifaceOptions = [],
  ruleCount = 0,
  onClose,
  onSuccess,
}) {
  const isEdit = Boolean(rule)
  const [form, setForm]   = useState(() => buildInitial(rule))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setForm(prev => ({ ...prev, [key]: v }))
  }
  const setVal = (key) => (v) => setForm(prev => ({ ...prev, [key]: v }))
  const isIcmp = /^icmp/i.test(form.proto.trim())

  const handleSubmit = async (e) => {
    e.preventDefault()
    // Client-side guard mirroring the server validators (EC-4 / AC-RULE-2)
    if (form.type === 'group' && !form.group.trim()) {
      setError('Bitte eine Security-Group als Aktion wählen.'); return
    }
    setSaving(true)
    setError('')
    try {
      const payload = buildPayload(form, { isEdit })
      if (isEdit) await rulesApi.update(rule.pos, payload)
      else        await rulesApi.create(payload)
      onSuccess?.()
      onClose()
    } catch (err) {
      setError(firewallErrMsg(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div
        className="relative bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 shadow-2xl w-full max-w-2xl rounded-xl flex flex-col max-h-[92vh]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fw-rule-modal-title"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700 shrink-0">
          <h2 id="fw-rule-modal-title" className="text-sm font-semibold text-gray-900 dark:text-white">
            {isEdit ? `Regel bearbeiten – Pos. ${rule.pos}` : 'Firewall-Regel anlegen'}
          </h2>
          <button onClick={onClose} aria-label="Schließen" className="btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form id="fw-rule-form" onSubmit={handleSubmit} className="overflow-y-auto px-5 py-5 space-y-4 flex-1">
          {error && (
            <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>
          )}

          {/* Direction + Action + enable */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="fw-type">Richtung <span className="text-portal-danger">*</span></label>
              <select id="fw-type" value={form.type} onChange={set('type')} className={inputCls}>
                <option value="in">Eingehend (in)</option>
                <option value="out">Ausgehend (out)</option>
                <option value="group">Security-Group (group)</option>
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="fw-action">Aktion <span className="text-portal-danger">*</span></label>
              {form.type === 'group' ? (
                <select id="fw-action" value={form.group} onChange={set('group')} className={inputCls}>
                  <option value="">– Security-Group wählen –</option>
                  {securityGroups.map(g => <option key={g.group} value={g.group}>{g.group}</option>)}
                </select>
              ) : (
                <select id="fw-action" value={form.action} onChange={set('action')} className={inputCls}>
                  <option value="ACCEPT">ACCEPT</option>
                  <option value="DROP">DROP</option>
                  <option value="REJECT">REJECT</option>
                </select>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-zinc-300 cursor-pointer">
            <input type="checkbox" checked={form.enable} onChange={set('enable')} className="rounded border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent" />
            Regel aktiviert
          </label>

          {/* Source / Dest – free text for IP/CIDR + ref dropdown for Alias/IPSet */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="fw-source">Quelle</label>
              <AddrField id="fw-source" value={form.source} onChange={setVal('source')} refs={refs}
                placeholder="10.0.0.0/24 oder IP" hint="IP / CIDR / Bereich – oder Alias/+IPSet aus der Liste (leer = beliebig)." />
            </div>
            <div>
              <label className={labelCls} htmlFor="fw-dest">Ziel</label>
              <AddrField id="fw-dest" value={form.dest} onChange={setVal('dest')} refs={refs}
                placeholder="192.168.1.5 oder CIDR" hint="Wie Quelle (leer = beliebig)." />
            </div>
          </div>

          {/* Protocol definition: Macro XOR proto/ports (EC-4) */}
          {form.type !== 'group' && (
            <div className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3 space-y-3">
              <div className="flex items-center gap-4 text-sm">
                <span className="text-xs font-medium text-gray-500 dark:text-zinc-400">Protokoll-Definition:</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="protoMode" value="custom" checked={form.protoMode === 'custom'} onChange={set('protoMode')} className="text-portal-accent focus:ring-portal-accent" />
                  Eigene Proto/Ports
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="protoMode" value="macro" checked={form.protoMode === 'macro'} onChange={set('protoMode')} className="text-portal-accent focus:ring-portal-accent" />
                  Macro (vordefinierter Dienst)
                </label>
              </div>

              {form.protoMode === 'macro' ? (
                <div>
                  <label className={labelCls} htmlFor="fw-macro">Macro</label>
                  <select id="fw-macro" value={form.macro} onChange={set('macro')} className={inputCls}>
                    <option value="">– Macro wählen –</option>
                    {macros.map(m => <option key={m.macro} value={m.macro}>{m.macro}{m.descr ? ` – ${m.descr}` : ''}</option>)}
                  </select>
                  <p className={smallCls}>Ein Macro definiert Protokoll und Ports bereits selbst (eingebaute Proxmox-Dienste, nur Referenz).</p>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls} htmlFor="fw-proto">Protokoll</label>
                    <ComboField id="fw-proto" value={form.proto} onChange={setVal('proto')} options={PROTO_OPTIONS} placeholder="z. B. tcp" emptyLabel="– Protokoll wählen –" />
                  </div>
                  {isIcmp ? (
                    <div className="col-span-2">
                      <label className={labelCls} htmlFor="fw-icmp">ICMP-Typ</label>
                      <ComboField id="fw-icmp" value={form.icmp_type} onChange={setVal('icmp_type')} options={ICMP_TYPES} placeholder="z. B. echo-request" emptyLabel="– any –" />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className={labelCls} htmlFor="fw-sport">Quell-Port(s)</label>
                        <input id="fw-sport" type="text" value={form.sport} onChange={set('sport')} placeholder="z. B. 1024:65535" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls} htmlFor="fw-dport">Ziel-Port(s)</label>
                        <input id="fw-dport" type="text" value={form.dport} onChange={set('dport')} placeholder="z. B. 443 oder 80,443" className={inputCls} />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* iface (not for SG rules) + log */}
          <div className="grid grid-cols-2 gap-4">
            {withIface && (
              <div>
                <label className={labelCls} htmlFor="fw-iface">Interface (optional)</label>
                <ComboField id="fw-iface" value={form.iface} onChange={setVal('iface')} options={ifaceOptions} placeholder="z. B. net0 / vmbr0" emptyLabel="– Interface wählen –" />
              </div>
            )}
            <div className={withIface ? '' : 'col-span-2'}>
              <label className={labelCls} htmlFor="fw-log">Log-Level (optional)</label>
              <select id="fw-log" value={form.log} onChange={set('log')} className={inputCls}>
                <option value="">– kein Logging –</option>
                {LOG_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          </div>

          {/* Comment */}
          <div>
            <label className={labelCls} htmlFor="fw-comment">Kommentar (optional)</label>
            <input id="fw-comment" type="text" value={form.comment} onChange={set('comment')} placeholder="Wofür ist diese Regel?" className={inputCls} />
          </div>

          {/* Position (create only) */}
          {!isEdit && (
            <div className="rounded-lg border border-gray-200 dark:border-zinc-700 p-3 space-y-2">
              <label className={labelCls}>Position</label>
              <div className="flex items-center gap-4 text-sm flex-wrap">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="posMode" value="end" checked={form.posMode === 'end'} onChange={set('posMode')} className="text-portal-accent focus:ring-portal-accent" />
                  Am Ende anhängen
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="posMode" value="start" checked={form.posMode === 'start'} onChange={set('posMode')} className="text-portal-accent focus:ring-portal-accent" />
                  Am Anfang
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="posMode" value="custom" checked={form.posMode === 'custom'} onChange={set('posMode')} className="text-portal-accent focus:ring-portal-accent" />
                  An Position
                </label>
                {form.posMode === 'custom' && (
                  <input
                    type="number" min="0" max={ruleCount} value={form.posValue} onChange={set('posValue')}
                    placeholder="0" className="w-20 bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-2 py-1 text-sm rounded focus:outline-none focus:border-portal-accent"
                  />
                )}
              </div>
              <p className={smallCls}>Die Reihenfolge bestimmt das Filterverhalten (Auswertung von oben nach unten).</p>
            </div>
          )}
        </form>

        <div className="px-5 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Abbrechen</button>
          <button type="submit" form="fw-rule-form" disabled={saving} className="btn-primary">
            {saving ? '…' : isEdit ? 'Speichern' : 'Regel anlegen'}
          </button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </div>
  )
}
