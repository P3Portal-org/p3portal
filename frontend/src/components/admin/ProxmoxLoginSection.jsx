// p3portal.org
import { useEffect, useState } from 'react'
import { getProxmoxLoginEnabled, setProxmoxLoginEnabled } from '../../api/admin'

function WarningDialog({ onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-zinc-900 border border-portal-warn/50 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <div className="flex items-start gap-3 mb-4">
          <span className="text-portal-warn text-xl shrink-0">⚠</span>
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1">
              Experimentelles Feature – Proxmox-Login
            </h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
              Der Proxmox-Login ist <strong>experimentell</strong> und hat bekannte Einschränkungen:
            </p>
            <ul className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 space-y-1 list-disc list-inside">
              <li>Ansible-Playbooks laufen nicht mit Proxmox-Credentials</li>
              <li>Nicht alle Portal-Funktionen sind für Proxmox-Nutzer verfügbar</li>
              <li>Mögliche Sicherheitsimplikationen bei Nutzung mit root@pam</li>
            </ul>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              Für den produktiven Einsatz wird der <strong>Portal-Login</strong> empfohlen.
            </p>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={onCancel}
            className="btn-secondary"
          >
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            className="btn-primary"
          >
            Trotzdem aktivieren
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProxmoxLoginSection() {
  const [enabled, setEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showDialog, setShowDialog] = useState(false)

  useEffect(() => {
    getProxmoxLoginEnabled()
      .then(setEnabled)
      .finally(() => setLoading(false))
  }, [])

  const handleToggle = () => {
    if (!enabled) {
      setShowDialog(true)
    } else {
      applyChange(false)
    }
  }

  const applyChange = async (value) => {
    setSaving(true)
    try {
      await setProxmoxLoginEnabled(value)
      setEnabled(value)
    } finally {
      setSaving(false)
    }
  }

  const handleConfirm = () => {
    setShowDialog(false)
    applyChange(true)
  }

  if (loading) return null

  return (
    <>
      {showDialog && (
        <WarningDialog
          onConfirm={handleConfirm}
          onCancel={() => setShowDialog(false)}
        />
      )}

      <div className="mb-8">
        <h2 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-3">
          Authentifizierung
        </h2>
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Proxmox-Login</p>
                <span className="px-1.5 py-0.5 text-xs font-semibold rounded bg-portal-warn/15 text-portal-warn border border-portal-warn/30">
                  Experimental
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Zeigt den Proxmox-Login-Tab auf der Anmeldeseite. Nutzer melden sich mit Proxmox-Credentials an.
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggle}
              disabled={saving}
              className={`relative w-10 h-5 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
                enabled ? 'bg-portal-accent' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${enabled ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          {enabled && (
            <div className="mt-3 flex items-start gap-2 bg-portal-warn/10 border border-portal-warn/30 rounded-lg px-3 py-2">
              <span className="text-portal-warn shrink-0 text-sm">⚠</span>
              <p className="text-xs text-portal-warn">
                Proxmox-Login ist aktiv. Dieses Feature ist experimentell – Ansible-Playbooks und einige Portal-Funktionen sind für Proxmox-Nutzer eingeschränkt.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
