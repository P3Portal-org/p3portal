// p3portal.org

export default function VmLxcNetworkSection({ interfaces, loading }) {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg px-5 py-4">
      <h2 className="text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider mb-4">
        Netzwerk-Interfaces (LXC)
      </h2>

      {loading && (
        <div className="flex items-center gap-2 py-2">
          <span className="inline-block w-3.5 h-3.5 border-2 border-portal-accent/50 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-gray-400 dark:text-zinc-500">Interfaces werden geladen…</span>
        </div>
      )}

      {!loading && (!interfaces || interfaces.length === 0) && (
        <p className="text-xs text-gray-400 dark:text-zinc-500">Keine Interface-Daten verfügbar.</p>
      )}

      {!loading && interfaces && interfaces.length > 0 && (
        <div className="space-y-2">
          {interfaces.map((iface) => (
            <div
              key={iface.name}
              className="border border-gray-100 dark:border-zinc-800 rounded px-2.5 py-2 text-xs"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-medium text-gray-700 dark:text-zinc-300">{iface.name}</span>
                {iface.hwaddr && (
                  <span className="font-mono text-gray-400 dark:text-zinc-600">{iface.hwaddr}</span>
                )}
              </div>
              <div className="space-y-0.5">
                {iface.inet && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 dark:text-zinc-600 w-10">IPv4</span>
                    <span className="font-mono text-gray-700 dark:text-zinc-300">{iface.inet}</span>
                  </div>
                )}
                {iface.inet6 && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 dark:text-zinc-600 w-10">IPv6</span>
                    <span className="font-mono text-gray-700 dark:text-zinc-300 break-all">{iface.inet6}</span>
                  </div>
                )}
                {!iface.inet && !iface.inet6 && (
                  <span className="text-gray-400 dark:text-zinc-600">Keine IP-Adresse</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
