// p3portal.org
/**
 * PROJ-90: Firewall rules table (used at all levels: datacenter, node, security
 * group, VM/LXC). Lists rules in evaluation order (position = filter precedence),
 * reorders them via Proxmox-native `moveto` (up/down), toggles enable, edits and
 * deletes. The scope-bound CRUD comes in via `rulesApi`; the editor dropdowns
 * (macros / security groups) are passed through. Live-apply – no pending/reload.
 */
import { useState } from 'react'
import { firewallErrMsg } from '../../api/firewall'
import FirewallRuleFormModal from './FirewallRuleFormModal'
import ConfirmModal from '../common/ConfirmModal'

function thCls() {
  return 'px-3 py-2 text-left text-[10px] font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider'
}

function ruleToPayload(rule) {
  // Map a read rule back to a write payload (for enable-toggle without re-editing).
  const p = { type: rule.type, action: rule.action, enable: rule.enable }
  for (const f of ['macro', 'source', 'dest', 'proto', 'sport', 'dport', 'iface', 'log', 'icmp_type']) {
    if (rule[f]) p[f] = rule[f]
  }
  p.comment = rule.comment ?? ''
  return p
}

function ActionBadge({ rule }) {
  const t = rule.type
  const txt = t === 'group' ? `→ ${rule.action}` : rule.action
  const cls = t === 'group'
    ? 'bg-portal-info/10 text-portal-info'
    : rule.action === 'ACCEPT' ? 'bg-portal-success/10 text-portal-success'
      : rule.action === 'DROP' ? 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400'
        : 'bg-portal-danger/10 text-portal-danger'
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium font-mono ${cls}`}>{txt}</span>
}

function protoCell(rule) {
  if (rule.macro) return `macro:${rule.macro}`
  const bits = []
  if (rule.proto) bits.push(rule.proto)
  if (rule.dport) bits.push(`→${rule.dport}`)
  if (rule.sport) bits.push(`(${rule.sport})`)
  return bits.length ? bits.join(' ') : '–'
}

export default function FirewallRulesTable({
  rulesData,
  loading,
  rulesApi,
  macros = [],
  securityGroups = [],
  refs = [],
  withIface = true,
  ifaceOptions = [],
  onChanged,
  emptyHint = 'Keine Firewall-Regeln auf dieser Ebene.',
}) {
  const [query, setQuery] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyPos, setBusyPos] = useState(null)
  const [ruleModal, setRuleModal] = useState(undefined) // undefined=closed, null=create, object=edit
  const [deleteRule, setDeleteRule] = useState(null)

  if (loading && !rulesData) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => <div key={i} className="h-9 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />)}
      </div>
    )
  }

  if (rulesData?.node_unreachable) {
    return (
      <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
        Nicht erreichbar – Firewall-Regeln konnten nicht geladen werden.
        {rulesData.detail && <span className="block mt-1 text-xs text-portal-warn/90">Ursache: {rulesData.detail}</span>}
      </div>
    )
  }

  if (rulesData?.permission_denied) {
    return (
      <div className="rounded-lg border border-portal-border bg-portal-bg px-4 py-6 text-center">
        <p className="text-sm font-medium text-portal-text">Kein Zugriff in Proxmox</p>
        <p className="mt-1 text-xs text-gray-400 dark:text-zinc-500">
          Der konfigurierte Token hat kein Leserecht auf die Firewall-Regeln (Sys.Audit / VM.Audit).
        </p>
      </div>
    )
  }

  const rules = rulesData?.rules ?? []
  const count = rules.length
  const q = query.trim().toLowerCase()
  const filtered = rules.filter(r =>
    !q ||
    (r.source || '').toLowerCase().includes(q) ||
    (r.dest || '').toLowerCase().includes(q) ||
    (r.comment || '').toLowerCase().includes(q) ||
    (r.action || '').toLowerCase().includes(q) ||
    (r.macro || '').toLowerCase().includes(q),
  )

  const runAction = async (fn, pos) => {
    setActionError('')
    setBusyPos(pos)
    try {
      await fn()
      onChanged?.()
    } catch (err) {
      setActionError(firewallErrMsg(err))
    } finally {
      setBusyPos(null)
    }
  }

  const move = (rule, dir) => {
    const target = dir === 'up' ? rule.pos - 1 : rule.pos + 1
    if (target < 0 || target >= count) return
    runAction(() => rulesApi.move(rule.pos, target), rule.pos)
  }
  const toggle = (rule) =>
    runAction(() => rulesApi.update(rule.pos, { ...ruleToPayload(rule), enable: !rule.enable }), rule.pos)

  const handleDelete = async () => {
    try {
      await rulesApi.del(deleteRule.pos)
      onChanged?.()
    } catch (err) {
      throw new Error(firewallErrMsg(err))
    }
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Suche Quelle / Ziel / Kommentar…"
          className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent w-56"
        />
        <button onClick={() => { setActionError(''); setRuleModal(null) }} className="btn-primary text-xs shrink-0">
          + Regel anlegen
        </button>
      </div>

      {actionError && (
        <div className="rounded-lg border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger">
          {actionError}
          <button onClick={() => setActionError('')} className="ml-2 underline text-xs">Schließen</button>
        </div>
      )}

      {count === 0 ? (
        <div className="py-10 text-center text-sm text-gray-400 dark:text-zinc-500">{emptyHint}</div>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="bg-gray-50 dark:bg-zinc-800/60 border-b border-gray-200 dark:border-zinc-700">
                  <th className={thCls()}>#</th>
                  <th className={thCls()}>Richtung</th>
                  <th className={thCls()}>Aktion</th>
                  <th className={thCls()}>Quelle</th>
                  <th className={thCls()}>Ziel</th>
                  <th className={thCls()}>Proto / Port</th>
                  <th className={thCls()}>Aktiv</th>
                  <th className={thCls()}>Kommentar</th>
                  <th className={`${thCls()} text-right`}>Aktionen</th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
                {filtered.map(r => (
                  <tr key={r.pos} className={`hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors ${r.enable === false ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-2 text-[11px] text-gray-400 dark:text-zinc-500 tabular-nums">{r.pos}</td>
                    <td className="px-3 py-2 text-[11px] text-gray-600 dark:text-zinc-300">{r.type}</td>
                    <td className="px-3 py-2"><ActionBadge rule={r} /></td>
                    <td className="px-3 py-2 text-[11px] text-gray-600 dark:text-zinc-300 font-mono max-w-[140px] truncate" title={r.source || ''}>{r.source || '–'}</td>
                    <td className="px-3 py-2 text-[11px] text-gray-600 dark:text-zinc-300 font-mono max-w-[140px] truncate" title={r.dest || ''}>{r.dest || '–'}</td>
                    <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-zinc-400 font-mono">{protoCell(r)}</td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => toggle(r)}
                        disabled={busyPos === r.pos}
                        className="text-sm disabled:opacity-40"
                        title={r.enable ? 'Deaktivieren' : 'Aktivieren'}
                      >
                        {r.enable ? <span className="text-portal-success">✓</span> : <span className="text-gray-300 dark:text-zinc-600">○</span>}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-zinc-400 max-w-[160px] truncate" title={r.comment || ''}>{r.comment || '–'}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => move(r, 'up')} disabled={busyPos === r.pos || r.pos === 0} className="btn-table" title="Nach oben">↑</button>
                        <button onClick={() => move(r, 'down')} disabled={busyPos === r.pos || r.pos === count - 1} className="btn-table" title="Nach unten">↓</button>
                        <button onClick={() => { setActionError(''); setRuleModal(r) }} disabled={busyPos === r.pos} className="btn-table" title="Bearbeiten">Bearbeiten</button>
                        <button onClick={() => { setActionError(''); setDeleteRule(r) }} disabled={busyPos === r.pos} className="btn-table-danger" title="Löschen">Löschen</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-gray-400 dark:text-zinc-500">Keine Treffer für die Suche.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ruleModal !== undefined && (
        <FirewallRuleFormModal
          rule={ruleModal}
          rulesApi={rulesApi}
          macros={macros}
          securityGroups={securityGroups}
          refs={refs}
          withIface={withIface}
          ifaceOptions={ifaceOptions}
          ruleCount={count}
          onClose={() => setRuleModal(undefined)}
          onSuccess={onChanged}
        />
      )}

      {deleteRule && (
        <ConfirmModal
          title={`Regel löschen – Pos. ${deleteRule.pos}`}
          body="Diese Firewall-Regel wird sofort entfernt (Live-Apply). Vorgang kann nicht rückgängig gemacht werden."
          confirmLabel="Löschen"
          variant="danger"
          onConfirm={handleDelete}
          onClose={() => setDeleteRule(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
