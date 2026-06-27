// p3portal.org
import { usePermissions } from '../../hooks/usePermissions'
import CapabilityCard from '../permissions/CapabilityCard'
import RbacAssignmentsTable from '../permissions/RbacAssignmentsTable'

const ROLE_LABELS = { admin: 'Administrator', operator: 'Operator', viewer: 'Viewer' }
const AUTH_LABELS = { local: 'Portal-Account', proxmox: 'Proxmox-Account' }

function formatDateTime(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function Row({ label, value }) {
  return (
    <div className="flex items-start gap-4 py-3 border-b border-gray-100 dark:border-zinc-800 last:border-0">
      <span className="w-40 shrink-0 text-xs font-medium text-gray-500 dark:text-zinc-500 uppercase tracking-wider pt-0.5">
        {label}
      </span>
      <span className="text-sm text-gray-900 dark:text-zinc-100">{value}</span>
    </div>
  )
}

function PermissionsSection() {
  const { proxmoxPerms, rbacData, loading, error, reload } = usePermissions()

  if (loading) return <div className="h-24 bg-gray-100 dark:bg-zinc-800 animate-pulse rounded mt-6" />
  if (error) return null
  if (!proxmoxPerms && !rbacData) return null

  const caps = proxmoxPerms?.capabilities ?? {}
  const capKeys = Object.keys(caps).filter(k => Array.isArray(caps[k]))
  const rbacAssignments = rbacData?.assignments ?? []

  if (capKeys.length === 0 && rbacAssignments.length === 0) return null

  return (
    <div className="mt-6 space-y-5">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
        Berechtigungen
      </h3>
      {capKeys.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {capKeys.map(k => (
            <CapabilityCard key={k} type={k} permissions={caps[k]} />
          ))}
        </div>
      )}
      {rbacAssignments.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-gray-500 dark:text-zinc-400">Portal-Zuweisungen</p>
            <button onClick={reload} className="text-xs text-portal-accent hover:text-portal-accent/80 transition-colors">
              Aktualisieren
            </button>
          </div>
          <RbacAssignmentsTable assignments={rbacAssignments} />
        </div>
      )}
    </div>
  )
}

export default function OverviewTab({ profile }) {
  if (!profile) {
    return (
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
        <p className="text-sm text-gray-400 dark:text-zinc-500">Lädt…</p>
      </div>
    )
  }

  const lastLogin = formatDateTime(profile.last_login_at)

  return (
    <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6">
      <div className="space-y-0">
        <Row label="Benutzername" value={<span className="font-mono">{profile.username}</span>} />
        <Row label="Kontotyp" value={AUTH_LABELS[profile.auth_type] ?? profile.auth_type} />
        <Row label="Rolle" value={ROLE_LABELS[profile.role] ?? profile.role} />
        <Row
          label="Letzter Login"
          value={
            lastLogin ? (
              <span>
                {lastLogin}
                {profile.last_login_ip && (
                  <span className="ml-2 text-xs text-gray-400 dark:text-zinc-500 font-mono">
                    {profile.last_login_ip}
                  </span>
                )}
              </span>
            ) : (
              <span className="text-gray-400 dark:text-zinc-600">Kein früherer Login vorhanden</span>
            )
          }
        />
        {profile.must_change_pw && (
          <div className="mt-4 px-3 py-2 bg-portal-accent/10 border border-portal-accent/30 text-xs text-portal-accent">
            Passwortänderung erforderlich &ndash; bitte wechsle zum Tab &bdquo;Sicherheit&ldquo;.
          </div>
        )}
      </div>
      <PermissionsSection />
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
