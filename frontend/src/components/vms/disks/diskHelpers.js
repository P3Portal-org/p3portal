// p3portal.org
// Shared helpers for the PROJ-81 disk management modals.

// Map a disk write/read error to a German message (component surfaces are
// hardcoded DE, consistent with VmConfigSection / PROJ-79/80 precedent).
export function diskErrMsg(err) {
  const s = err?.response?.status
  const d = err?.response?.data?.detail
  if (s === 400) return typeof d === 'string' ? d : 'Bestätigung stimmt nicht mit dem VM-Namen überein.'
  if (s === 403) return typeof d === 'string' ? d : 'Keine Berechtigung für diese Festplatten-Operation.'
  if (s === 404) return typeof d === 'string' ? d : 'Festplatte nicht gefunden.'
  if (s === 409) return 'Diese VM wird von einem Stack verwaltet – Festplatten über die Stack-Definition ändern.'
  if (s === 422) return typeof d === 'string' ? d : 'Ungültige Eingabe.'
  if (s === 503) return typeof d === 'string' ? d : 'Service-Account nicht konfiguriert.'
  if (s === 502) return 'Proxmox API nicht erreichbar.'
  return (typeof d === 'string' && d) || 'Fehler bei der Festplatten-Operation.'
}

// Parse a raw Proxmox size string ("32G", "512M", "1T", "1024") to whole GiB.
export function sizeToGib(raw) {
  if (raw == null) return 0
  const s = String(raw).trim()
  if (!s) return 0
  const unit = s.slice(-1).toUpperCase()
  const factors = { K: 1 / (1024 * 1024), M: 1 / 1024, G: 1, T: 1024 }
  const num = parseFloat(unit in factors ? s.slice(0, -1) : s)
  if (Number.isNaN(num)) return 0
  const gib = unit in factors ? num * factors[unit] : num / (1024 ** 3) // plain bytes
  return Math.round(gib)
}

// Human-readable bytes for the datastore dropdown (free / total).
export function formatBytes(bytes) {
  const n = Number(bytes)
  if (!n || n <= 0) return '–'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

export const modalInputCls =
  'w-full bg-gray-50 dark:bg-zinc-800 border border-gray-300 dark:border-zinc-700 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm placeholder-gray-400 dark:placeholder-zinc-500 focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent'
