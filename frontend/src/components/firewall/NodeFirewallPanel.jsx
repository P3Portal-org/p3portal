// p3portal.org
/**
 * PROJ-90: Node firewall panel (per host). Sub-tabs: Regeln · Optionen.
 * Shared between the sidebar "Firewall" area (Node) and an optional PROJ-40
 * Compute-Node tab (AC-UI-3, no logic duplication — Muster ComputeNetworkTab).
 * `installation` (the node's portal_node_id) only feeds the rule editor's macro +
 * security-group dropdowns (DC objects are cluster-wide per installation).
 * AC-HINT-1: the options carry `global_firewall_enabled` → inert banner.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  listNodeRules, createNodeRule, updateNodeRule, moveNodeRule, deleteNodeRule,
  getNodeOptions, updateNodeOptions,
  listMacros, listRefs, listSecurityGroups, firewallErrMsg,
} from '../../api/firewall'
import FirewallRulesTable from './FirewallRulesTable'
import FirewallOptionsForm from './FirewallOptionsForm'

// Common host bridges as iface suggestions (free-text fallback for the rest).
const HOST_IFACE_SUGGESTIONS = ['vmbr0', 'vmbr1', 'vmbr2', 'vmbr3']

export default function NodeFirewallPanel({ nodeName, installation = null, active = true }) {
  const [sub, setSub] = useState('rules')
  const [rules, setRules] = useState(null)
  const [rulesLoading, setRulesLoading] = useState(false)
  const [options, setOptions] = useState(null)
  const [macros, setMacros] = useState([])
  const [refs, setRefs] = useState([])
  const [groupNames, setGroupNames] = useState([])

  const loadRules = useCallback(() => {
    if (!nodeName) return
    setRulesLoading(true)
    listNodeRules(nodeName)
      .then(d => setRules(d))
      .catch(err => setRules({ rules: [], node_unreachable: true, detail: firewallErrMsg(err) }))
      .finally(() => setRulesLoading(false))
  }, [nodeName])

  const loadOptions = useCallback(() => {
    if (!nodeName) return
    getNodeOptions(nodeName).then(setOptions).catch(() => setOptions(null))
  }, [nodeName])

  useEffect(() => {
    if (!active) return
    loadRules(); loadOptions()
    listMacros(installation).then(d => setMacros(Array.isArray(d) ? d : [])).catch(() => setMacros([]))
    listRefs(installation).then(d => setRefs(Array.isArray(d) ? d : [])).catch(() => setRefs([]))
    listSecurityGroups(installation).then(d => setGroupNames((d?.items ?? []).map(g => g.group))).catch(() => setGroupNames([]))
  }, [active, loadRules, loadOptions, installation])

  // Reset when the node changes.
  useEffect(() => { setRules(null); setOptions(null); setSub('rules') }, [nodeName])

  const rulesApi = useMemo(() => ({
    create: (p) => createNodeRule(nodeName, p),
    update: (pos, p) => updateNodeRule(nodeName, pos, p),
    move: (pos, mv) => moveNodeRule(nodeName, pos, mv),
    del: (pos) => deleteNodeRule(nodeName, pos),
  }), [nodeName])

  const securityGroups = useMemo(() => groupNames.map(n => ({ group: n })), [groupNames])
  const globalDisabled = options && options.global_firewall_enabled === false

  const subCls = (a) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      a ? 'bg-portal-accent/10 text-portal-accent' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="space-y-4">
      {globalDisabled && (
        <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-2.5 text-sm text-portal-warn">
          ⚠ Die globale Datacenter-Firewall ist <strong>deaktiviert</strong> – Node-Regeln greifen erst, wenn sie in Proxmox aktiviert ist.
        </div>
      )}
      <div className="flex items-center gap-1">
        <button onClick={() => setSub('rules')} className={subCls(sub === 'rules')}>Regeln</button>
        <button onClick={() => setSub('options')} className={subCls(sub === 'options')}>Optionen</button>
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
          ifaceOptions={HOST_IFACE_SUGGESTIONS}
          onChanged={loadRules}
          emptyHint="Keine Node-Firewall-Regeln."
        />
      )}
      {sub === 'options' && (
        options
          ? <FirewallOptionsForm level="node" options={options} onSave={(p) => updateNodeOptions(nodeName, p)} onChanged={loadOptions} />
          : <p className="text-sm text-gray-400 dark:text-zinc-500 py-6">Node-Optionen konnten nicht geladen werden.</p>
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
