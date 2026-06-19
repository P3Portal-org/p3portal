// p3portal.org
/**
 * PROJ-90: Datacenter firewall panel (cluster-wide, per installation).
 * Sub-tabs: Regeln · Optionen · Security-Groups · IPSets · Aliases.
 * Loads macros + security-group names once for the rule editor dropdowns and the
 * DC options for the global-enable banner (AC-HINT-1). All CRUD is bound to the
 * selected installation (portal_node_id). Live-apply — no pending/reload.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  listDcRules, createDcRule, updateDcRule, moveDcRule, deleteDcRule,
  getDcOptions, updateDcOptions,
  listSecurityGroups, createSecurityGroup, deleteSecurityGroup,
  listGroupRules, createGroupRule, updateGroupRule, moveGroupRule, deleteGroupRule,
  listIpSets, createIpSet, deleteIpSet, listIpSetEntries, addIpSetEntry, deleteIpSetEntry,
  listAliases, createAlias, updateAlias, deleteAlias,
  listMacros, listRefs, checkUsage, firewallErrMsg,
} from '../../api/firewall'
import FirewallRulesTable from './FirewallRulesTable'
import FirewallOptionsForm from './FirewallOptionsForm'
import SecurityGroupsManager from './SecurityGroupsManager'
import IpSetsManager from './IpSetsManager'
import AliasesManager from './AliasesManager'

const SUB_TABS = [
  { id: 'rules', label: 'Regeln' },
  { id: 'options', label: 'Optionen' },
  { id: 'groups', label: 'Security-Groups' },
  { id: 'ipsets', label: 'IPSets' },
  { id: 'aliases', label: 'Aliases' },
]
// Common host bridges as iface suggestions (free-text fallback for the rest).
const HOST_IFACE_SUGGESTIONS = ['vmbr0', 'vmbr1', 'vmbr2', 'vmbr3']

export default function DatacenterFirewallPanel({ installation = null }) {
  const [sub, setSub] = useState('rules')
  const [rules, setRules] = useState(null)
  const [rulesLoading, setRulesLoading] = useState(false)
  const [options, setOptions] = useState(null)
  const [macros, setMacros] = useState([])
  const [refs, setRefs] = useState([])
  const [groupNames, setGroupNames] = useState([])

  const loadRules = useCallback(() => {
    setRulesLoading(true)
    listDcRules(installation)
      .then(d => setRules(d))
      .catch(err => setRules({ rules: [], node_unreachable: true, detail: firewallErrMsg(err) }))
      .finally(() => setRulesLoading(false))
  }, [installation])

  const loadOptions = useCallback(() => {
    getDcOptions(installation).then(setOptions).catch(() => setOptions(null))
  }, [installation])

  // Macros + refs (aliases/ipsets) + SG names for the rule editor dropdowns (best-effort).
  useEffect(() => {
    listMacros(installation).then(d => setMacros(Array.isArray(d) ? d : [])).catch(() => setMacros([]))
    listRefs(installation).then(d => setRefs(Array.isArray(d) ? d : [])).catch(() => setRefs([]))
    listSecurityGroups(installation).then(d => setGroupNames((d?.items ?? []).map(g => g.group))).catch(() => setGroupNames([]))
  }, [installation])

  useEffect(() => { loadRules(); loadOptions() }, [loadRules, loadOptions])

  const rulesApi = useMemo(() => ({
    create: (p) => createDcRule(p, installation),
    update: (pos, p) => updateDcRule(pos, p, installation),
    move: (pos, mv) => moveDcRule(pos, mv, installation),
    del: (pos) => deleteDcRule(pos, installation),
  }), [installation])

  const sgApi = useMemo(() => ({
    listGroups: () => listSecurityGroups(installation),
    createGroup: (p) => createSecurityGroup(p, installation),
    deleteGroup: (g) => deleteSecurityGroup(g, installation),
    listGroupRules: (g) => listGroupRules(g, installation),
    createGroupRule: (g, p) => createGroupRule(g, p, installation),
    updateGroupRule: (g, pos, p) => updateGroupRule(g, pos, p, installation),
    moveGroupRule: (g, pos, mv) => moveGroupRule(g, pos, mv, installation),
    deleteGroupRule: (g, pos) => deleteGroupRule(g, pos, installation),
    usageCheck: (kind, name) => checkUsage(kind, name, installation),
  }), [installation])

  const ipsetApi = useMemo(() => ({
    listIpSets: () => listIpSets(installation),
    createIpSet: (p) => createIpSet(p, installation),
    deleteIpSet: (n) => deleteIpSet(n, installation),
    listEntries: (n) => listIpSetEntries(n, installation),
    addEntry: (n, p) => addIpSetEntry(n, p, installation),
    deleteEntry: (n, cidr) => deleteIpSetEntry(n, cidr, installation),
    usageCheck: (kind, name) => checkUsage(kind, name, installation),
  }), [installation])

  const aliasApi = useMemo(() => ({
    listAliases: () => listAliases(installation),
    createAlias: (p) => createAlias(p, installation),
    updateAlias: (n, p) => updateAlias(n, p, installation),
    deleteAlias: (n) => deleteAlias(n, installation),
    usageCheck: (kind, name) => checkUsage(kind, name, installation),
  }), [installation])

  const securityGroups = useMemo(() => groupNames.map(n => ({ group: n })), [groupNames])
  const globalDisabled = options && options.enable === false

  const subCls = (active) =>
    `px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      active ? 'bg-portal-accent/10 text-portal-accent' : 'text-gray-500 dark:text-zinc-400 hover:text-gray-700 dark:hover:text-zinc-200'
    }`

  return (
    <div className="space-y-4">
      {globalDisabled && (
        <div className="rounded-lg border border-portal-warn/30 bg-portal-warn/10 px-4 py-2.5 text-sm text-portal-warn">
          ⚠ Die globale Datacenter-Firewall ist <strong>deaktiviert</strong> – alle Regeln sind inaktiv.
          Das globale Aktivieren erfolgt direkt in Proxmox.
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
          ifaceOptions={HOST_IFACE_SUGGESTIONS}
          onChanged={loadRules}
          emptyHint="Keine Datacenter-Firewall-Regeln."
        />
      )}
      {sub === 'options' && (
        options
          ? <FirewallOptionsForm level="datacenter" options={options} onSave={(p) => updateDcOptions(p, installation)} onChanged={loadOptions} />
          : <p className="text-sm text-gray-400 dark:text-zinc-500 py-6">Optionen konnten nicht geladen werden.</p>
      )}
      {sub === 'groups'  && <SecurityGroupsManager api={sgApi} macros={macros} refs={refs} groupNames={groupNames} />}
      {sub === 'ipsets'  && <IpSetsManager api={ipsetApi} title="IPSets (Datacenter)" />}
      {sub === 'aliases' && <AliasesManager api={aliasApi} title="Aliases (Datacenter)" />}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
