// p3portal.org
// PROJ-83: Host-Liste eines Scopes, gruppiert managed/unmanaged/no_ip.
// Nur managed Hosts sind als Run-Ziel wählbar; unmanaged/no_ip werden sichtbar
// gelistet (mit Begründung), aber nicht angeboten (AC-INV-5).
import { useTranslation } from 'react-i18next'

function GroupBadge({ group }) {
  const { t } = useTranslation()
  const cls = {
    managed: 'bg-portal-success/10 text-portal-success border-portal-success/30',
    unmanaged: 'bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700',
    no_ip: 'bg-portal-warn/10 text-portal-warn border-portal-warn/30',
  }[group]
  return (
    <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded border leading-none ${cls}`}>
      {t(`ansible_inventory.group.${group}`)}
    </span>
  )
}

function hostLabel(h) {
  return `VM ${h.vmid}${h.proxmox_node ? ` · ${h.proxmox_node}` : ''}`
}

/**
 * @param {Array} hosts           – HostEntryOut[]
 * @param {Set<string>} selected  – ausgewählte host_refs
 * @param {function} onToggle     – (host_ref) => void
 * @param {boolean} selectable    – false = nur Anzeige (Inventory-Sicht)
 * @param {function} [renderActions] – (host) => ReactNode (z.B. Host-Key-Reset)
 */
export default function GuestHostList({ hosts, selected, onToggle, selectable = true, renderActions }) {
  const { t } = useTranslation()
  const managed = hosts.filter(h => h.group === 'managed')
  const unmanaged = hosts.filter(h => h.group === 'unmanaged')
  const noIp = hosts.filter(h => h.group === 'no_ip')

  const renderRow = (h) => {
    const isManaged = h.group === 'managed'
    return (
      <li
        key={h.host_ref}
        className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 dark:border-zinc-800 last:border-b-0"
      >
        {selectable && (
          <input
            type="checkbox"
            checked={isManaged && selected.has(h.host_ref)}
            disabled={!isManaged}
            onChange={() => onToggle(h.host_ref)}
            className="w-4 h-4 accent-portal-accent disabled:opacity-30 disabled:cursor-not-allowed"
            aria-label={hostLabel(h)}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm truncate ${isManaged ? 'text-gray-900 dark:text-zinc-100' : 'text-gray-500 dark:text-zinc-400'}`}>
              {hostLabel(h)}
            </span>
            <GroupBadge group={h.group} />
          </div>
          <div className="text-xs text-gray-400 dark:text-zinc-500 truncate">
            {h.ip ? <span className="font-mono">{h.ip}</span> : <span className="italic">{t('ansible_inventory.no_ip_reason')}</span>}
            {' · '}{h.ansible_user}{' · '}{h.kind.toUpperCase()}
            {h.group === 'unmanaged' && <span className="ml-1 italic">– {t('ansible_inventory.unmanaged_reason')}</span>}
          </div>
        </div>
        {renderActions && <div className="shrink-0">{renderActions(h)}</div>}
      </li>
    )
  }

  return (
    <div className="space-y-3">
      <div className="border border-gray-200 dark:border-zinc-700 rounded-md overflow-hidden">
        <ul>
          {managed.map(renderRow)}
          {unmanaged.map(renderRow)}
          {noIp.map(renderRow)}
        </ul>
      </div>
      {managed.length === 0 && (
        <p className="text-xs text-portal-warn">{t('ansible_inventory.no_managed_targets')}</p>
      )}
    </div>
  )
}
