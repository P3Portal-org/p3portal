// p3portal.org
const ROLE_LABELS = {
  viewer: 'Viewer',
  operator: 'Operator',
  admin: 'Admin',
}

export default function TokenMissingBanner({ role }) {
  const label = ROLE_LABELS[role] ?? role

  return (
    <div className="flex items-start gap-3 rounded-none border border-portal-warn/30 bg-portal-warn/10 px-4 py-3 text-sm text-portal-warn">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
      </svg>
      <div>
        <p className="font-medium">Proxmox-Zugang nicht konfiguriert</p>
        <p className="mt-0.5 text-portal-warn">
          Der Service-Account für die {label}-Rolle ist nicht eingerichtet.
          Bitte einen Administrator kontaktieren oder die Token-Variablen in der{' '}
          <code className="font-mono text-xs">.env</code>-Datei ergänzen.
        </p>
      </div>
      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
