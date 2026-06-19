// p3portal.org
/**
 * PROJ-90: Security-group manager (datacenter-global, AC-SG-*). Lists groups,
 * creates them (name + comment, 409 on collision), deletes with a cluster-wide
 * usage check, and expands a group to manage its rules via the shared
 * FirewallRulesTable (group rules have no `iface`). All scope-bound CRUD is
 * passed in already bound to the selected installation.
 */
import { useState, useEffect, useCallback } from 'react'
import { firewallErrMsg } from '../../api/firewall'
import FirewallRulesTable from './FirewallRulesTable'
import FirewallUsageConfirmModal from './FirewallUsageConfirmModal'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent rounded'

function CreateGroupModal({ onCreate, onClose, onSuccess }) {
  const [group, setGroup] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await onCreate({ group: group.trim(), comment: comment.trim() || undefined })
      onSuccess?.(); onClose()
    } catch (err) { setError(firewallErrMsg(err)); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">Security-Group anlegen</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          {error && <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1" htmlFor="sg-name">Name <span className="text-portal-danger">*</span></label>
            <input id="sg-name" type="text" value={group} onChange={e => setGroup(e.target.value)} placeholder="z. B. webservers" className={inputCls} />
            <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1">Buchstabe zuerst, danach Buchstaben/Ziffern/-/_.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1" htmlFor="sg-comment">Kommentar (optional)</label>
            <input id="sg-comment" type="text" value={comment} onChange={e => setComment(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Abbrechen</button>
          <button type="submit" disabled={saving || !group.trim()} className="btn-primary">{saving ? '…' : 'Anlegen'}</button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </form>
    </div>
  )
}

export default function SecurityGroupsManager({ api, macros = [], refs = [], groupNames = [] }) {
  const [data, setData]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteGroup, setDeleteGroup] = useState(null)
  const [expanded, setExpanded] = useState(null)         // group name whose rules are open
  const [groupRules, setGroupRules] = useState(null)
  const [groupRulesLoading, setGroupRulesLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.listGroups()
      .then(d => setData(d))
      .catch(err => setData({ items: [], node_unreachable: true, detail: firewallErrMsg(err) }))
      .finally(() => setLoading(false))
  }, [api])

  useEffect(() => { load() }, [load])

  const loadGroupRules = useCallback((group) => {
    setGroupRulesLoading(true)
    api.listGroupRules(group)
      .then(d => setGroupRules(d))
      .catch(err => setGroupRules({ rules: [], node_unreachable: true, detail: firewallErrMsg(err) }))
      .finally(() => setGroupRulesLoading(false))
  }, [api])

  const toggleExpand = (group) => {
    if (expanded === group) { setExpanded(null); setGroupRules(null); return }
    setExpanded(group); setGroupRules(null); loadGroupRules(group)
  }

  const items = data?.items ?? []

  // Scope-bound rules API for the currently expanded group (passed to the table).
  const groupRulesApi = expanded ? {
    create: (payload) => api.createGroupRule(expanded, payload),
    update: (pos, payload) => api.updateGroupRule(expanded, pos, payload),
    move: (pos, moveto) => api.moveGroupRule(expanded, pos, moveto),
    del: (pos) => api.deleteGroupRule(expanded, pos),
  } : null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
          Security-Groups <span className="text-gray-400 dark:text-zinc-600">({items.length})</span>
        </h3>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">+ Security-Group anlegen</button>
      </div>

      {data?.permission_denied ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 py-4">Kein Leserecht auf Security-Groups.</p>
      ) : loading && !data ? (
        <div className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 py-4">Keine Security-Groups.</p>
      ) : (
        <div className="space-y-2">
          {items.map(g => (
            <div key={g.group} className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-zinc-800/40">
                <button onClick={() => toggleExpand(g.group)} className="flex items-center gap-2 text-sm font-mono font-medium text-gray-800 dark:text-zinc-200 min-w-0">
                  <span className="text-gray-400">{expanded === g.group ? '▾' : '▸'}</span>
                  <span className="truncate">{g.group}</span>
                  {g.comment && <span className="text-[11px] text-gray-400 dark:text-zinc-500 font-sans truncate">– {g.comment}</span>}
                </button>
                <button onClick={() => setDeleteGroup(g.group)} className="btn-table-danger shrink-0">Löschen</button>
              </div>
              {expanded === g.group && (
                <div className="px-3 py-3 border-t border-gray-100 dark:border-zinc-800">
                  <FirewallRulesTable
                    rulesData={groupRules}
                    loading={groupRulesLoading}
                    rulesApi={groupRulesApi}
                    macros={macros}
                    securityGroups={groupNames.map(n => ({ group: n }))}
                    refs={refs}
                    withIface={false}
                    onChanged={() => loadGroupRules(g.group)}
                    emptyHint="Diese Security-Group enthält noch keine Regeln (zulässig)."
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateGroupModal onCreate={api.createGroup} onClose={() => setShowCreate(false)} onSuccess={load} />
      )}
      {deleteGroup && (
        <FirewallUsageConfirmModal
          kind="group"
          name={deleteGroup}
          usageCheck={() => api.usageCheck('group', deleteGroup)}
          onDelete={() => api.deleteGroup(deleteGroup)}
          onClose={() => setDeleteGroup(null)}
          onSuccess={() => { setExpanded(null); setGroupRules(null); load() }}
        />
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
