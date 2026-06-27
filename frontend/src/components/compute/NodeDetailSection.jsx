// p3portal.org
import { useState, useEffect } from 'react'
import { getNodeDetail } from '../../api/cluster'
import ResourceBar from '../ui/ResourceBar'

function fmt(bytes) {
  if (bytes == null) return '?'
  const gb = bytes / (1024 ** 3)
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / (1024 ** 2)).toFixed(0)} MB`
}

function fmtIo(bps) {
  if (bps == null) return '?'
  const mb = bps / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${(bps / 1024).toFixed(0)} KB/s`
}

function uptimeLabel(seconds) {
  if (!seconds) return null
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  return `${h}h ${m}m`
}

function InfoRow({ label, value, mono = false }) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-100 dark:border-zinc-800 last:border-0 gap-4">
      <span className="text-xs text-gray-500 dark:text-zinc-400 shrink-0">{label}</span>
      <span className={`text-xs text-gray-800 dark:text-zinc-200 text-right break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function StoragePoolsTable({ pools }) {
  if (!pools?.length) return <p className="text-xs text-gray-500 dark:text-zinc-400">Keine Storage-Pools gefunden.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700">
            <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-zinc-400">Name</th>
            <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-zinc-400">Typ</th>
            <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-zinc-400">Belegt</th>
            <th className="text-left py-2 font-medium text-gray-500 dark:text-zinc-400">Gesamt</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {pools.map(p => (
            <tr key={p.storage} className="text-gray-800 dark:text-zinc-200">
              <td className="py-2 pr-4 font-mono">{p.storage}</td>
              <td className="py-2 pr-4 text-gray-500 dark:text-zinc-400">{p.type ?? '—'}</td>
              <td className="py-2 pr-4">{fmt(p.used ?? p.disk)}</td>
              <td className="py-2">{fmt(p.total ?? p.maxdisk)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function NetworkTable({ ifaces }) {
  if (!ifaces?.length) return <p className="text-xs text-gray-500 dark:text-zinc-400">Keine Netzwerk-Interfaces gefunden.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200 dark:border-zinc-700">
            <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-zinc-400">Interface</th>
            <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-zinc-400">Typ</th>
            <th className="text-left py-2 pr-4 font-medium text-gray-500 dark:text-zinc-400">IP-Adresse</th>
            <th className="text-left py-2 font-medium text-gray-500 dark:text-zinc-400">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
          {ifaces.map(iface => (
            <tr key={iface.iface} className="text-gray-800 dark:text-zinc-200">
              <td className="py-2 pr-4 font-mono">{iface.iface}</td>
              <td className="py-2 pr-4 text-gray-500 dark:text-zinc-400">{iface.type ?? '—'}</td>
              <td className="py-2 pr-4 font-mono text-gray-500 dark:text-zinc-400">
                {iface.address ?? iface.cidr ?? '—'}
              </td>
              <td className="py-2">
                {iface.active
                  ? <span className="text-portal-success">aktiv</span>
                  : <span className="text-gray-400 dark:text-zinc-500">inaktiv</span>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function NodeDetailSection({ nodeName }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!nodeName) return
    setLoading(true)
    setError(null)
    getNodeDetail(nodeName)
      .then(setDetail)
      .catch(err => setError(err.message ?? 'Fehler beim Laden'))
      .finally(() => setLoading(false))
  }, [nodeName])

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded-lg" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-portal-danger/30 bg-portal-danger/10 px-4 py-3 text-sm text-portal-danger rounded-lg">
        Fehler: {error}
      </div>
    )
  }

  if (!detail) return null

  // Backend returns { node, status: {...proxmox status fields...}, storage_pools, network_interfaces }
  // /nodes/{node}/status uses nested objects: memory.{used,total}, rootfs.{used,total}, cpuinfo.{cpus,...}
  // /cluster/resources uses flat fields: mem, maxmem, disk, maxdisk — NOT present here
  const s = detail.status ?? {}

  const memUsed  = s.memory?.used  ?? s.mem  ?? null
  const memTotal = s.memory?.total ?? s.maxmem ?? null
  const diskUsed  = s.rootfs?.used  ?? s.disk  ?? null
  const diskTotal = s.rootfs?.total ?? s.maxdisk ?? null
  const maxCpu   = s.cpuinfo?.cpus ?? s.maxcpu ?? null

  const cpuPct  = (s.cpu ?? 0) * 100
  const ramPct  = memTotal  ? ((memUsed  ?? 0) / memTotal)  * 100 : 0
  const diskPct = diskTotal ? ((diskUsed ?? 0) / diskTotal) * 100 : 0

  // swap is a nested object { used, total, free } from /nodes/{node}/status
  const swapUsed  = s.swap?.used  ?? (typeof s.swap === 'number' ? s.swap : null)
  const swapTotal = s.swap?.total ?? s.maxswap ?? null
  const swapPct   = swapTotal ? ((swapUsed ?? 0) / swapTotal) * 100 : null

  const loadAvg  = Array.isArray(s.loadavg) ? s.loadavg.join(' / ') : null
  const cpuModel = s.cpuinfo?.model ?? null
  const kernelVer = s.kversion ?? null
  const bootMode  = s['boot-mode'] ? s['boot-mode'].toUpperCase() : null
  const pveVer    = s.pveversion ?? null

  return (
    <div className="space-y-4">
      {/* Ressourcen */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-4">
          Ressourcen
        </h3>
        <div className="space-y-3">
          <ResourceBar label="CPU"     pct={cpuPct}  detail={`${cpuPct.toFixed(1)}% · ${maxCpu ?? '?'} Kerne`} />
          <ResourceBar label="RAM"     pct={ramPct}  detail={`${fmt(memUsed)} / ${fmt(memTotal)}`} />
          <ResourceBar label="Root-FS" pct={diskPct} detail={`${fmt(diskUsed)} / ${fmt(diskTotal)}`} />
          {swapPct != null && (
            <ResourceBar label="Swap" pct={swapPct} detail={`${fmt(swapUsed)} / ${fmt(swapTotal)}`} />
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-6 text-xs text-gray-500 dark:text-zinc-400">
          {uptimeLabel(s.uptime) && (
            <span>Uptime: <span className="text-gray-800 dark:text-zinc-200">{uptimeLabel(s.uptime)}</span></span>
          )}
          {loadAvg && (
            <span>Load Avg (1/5/15 min): <span className="text-gray-800 dark:text-zinc-200 font-mono">{loadAvg}</span></span>
          )}
          {(s.diskread != null || s.diskwrite != null) && (
            <span>
              Disk-IO:&nbsp;
              <span className="text-gray-800 dark:text-zinc-200">
                {s.diskread  != null ? `R:${fmtIo(s.diskread)}`  : ''}
                {s.diskread  != null && s.diskwrite != null ? ' ' : ''}
                {s.diskwrite != null ? `W:${fmtIo(s.diskwrite)}` : ''}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* System-Info */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-1">
          System-Info
        </h3>
        <InfoRow label="PVE-Version"        value={pveVer}    mono />
        <InfoRow label="Kernel"             value={kernelVer} mono />
        <InfoRow label="Boot-Modus"         value={bootMode} />
        <InfoRow label="CPU-Modell"         value={cpuModel} />
        {s.cpuinfo && (
          <InfoRow
            label="Sockets / Kerne / Threads"
            value={`${s.cpuinfo.sockets ?? '?'} × ${s.cpuinfo.cores ?? '?'} Kerne · ${maxCpu ?? '?'} Threads`}
          />
        )}
        {s.cpuinfo?.mhz && (
          <InfoRow label="CPU-Frequenz" value={`${parseFloat(s.cpuinfo.mhz).toFixed(0)} MHz`} />
        )}
      </div>

      {/* Storage Pools */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-4">
          Storage Pools
        </h3>
        <StoragePoolsTable pools={detail.storage_pools} />
      </div>

      {/* Netzwerk-Interfaces */}
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-4">
          Netzwerk-Interfaces
        </h3>
        <NetworkTable ifaces={detail.network_interfaces} />
      </div>
    </div>
  )
}
