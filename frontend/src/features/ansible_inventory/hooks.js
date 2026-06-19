// p3portal.org
// PROJ-83: React Query Hooks für das Ansible-Inventory.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchInventoryHosts,
  resetHostKey,
  fetchDiscovery,
  onboardHost,
  onboardBulk,
  markManaged,
  testConnection,
} from './api'

const HOSTS_STALE = 30_000

/**
 * Hosts eines Scopes. `enabled` standardmäßig an; Aufrufer können Pool/Global
 * deaktivieren, solange kein scope_ref gewählt ist.
 */
export function useInventoryHosts(scope = 'user', scopeRef = null, enabled = true) {
  return useQuery({
    queryKey: ['ansibleInventory', 'hosts', scope, scopeRef],
    queryFn: () => fetchInventoryHosts(scope, scopeRef),
    staleTime: HOSTS_STALE,
    enabled,
  })
}

export function useResetHostKey() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ portalNodeId, kind, vmid }) => resetHostKey(portalNodeId, kind, vmid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ansibleInventory'] })
    },
  })
}

// ── PROJ-84 ─────────────────────────────────────────────────────────────────

/** Discovery-Liste einer Installation (Plus). */
export function useDiscovery(portalNodeId, enabled = true) {
  return useQuery({
    queryKey: ['ansibleInventory', 'discovery', portalNodeId],
    queryFn: () => fetchDiscovery(portalNodeId),
    staleTime: HOSTS_STALE,
    enabled: enabled && portalNodeId != null,
  })
}

/** Markiert einen eigenen/adoptierten Host als verwaltet (User-Scope). */
export function useMarkManaged() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ portalNodeId, kind, vmid }) => markManaged(portalNodeId, kind, vmid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ansibleInventory'] }),
  })
}

/** Node-weites Onboarding eines Hosts (Global-Key). */
export function useOnboardHost() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ portalNodeId, kind, vmid, includePoolKey }) =>
      onboardHost(portalNodeId, kind, vmid, includePoolKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ansibleInventory'] }),
  })
}

/** Bulk-Onboarding mehrerer Hosts. */
export function useOnboardBulk() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ hosts, includePoolKey }) => onboardBulk(hosts, includePoolKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ansibleInventory'] }),
  })
}

/** Informativer Verbindungstest (kein Zustands-Schreiben → keine Invalidierung). */
export function useTestConnection() {
  return useMutation({
    mutationFn: ({ portalNodeId, kind, vmid }) => testConnection(portalNodeId, kind, vmid),
  })
}
