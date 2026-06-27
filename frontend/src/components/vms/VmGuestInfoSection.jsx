// p3portal.org
import ResourceBar from '../ui/ResourceBar'

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function KvRow({ label, value }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-zinc-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-zinc-500">{label}</span>
      <span className="text-xs text-gray-800 dark:text-zinc-200 font-mono">{value || '–'}</span>
    </div>
  )
}

function FilesystemBar({ fs }) {
  if (!fs.total_bytes || fs.total_bytes === 0) {
    return (
      <div className="border border-gray-100 dark:border-zinc-800 rounded px-2.5 py-2 text-xs">
        <div className="flex items-center justify-between mb-0.5">
          <span className="font-mono text-gray-700 dark:text-zinc-300">{fs.mountpoint}</span>
          <span className="text-gray-400 dark:text-zinc-600">{fs.fstype}</span>
        </div>
        <span className="text-gray-400 dark:text-zinc-600">0 B</span>
      </div>
    )
  }

  const pct = (fs.used_bytes / fs.total_bytes) * 100
  const detail = `${formatBytes(fs.used_bytes)} / ${formatBytes(fs.total_bytes)}`

  return (
    <div className="border border-gray-100 dark:border-zinc-800 rounded px-2.5 py-2 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono text-gray-700 dark:text-zinc-300">{fs.mountpoint}</span>
        <span className="text-gray-400 dark:text-zinc-600">{fs.fstype}</span>
      </div>
      <ResourceBar pct={pct} detail={detail} warnAt={80} critAt={95} />
    </div>
  )
}

function buildOsLabel(info) {
  const parts = []
  if (info.os_name) {
    let name = info.os_name
    if (info.os_version) name += ` ${info.os_version}`
    parts.push(name)
  }
  if (info.kernel) parts.push(`Kernel ${info.kernel}`)
  if (info.arch) parts.push(info.arch)
  return parts.length ? parts.join(' · ') : null
}

function buildTimezoneLabel(info) {
  if (!info.timezone) return null
  if (info.timezone_offset != null) {
    const sign = info.timezone_offset >= 0 ? '+' : '-'
    const abs = Math.abs(info.timezone_offset)
    const h = Math.floor(abs / 3600)
    const m = Math.floor((abs % 3600) / 60)
    const offset = m > 0 ? `UTC${sign}${h}:${String(m).padStart(2, '0')}` : `UTC${sign}${h}`
    return `${info.timezone} (${offset})`
  }
  return info.timezone
}

export default function VmGuestInfoSection({ guestInfo, loading }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4">
      <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-4">
        Gastsystem
      </h2>

      {loading && (
        <div className="flex items-center gap-2 py-2">
          <span className="inline-block w-3.5 h-3.5 border-2 border-portal-accent/50 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-400 dark:text-zinc-500">Guest Agent wird abgefragt…</span>
        </div>
      )}

      {!loading && !guestInfo && (
        <div className="rounded border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-800/50 px-3 py-3 text-xs text-gray-400 dark:text-zinc-500">
          Guest Agent nicht verfügbar (VM gestoppt oder Agent nicht installiert)
        </div>
      )}

      {!loading && guestInfo && (() => {
        const osLabel = buildOsLabel(guestInfo)
        const tzLabel = buildTimezoneLabel(guestInfo)
        const hasData = osLabel || guestInfo.hostname || tzLabel

        return (
          <div className="space-y-4">
            {/* OS / Hostname / Timezone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                {osLabel && <KvRow label="Betriebssystem" value={osLabel} />}
                {guestInfo.hostname && <KvRow label="Hostname (Gast)" value={guestInfo.hostname} />}
                {tzLabel && <KvRow label="Zeitzone" value={tzLabel} />}
                {!hasData && (
                  <p className="text-xs text-gray-400 dark:text-zinc-500 py-1">
                    Keine OS-Informationen verfügbar.
                  </p>
                )}
              </div>
            </div>

            {/* Filesystems */}
            {guestInfo.filesystems && guestInfo.filesystems.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-400 dark:text-zinc-600 mb-2">
                  Dateisysteme ({guestInfo.filesystems.length}
                  {guestInfo.truncated_count > 0 ? ` von ${guestInfo.filesystems.length + guestInfo.truncated_count}` : ''})
                </p>
                <div className="space-y-2">
                  {guestInfo.filesystems.map((fs, i) => (
                    <FilesystemBar key={`${fs.mountpoint}-${i}`} fs={fs} />
                  ))}
                  {guestInfo.truncated_count > 0 && (
                    <p className="text-xs text-gray-400 dark:text-zinc-500 px-1">
                      … {guestInfo.truncated_count} weitere Dateisysteme ausgeblendet
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
