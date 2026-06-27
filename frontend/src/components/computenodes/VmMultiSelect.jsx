// p3portal.org
/**
 * PROJ-78: Multi-select list of VMs/LXCs for backup-job target selection.
 *
 * Replaces the freetext VMID input. Loads /api/cluster/vms, scopes to the same
 * Proxmox installation as the given PVE node, and lets the user check the guests
 * to include (or exclude). Emits a comma-separated VMID string via onChange.
 *
 * Core component — used by both the "Bestimmte VMIDs" and "Alle außer Ausschluss"
 * modes of the backup-job form.
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../api/client'

const boxCls = 'border border-gray-200 dark:border-zinc-700 rounded bg-white dark:bg-zinc-800'

export default function VmMultiSelect({ pveNode, value, onChange, emptyHint }) {
  const { t } = useTranslation()
  const [vms, setVms]         = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [query, setQuery]     = useState('')

  // Selected VMIDs as a Set of strings
  const selected = useMemo(() => {
    const set = new Set()
    ;(value || '').split(',').map(s => s.trim()).filter(Boolean).forEach(v => set.add(v))
    return set
  }, [value])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.get('/api/cluster/vms')
      .then(({ data }) => {
        if (cancelled) return
        const all = Array.isArray(data) ? data : []
        // Scope to the same Proxmox installation as pveNode: find the portal_node_id
        // of any VM whose PVE node matches, then keep VMs of that installation.
        const anchor = all.find(v => v.node === pveNode)
        const scoped = anchor?.portal_node_id != null
          ? all.filter(v => v.portal_node_id === anchor.portal_node_id)
          : all
        scoped.sort((a, b) => Number(a.vmid) - Number(b.vmid))
        setVms(scoped)
      })
      .catch(() => { if (!cancelled) setError(t('backup_jobs.list_load_error')) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pveNode, t])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return vms
    return vms.filter(v =>
      String(v.vmid).includes(q) ||
      (v.name ?? '').toLowerCase().includes(q),
    )
  }, [vms, query])

  const emit = (set) => {
    const ordered = vms
      .map(v => String(v.vmid))
      .filter(id => set.has(id))
    onChange(ordered.join(','))
  }

  const toggle = (vmid) => {
    const id = String(vmid)
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    emit(next)
  }

  const selectAllFiltered = () => {
    const next = new Set(selected)
    filtered.forEach(v => next.add(String(v.vmid)))
    emit(next)
  }

  const clearAll = () => onChange('')

  if (loading) {
    return <div className={`${boxCls} px-3 py-4 text-sm text-gray-400 dark:text-zinc-500`}>{t('backup_jobs.loading_list')}</div>
  }

  if (error) {
    return <div className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 rounded">{error}</div>
  }

  if (vms.length === 0) {
    return (
      <div className={`${boxCls} px-3 py-4 text-sm text-gray-400 dark:text-zinc-500`}>
        {emptyHint ?? t('backup_jobs.none_found')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={t('backup_jobs.search_ph')}
          className="flex-1 bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-1.5 text-sm rounded focus:outline-none focus:border-portal-accent/50 focus:ring-1 focus:ring-portal-accent"
        />
        <button type="button" onClick={selectAllFiltered} className="btn-table shrink-0">{t('backup_jobs.btn_all')}</button>
        <button type="button" onClick={clearAll} className="btn-table shrink-0">{t('backup_jobs.btn_none')}</button>
      </div>

      <div className={`${boxCls} max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-zinc-800`}>
        {filtered.length === 0 && (
          <div className="px-3 py-4 text-sm text-gray-400 dark:text-zinc-500">{t('backup_jobs.no_match')}</div>
        )}
        {filtered.map(v => {
          const id = String(v.vmid)
          const isSel = selected.has(id)
          return (
            <label
              key={id}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800/60"
            >
              <input
                type="checkbox"
                checked={isSel}
                onChange={() => toggle(v.vmid)}
                className="w-4 h-4 rounded accent-portal-accent"
              />
              <span className="text-xs font-mono text-gray-500 dark:text-zinc-400 w-12 shrink-0">{v.vmid}</span>
              <span className="text-sm text-gray-800 dark:text-zinc-200 flex-1 truncate">
                {v.name ?? t('backup_jobs.vm_fallback_name', { vmid: v.vmid })}
              </span>
              <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-zinc-500 shrink-0">
                {v.type ?? 'qemu'}
              </span>
              <span className={`text-[10px] shrink-0 ${v.status === 'running' ? 'text-portal-success' : 'text-gray-400 dark:text-zinc-500'}`}>
                {v.status}
              </span>
            </label>
          )
        })}
      </div>

      <p className="text-[11px] text-gray-400 dark:text-zinc-500">
        {selected.size > 0
          ? t('backup_jobs.selected_summary', { count: selected.size, ids: [...selected].join(', ') })
          : t('backup_jobs.none_selected')}
      </p>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
