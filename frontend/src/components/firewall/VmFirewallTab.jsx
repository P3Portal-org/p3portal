// p3portal.org
/**
 * PROJ-90: VM/LXC firewall tab (per guest, AC-UI-2). Sub-tabs: Regeln · Optionen ·
 * IPSets · Aliases. The guest IPSets/aliases are local to the VM/LXC (plain delete,
 * no cluster-wide usage check). `installation` (portal_node_id) only feeds the rule
 * editor's macro + security-group dropdowns.
 *
 * Banners:
 *   AC-STACK-1 — stack-managed VMs are editable here, with a hint that the firewall
 *     can become declarative via PROJ-91 (no mutation block, Entscheidung #6).
 *   PROJ-91 AC-MUT-1 — a stack guest WHOSE firewall is stack-managed (has a
 *     declarative firewall: block) returns HTTP 409 on any mutation. We detect that
 *     reactively (wrap the mutation handlers) and show the "edit via the stack
 *     definition" banner; the read view stays (AC-MUT-3). A stack guest WITHOUT a
 *     firewall block keeps the editable AC-STACK-1 hint (AC-MUT-2).
 *   AC-HINT-1 — global datacenter firewall disabled → rules inert.
 *   AC-HINT-2 — guest has no firewall-enabled NIC (`firewall=1` at some netX). The
 *     `firewall=1` flag is VM config, not exposed by the current detail model, so we
 *     only show the hint when the caller can determine it (`fwNicEnabled === false`).
 *     With the current data this stays hidden — no false positives.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  listGuestRules, createGuestRule, updateGuestRule, moveGuestRule, deleteGuestRule,
  getGuestOptions, updateGuestOptions,
  listGuestIpSets, createGuestIpSet, deleteGuestIpSet, listGuestIpSetEntries, addGuestIpSetEntry, deleteGuestIpSetEntry,
  listGuestAliases, createGuestAlias, updateGuestAlias, deleteGuestAlias,
  listMacros, listRefs, listSecurityGroups, firewallErrMsg,
} from '../../api/firewall'
import FirewallRulesTable from './FirewallRulesTable'
import FirewallOptionsForm from './FirewallOptionsForm'
import IpSetsManager from './IpSetsManager'
import AliasesManager from './AliasesManager'

const SUB_TABS = [
  { id: 'rules', label: 'Regeln' },
  { id: 'options', label: 'Optionen' },
  { id: 'ipsets', label: 'IPSets' },
  { id: 'aliases', label: 'Aliases' },
]
// Guest NIC names as iface suggestions (free-text fallback for the rest).
const VM_IFACE_SUGGESTIONS = ['net0', 'net1', 'net2', 'net3', 'net4', 'net5', 'net6', 'net7']

export default function VmFirewallTab({ vmid, proxmoxNode, installation = null, stackInfo = null, fwNicEnabled = undefined }) {
  const { t } = useTranslation()
  const node = proxmoxNode
  const [sub, setSub] = useState('rules')
  const [rules, setRules] = useState(null)
  const [rulesLoading, setRulesLoading] = useState(false)
  const [options, setOptions] = useState(null)
  const [macros, setMacros] = useState([])
  const [refs, setRefs] = useState([])
  const [groupNames, setGroupNames] = useState([])
  // PROJ-91: stack-managed firewall block (set reactively on a 409 mutation).
  const [stackFwBlocked, setStackFwBlocked] = useState(null) // { stack_id, stack_name }

  // Wrap a mutation: on 409 guest_firewall_managed_by_stack, raise the banner and
  // re-throw (so the sub-component still shows its inline error). The read view is
  // never gated (AC-MUT-3).
  const guardMut = useCallback((fn) => async (...args) => {
    try {
      return await fn(...args)
    } catch (err) {
      const d = err?.response?.data?.detail
      if (err?.response?.status === 409 && d && typeof d === 'object' && d.error === 'guest_firewall_managed_by_stack') {
        setStackFwBlocked({ stack_id: d.stack_id, stack_name: d.stack_name })
      }
      throw err
    }
  }, [])

  const loadRules = useCallback(() => {
    setRulesLoading(true)
    listGuestRules(vmid, node)
      .then(d => setRules(d))
      .catch(err => setRules({ rules: [], node_unreachable: true, detail: firewallErrMsg(err) }))
      .finally(() => setRulesLoading(false))
  }, [vmid, node])

  const loadOptions = useCallback(() => {
    getGuestOptions(vmid, node).then(setOptions).catch(() => setOptions(null))
  }, [vmid, node])

  useEffect(() => {
    loadRules(); loadOptions()
    listMacros(installation).then(d => setMacros(Array.isArray(d) ? d : [])).catch(() => setMacros([]))
    listRefs(installation).then(d => setRefs(Array.isArray(d) ? d : [])).catch(() => setRefs([]))
    listSecurityGroups(installation).then(d => setGroupNames((d?.items ?? []).map(g => g.group))).catch(() => setGroupNames([]))
  }, [loadRules, loadOptions, installation])

  const rulesApi = useMemo(() => ({
    create: guardMut((p) => createGuestRule(vmid, p, node)),
    update: guardMut((pos, p) => updateGuestRule(vmid, pos, p, node)),
    move: guardMut((pos, mv) => moveGuestRule(vmid, pos, mv, node)),
    del: guardMut((pos) => deleteGuestRule(vmid, pos, node)),
  }), [vmid, node, guardMut])

  const ipsetApi = useMemo(() => ({
    listIpSets: () => listGuestIpSets(vmid, node),
    createIpSet: guardMut((p) => createGuestIpSet(vmid, p, node)),
    deleteIpSet: guardMut((n) => deleteGuestIpSet(vmid, n, node)),
    listEntries: (n) => listGuestIpSetEntries(vmid, n, node),
    addEntry: guardMut((n, p) => addGuestIpSetEntry(vmid, n, p, node)),
    deleteEntry: guardMut((n, cidr) => deleteGuestIpSetEntry(vmid, n, cidr, node)),
    // no usageCheck → per-guest IPSets use a plain confirm
  }), [vmid, node, guardMut])

  const aliasApi = useMemo(() => ({
    listAliases: () => listGuestAliases(vmid, node),
    createAlias: guardMut((p) => createGuestAlias(vmid, p, node)),
    updateAlias: guardMut((n, p) => updateGuestAlias(vmid, n, p, node)),
    deleteAlias: guardMut((n) => deleteGuestAlias(vmid, n, node)),
  }), [vmid, node, guardMut])

  const securityGroups = useMemo(() => groupNames.map(n => ({ group: n })), [groupNames])
  const globalDisabled = options && options.global_firewall_enabled === false
  const noFwNic = options?.enable && fwNicEnabled === false

  const subCls = (a) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      a ? 'bg-portal-accent/10 text-portal-accent' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="space-y-4">
      {/* PROJ-91 AC-MUT-1: firewall is stack-managed (declarative) → mutations 409,
          read view stays. Shown reactively once a mutation is rejected. */}
      {stackFwBlocked && (
        <div className="rounded-md border border-portal-warn/40 bg-portal-warn/10 px-4 py-2.5 text-sm text-portal-text flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-portal-warn/20 text-portal-warn">{t('stacks.managed_by.badge')}</span>
          <span>
            Die Firewall dieses Gastes wird vom Stack{' '}
            <Link to={`/stacks/${stackFwBlocked.stack_id}`} className="font-medium text-portal-accent hover:underline">{stackFwBlocked.stack_name}</Link>{' '}
            verwaltet – Änderungen bitte über die Stack-Definition (PROJ-91). Hier nur Lese-Ansicht.
          </span>
        </div>
      )}

      {/* AC-STACK-1: stack-managed VM hint (editable, no firewall block — AC-MUT-2) */}
      {stackInfo && !stackFwBlocked && (
        <div className="rounded-md border border-portal-accent/40 bg-portal-accent/10 px-4 py-2.5 text-sm text-portal-text flex items-center gap-2 flex-wrap">
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-portal-accent/20 text-portal-accent">{t('stacks.managed_by.badge')}</span>
          <span>
            Diese VM gehört zum Stack{' '}
            <Link to={`/stacks/${stackInfo.stack_id}`} className="font-medium text-portal-accent hover:underline">{stackInfo.stack_name}</Link>.
            Die Firewall ist hier editierbar; künftig kann sie deklarativ über Stacks (PROJ-91) verwaltet werden.
          </span>
        </div>
      )}

      {globalDisabled && (
        <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-2.5 text-sm text-portal-warn">
          ⚠ Die globale Datacenter-Firewall ist <strong>deaktiviert</strong> – alle Regeln sind inaktiv.
        </div>
      )}

      {noFwNic && (
        <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-2.5 text-sm text-portal-warn">
          ⚠ Die Firewall ist an keinem Netzwerk-Interface aktiviert (<span className="font-mono">firewall=1</span> an keinem <span className="font-mono">netX</span>) – Regeln greifen nicht.
        </div>
      )}

      <div className="flex items-center gap-1 flex-wrap">
        {SUB_TABS.map(s => (
          <button key={s.id} onClick={() => setSub(s.id)} className={subCls(sub === s.id)}>{s.label}</button>
        ))}
      </div>

      {sub === 'rules' && (
        <FirewallRulesTable
          rulesData={rules}
          loading={rulesLoading}
          rulesApi={rulesApi}
          macros={macros}
          securityGroups={securityGroups}
          refs={refs}
          withIface={true}
          ifaceOptions={VM_IFACE_SUGGESTIONS}
          onChanged={loadRules}
          emptyHint="Keine Firewall-Regeln für diesen Gast."
        />
      )}
      {sub === 'options' && (
        options
          ? <FirewallOptionsForm level="guest" options={options} onSave={guardMut((p) => updateGuestOptions(vmid, p, node))} onChanged={loadOptions} />
          : <p className="text-sm text-gray-400 dark:text-zinc-500 py-6">Gast-Firewall-Optionen konnten nicht geladen werden.</p>
      )}
      {sub === 'ipsets'  && <IpSetsManager api={ipsetApi} title="IPSets (Gast)" />}
      {sub === 'aliases' && <AliasesManager api={aliasApi} title="Aliases (Gast)" />}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
