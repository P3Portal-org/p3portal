// p3portal.org
/**
 * PROJ-90: Alias manager (AC-ALIAS-*). Reused at two scopes: datacenter-global
 * (cluster-wide usage check) and per-guest local (plain confirm). An alias is a
 * named IP/CIDR referenceable by name in rule source/dest. Lists aliases, creates
 * (name + cidr + comment, 409 on collision), edits (cidr/comment) and deletes.
 * Scope-bound CRUD via `api`; `usageCheck` optional (DC only).
 */
import { useState, useEffect, useCallback } from 'react'
import { firewallErrMsg } from '../../api/firewall'
import FirewallUsageConfirmModal from './FirewallUsageConfirmModal'

const inputCls = 'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent rounded'
const labelCls = 'block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1'

function AliasFormModal({ alias, onCreate, onUpdate, onClose, onSuccess }) {
  const isEdit = Boolean(alias)
  const [name, setName] = useState(alias?.name ?? '')
  const [cidr, setCidr] = useState(alias?.cidr ?? '')
  const [comment, setComment] = useState(alias?.comment ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const payload = { name: name.trim(), cidr: cidr.trim(), comment: comment.trim() || undefined }
      if (isEdit) await onUpdate(alias.name, payload)
      else await onCreate(payload)
      onSuccess?.(); onClose()
    } catch (err) { setError(firewallErrMsg(err)); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">{isEdit ? `Alias bearbeiten – ${alias.name}` : 'Alias anlegen'}</h2>
        </div>
        <div className="px-6 py-4 space-y-3">
          {error && <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>}
          <div>
            <label className={labelCls} htmlFor="al-name">Name <span className="text-portal-danger">*</span></label>
            <input id="al-name" type="text" value={name} onChange={e => setName(e.target.value)} disabled={isEdit} placeholder="z. B. gateway" className={`${inputCls} ${isEdit ? 'opacity-60 cursor-not-allowed' : ''}`} />
            {isEdit && <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-1">Der Name kann nicht geändert werden.</p>}
          </div>
          <div>
            <label className={labelCls} htmlFor="al-cidr">IP / CIDR <span className="text-portal-danger">*</span></label>
            <input id="al-cidr" type="text" value={cidr} onChange={e => setCidr(e.target.value)} placeholder="192.168.1.1 oder 10.0.0.0/24" className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="al-comment">Kommentar (optional)</label>
            <input id="al-comment" type="text" value={comment} onChange={e => setComment(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="px-6 py-3 border-t border-gray-100 dark:border-zinc-800 flex items-center justify-end gap-2 bg-gray-50/50 dark:bg-zinc-900/40 rounded-b-xl">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">Abbrechen</button>
          <button type="submit" disabled={saving || !name.trim() || !cidr.trim()} className="btn-primary">{saving ? '…' : isEdit ? 'Speichern' : 'Anlegen'}</button>
        </div>
        <span className="rq hidden" aria-hidden="true" />
      </form>
    </div>
  )
}

export default function AliasesManager({ api, title = 'Aliases' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [modal, setModal] = useState(undefined)        // undefined=closed, null=create, object=edit
  const [deleteName, setDeleteName] = useState(null)
  const hasUsage = typeof api.usageCheck === 'function'

  const load = useCallback(() => {
    setLoading(true)
    api.listAliases()
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
        <button onClick={() => setModal(null)} className="btn-primary text-xs">+ Alias anlegen</button>
      </div>

      {data?.permission_denied ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 py-4">Kein Leserecht auf Aliases.</p>
      ) : loading && !data ? (
        <div className="h-10 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded" />
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-zinc-500 py-4">Keine Aliases.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 dark:border-zinc-700 overflow-hidden">
          <table className="w-full min-w-[420px]">
            <thead>
              <tr className="border-b border-gray-200 dark:border-zinc-700">
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Name</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">IP / CIDR</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Kommentar</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider">Aktionen</th>
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-zinc-900 divide-y divide-gray-100 dark:divide-zinc-800">
              {items.map(a => (
                <tr key={a.name} className="hover:bg-gray-50 dark:hover:bg-zinc-800/40 transition-colors">
                  <td className="px-3 py-2 text-xs font-mono font-medium text-gray-800 dark:text-zinc-200">{a.name}</td>
                  <td className="px-3 py-2 text-[11px] font-mono text-gray-600 dark:text-zinc-300">{a.cidr || '–'}</td>
                  <td className="px-3 py-2 text-[11px] text-gray-500 dark:text-zinc-400 max-w-[160px] truncate" title={a.comment || ''}>{a.comment || '–'}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button onClick={() => setModal(a)} className="btn-table">Bearbeiten</button>
                      <button onClick={() => setDeleteName(a.name)} className="btn-table-danger">Löschen</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== undefined && (
        <AliasFormModal
          alias={modal}
          onCreate={api.createAlias}
          onUpdate={api.updateAlias}
          onClose={() => setModal(undefined)}
          onSuccess={load}
        />
      )}
      {deleteName && (
        <FirewallUsageConfirmModal
          kind="alias"
          name={deleteName}
          usageCheck={hasUsage ? () => api.usageCheck('alias', deleteName) : undefined}
          onDelete={() => api.deleteAlias(deleteName)}
          onClose={() => setDeleteName(null)}
          onSuccess={load}
        />
      )}
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
