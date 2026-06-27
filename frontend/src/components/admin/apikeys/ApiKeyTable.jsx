// p3portal.org

const SCOPE_COLORS = {
  'jobs:start':   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'jobs:read':    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  'cluster:read': 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  'packer:start': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
}

function ScopeBadge({ scope }) {
  const cls = SCOPE_COLORS[scope] ?? 'bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300'
  return (
    <span className={`inline-block text-xs font-mono px-1.5 py-0.5 rounded mr-1 mb-0.5 ${cls}`}>
      {scope}
    </span>
  )
}

function StatusBadge({ status }) {
  const map = {
    active:  'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    revoked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    expired: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  }
  const labels = { active: 'Aktiv', revoked: 'Widerrufen', expired: 'Abgelaufen' }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? map.active}`}>
      {labels[status] ?? status}
    </span>
  )
}

function fmt(iso) {
  if (!iso) return '–'
  try {
    return new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

export default function ApiKeyTable({ keys, onRevoke, onDelete }) {
  const thCls = 'px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider'
  const tdCls = 'px-3 py-2 text-sm text-gray-900 dark:text-zinc-100'

  if (keys.length === 0) {
    return (
      <div className="text-center py-12 text-sm text-gray-400 dark:text-zinc-500">
        Noch keine API-Keys vorhanden. Erstelle den ersten Key mit dem Button oben rechts.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 dark:border-zinc-700">
          <tr>
            <th className={thCls}>Name / Prefix</th>
            <th className={thCls}>Scopes</th>
            <th className={thCls}>Erstellt</th>
            <th className={thCls}>Ablauf</th>
            <th className={thCls}>Letzter Aufruf</th>
            <th className={thCls}>Status</th>
            <th className={thCls}>Aktionen</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {keys.map((k) => (
            <tr key={k.id} className={k.status !== 'active' ? 'opacity-60' : ''}>
              <td className={tdCls}>
                <div className="font-medium">{k.name}</div>
                {k.description && (
                  <div className="text-xs text-gray-400 dark:text-zinc-500 mt-0.5">{k.description}</div>
                )}
                <div className="text-xs font-mono text-gray-400 dark:text-zinc-500 mt-0.5">{k.key_prefix}…</div>
              </td>
              <td className={tdCls}>
                <div className="flex flex-wrap gap-0.5">
                  {k.scopes.map((s) => <ScopeBadge key={s} scope={s} />)}
                </div>
              </td>
              <td className={`${tdCls} whitespace-nowrap`}>{fmt(k.created_at)}</td>
              <td className={`${tdCls} whitespace-nowrap`}>{fmt(k.expires_at)}</td>
              <td className={`${tdCls} whitespace-nowrap`}>{fmt(k.last_used_at)}</td>
              <td className={tdCls}><StatusBadge status={k.status} /></td>
              <td className={tdCls}>
                <div className="flex gap-2">
                  {k.status === 'active' && (
                    <button
                      onClick={() => onRevoke(k)}
                      className="btn-table"
                    >
                      Widerrufen
                    </button>
                  )}
                  <button
                    onClick={() => onDelete(k)}
                    className="btn-table-danger"
                  >
                    Löschen
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
