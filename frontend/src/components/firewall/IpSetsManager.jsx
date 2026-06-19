// p3portal.org
/**
 * PROJ-90: IPSet manager (AC-IPSET-*). Reused at two scopes: datacenter-global
 * (with a cluster-wide usage check) and per-guest local (plain confirm). Lists
 * IPSets, creates them (name + comment, 409 on collision), deletes them, and
 * expands one to manage its IP/CIDR entries (optional `nomatch`, comment). All
 * scope-bound CRUD is injected via `api`; `usageCheck` is optional (DC only).
 */
import { useState, useEffect, useCallback } from 'react'
import { firewallErrMsg } from '../../api/firewall'
import FirewallUsageConfirmModal from './FirewallUsageConfirmModal'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent rounded'

function CreateIpSetModal({ onCreate, onClose, onSuccess }) {
  const [name, setName] = useState('')
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError('')
    try { await onCreate({ name: name.trim(), comment: comment.trim() || undefined }); onSuccess?.(); onClose() }
    catch (err) { setError(firewallErrMsg(err)); setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800"><h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">IPSet anlegen</h2></div>
        <div className="px-6 py-4 space-y-3">
          {error && <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1" htmlFor="ips-name">Name <span className="text-portal-danger">*</span></label>
            <input id="ips-name" type="text" value={name} onChange={e => setName(e.target.value)} placeholder="z. B. trusted" className={inputCls} />
            <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1">Referenzierbar in Regeln als <span className="font-mono">+{name || 'name'}</span>.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1" htmlFor="ips-comment">Kommentar (optional)</label>
            <input id="ips-comment" type="text" value={comment} onChange={e => setComment(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Abbrechen</button>
          <button type="submit" disabled={saving || !name.trim()} className="btn-primary">{saving ? '…' : 'Anlegen'}</button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </form>
    </div>
  )
}

function EntriesEditor({ name, api, onChanged }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [cidr, setCidr] = useState('')
  const [nomatch, setNomatch] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api.listEntries(name)
      .then(d => setData(d))
      .catch(() => setData({ entries: [] }))
      .finally(() => setLoading(false))
  }, [api, name])
  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api.addEntry(name, { cidr: cidr.trim(), nomatch, comment: comment.trim() || undefined })
      setCidr(''); setNomatch(false); setComment(''); load(); onChanged?.()
    } catch (err) { setError(firewallErrMsg(err)) } finally { setBusy(false) }
  }
  const remove = async (entry) => {
    setBusy(true); setError('')
    try { await api.deleteEntry(name, encodeURIComponent(entry.cidr)); load(); onChanged?.() }
    catch (err) { setError(firewallErrMsg(err)) } finally { setBusy(false) }
  }

  const entries = data?.entries ?? []
  return (
    <div className="space-y-2">
      {error && <div className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>}
      {loading && !data ? (
        <div className="h-8 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
      ) : entries.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-zinc-500">Keine Einträge.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map(e => (
            <li key={e.cidr} className="flex items-center justify-between gap-2 text-xs bg-gray-50 dark:bg-zinc-800/40 rounded px-2 py-1">
              <span className="font-mono text-gray-700 dark:text-zinc-300">
                {e.nomatch && <span className="text-portal-warn mr-1" title="nomatch">!</span>}{e.cidr}
                {e.comment && <span className="ml-2 text-gray-400 dark:text-zinc-500 font-sans">– {e.comment}</span>}
              </span>
              <button onClick={() => remove(e)} disabled={busy} className="btn-table-danger">Entfernen</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex items-end gap-2 flex-wrap pt-1">
        <input type="text" value={cidr} onChange={e => setCidr(e.target.value)} placeholder="10.0.0.0/24" className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-2 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent w-40" />
        <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Kommentar" className="bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-2 py-1.5 text-xs rounded focus:outline-none focus:border-portal-accent w-32" />
        <label className="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-zinc-400 cursor-pointer">
          <input type="checkbox" checked={nomatch} onChange={e => setNomatch(e.target.checked)} className="rounded border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent" />
          nomatch
        </label>
        <button type="submit" disabled={busy || !cidr.trim()} className="btn-primary text-xs">+ Eintrag</button>
      </form>
    </div>
  )
}

export default function IpSetsManager({ api, title = 'IPSets' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [deleteName, setDeleteName] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const hasUsage = typeof api.usageCheck === 'function'

  const load = useCallback(() => {
    setLoading(true)
    api.listIpSets()
      .then(d => setData(d))
      .catch(err => setData({ items: [], node_unreachable: true, detail: firewallErrMsg(err) }))
      .finally(() => setLoading(false))
  }, [api])
  useEffect(() => { load() }, [load])

  const items = data?.items ?? []
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider">
          {title} <span className="text-gray-400 dark:text-zinc-600">({items.length})</span>
        </h3>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs">+ IPSet anlegen</button>
      </div>

      {data?.permission_denied ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 py-4">Kein Leserecht auf IPSets.</p>
      ) : loading && !data ? (
        <div className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 py-4">Keine IPSets.</p>
      ) : (
        <div className="space-y-2">
          {items.map(i => (
            <div key={i.name} className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-zinc-800/40">
                <button onClick={() => setExpanded(expanded === i.name ? null : i.name)} className="flex items-center gap-2 text-sm font-mono font-medium text-gray-800 dark:text-zinc-200 min-w-0">
                  <span className="text-gray-400">{expanded === i.name ? '▾' : '▸'}</span>
                  <span className="truncate">+{i.name}</span>
                  {i.comment && <span className="text-[11px] text-gray-400 dark:text-zinc-500 font-sans truncate">– {i.comment}</span>}
                </button>
                <button onClick={() => setDeleteName(i.name)} className="btn-table-danger shrink-0">Löschen</button>
              </div>
              {expanded === i.name && (
                <div className="px-3 py-3 border-t border-gray-100 dark:border-zinc-800">
                  <EntriesEditor name={i.name} api={api} onChanged={load} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && <CreateIpSetModal onCreate={api.createIpSet} onClose={() => setShowCreate(false)} onSuccess={load} />}
      {deleteName && (
        <FirewallUsageConfirmModal
          kind="ipset"
          name={deleteName}
          usageCheck={hasUsage ? () => api.usageCheck('ipset', deleteName) : undefined}
          onDelete={() => api.deleteIpSet(deleteName)}
          onClose={() => setDeleteName(null)}
          onSuccess={() => { setExpanded(null); load() }}
        />
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
