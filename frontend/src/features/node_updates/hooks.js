// p3portal.org
// PROJ-73: Node-Updates React Query Hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchNodeUpdatesSummary, fetchNodeUpdates, refreshNodeUpdates } from './api'

const SUMMARY_STALE = 30_000
const DETAIL_STALE  = 30_000

export function useNodeUpdatesSummary() {
  return useQuery({
    queryKey: ['nodeUpdates', 'summary'],
    queryFn: fetchNodeUpdatesSummary,
    staleTime: SUMMARY_STALE,
    refetchOnWindowFocus: true,
  })
}

export function useNodeUpdates(portalNodeId) {
  return useQuery({
    queryKey: ['nodeUpdates', 'detail', portalNodeId],
    queryFn: () => fetchNodeUpdates(portalNodeId),
    staleTime: DETAIL_STALE,
    enabled: !!portalNodeId,
    refetchOnWindowFocus: true,
  })
}

export function useRefreshNodeUpdates(portalNodeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => refreshNodeUpdates(portalNodeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nodeUpdates'] })
    },
  })
}

/**
 * Aggregiert Summary-Einträge pro portal_node_id clientseitig.
 * Gibt Map<portal_node_id, { packageCount, securityCount, lastSuccessAt, isStale, hasError }>
 */
export function useNodeUpdatesBadgeData() {
  const { data } = useNodeUpdatesSummary()
  if (!data?.entries) return {}

  const map = {}
  for (const entry of data.entries) {
    const id = entry.portal_node_id
    if (!map[id]) {
      map[id] = {
        packageCount: 0,
        securityCount: 0,
        lastSuccessAt: entry.last_success_at,
        isStale: false,
        hasError: false,
      }
    }
    const agg = map[id]
    agg.packageCount  += entry.package_count
    agg.securityCount += entry.security_count
    agg.hasError = agg.hasError || !!entry.last_error
    agg.isStale  = agg.isStale  || entry.is_stale
    // ältester Erfolg-Zeitstempel bestimmt die Frische
    if (!agg.lastSuccessAt || (entry.last_success_at && entry.last_success_at < agg.lastSuccessAt)) {
      agg.lastSuccessAt = entry.last_success_at
    }
  }
  return map
}
