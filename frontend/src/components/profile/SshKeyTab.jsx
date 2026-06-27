// p3portal.org
import { useState, useEffect } from 'react'
import { getUserSshKeys, addUserSshKey, deleteUserSshKeyById, getSshJobKeyStatus, setSshJobKey, deleteSshJobKey, generateSshJobKey } from '../../api/profile'
import { getSshKey } from '../../api/settings'
import ConfirmModal from '../common/ConfirmModal'

const inputCls = 'w-full bg-white dark:bg-zinc-800 border border-gray-300 dark:border-zinc-600 text-gray-900 dark:text-zinc-100 px-3 py-2 text-sm focus:outline-none focus:border-portal-accent focus:ring-1 focus:ring-portal-accent transition'
const cardCls = 'bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 rounded-lg p-6'

function keyPreview(key) {
  const parts = key.trim().split(/\s+/)
  const type = parts[0] ?? ''
  const body = parts[1] ?? ''
  if (!body) return key.trim().slice(0, 60) + '…'
  const comment = parts[2] ? ` ${parts[2]}` : ''
  return `${type} ${body.slice(0, 16)}…${body.slice(-8)}${comment}`
}

export default function SshKeyTab() {
  const [keys, setKeys] = useState([])
  const [serviceKey, setServiceKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [error, setError] = useState('')

  const [showAdd, setShowAdd] = useState(false)
  const [addLabel, setAddLabel] = useState('')
  const [addKey, setAddKey] = useState('')
  const [addError, setAddError] = useState('')
  const [adding, setAdding] = useState(false)

  const [jobKeyStatus, setJobKeyStatus] = useState(null)
  const [jobKeyMode, setJobKeyMode] = useState(null)
  const [jobKeyConfirmed, setJobKeyConfirmed] = useState(false)
  const [jobKeyDraft, setJobKeyDraft] = useState('')
  const [jobKeyLoading, setJobKeyLoading] = useState(false)
  const [jobKeyMsg, setJobKeyMsg] = useState('')
  const [jobKeyErr, setJobKeyErr] = useState('')
  const [generatedPublicKey, setGeneratedPublicKey] = useState('')
  const [copiedPubKey, setCopiedPubKey] = useState(false)
  const [copiedStatusKey, setCopiedStatusKey] = useState(false)
  const [confirmDeleteJobKey, setConfirmDeleteJobKey] = useState(false)

  const load = async () => {
    const [keysRes, serviceRes, jobKeyRes] = await Promise.allSettled([
      getUserSshKeys(), getSshKey(), getSshJobKeyStatus(),
    ])
    if (keysRes.status === 'fulfilled') setKeys(keysRes.value ?? [])
    if (serviceRes.status === 'fulfilled') setServiceKey(serviceRes.value?.key ?? '')
    if (jobKeyRes.status === 'fulfilled') setJobKeyStatus(jobKeyRes.value)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleJobKeyGenerate = async () => {
    if (!jobKeyConfirmed) { setJobKeyErr('Bitte bestätige zuerst den Hinweis.'); return }
    setJobKeyLoading(true); setJobKeyErr(''); setJobKeyMsg('')
    try {
      const result = await generateSshJobKey()
      setGeneratedPublicKey(result.public_key)
      setJobKeyMode('generated')
      await load()
    } catch {
      setJobKeyErr('Fehler beim Generieren des Schlüsselpaares.')
    } finally {
      setJobKeyLoading(false)
    }
  }

  const handleJobKeyImport = async () => {
    if (!jobKeyConfirmed) { setJobKeyErr('Bitte bestätige zuerst den Hinweis.'); return }
    if (!jobKeyDraft.trim()) { setJobKeyErr('Bitte einen privaten Key eingeben.'); return }
    setJobKeyLoading(true); setJobKeyErr(''); setJobKeyMsg('')
    try {
      await setSshJobKey(jobKeyDraft.trim())
      setJobKeyMode(null); setJobKeyDraft(''); setJobKeyConfirmed(false)
      setJobKeyMsg('Privater SSH-Key gespeichert.')
      await load()
    } catch (err) {
      const detail = err.response?.data?.detail
      setJobKeyErr(typeof detail === 'string' ? detail : 'Fehler beim Speichern.')
    } finally {
      setJobKeyLoading(false)
    }
  }

  const handleJobKeyDelete = async () => {
    setJobKeyLoading(true); setJobKeyErr(''); setJobKeyMsg('')
    try {
      await deleteSshJobKey()
      setConfirmDeleteJobKey(false)
      setJobKeyMsg('SSH-Job-Key gelöscht.')
      await load()
    } catch {
      setJobKeyErr('Fehler beim Löschen.')
    } finally {
      setJobKeyLoading(false)
    }
  }

  const handleCopyPubKey = () => {
    navigator.clipboard.writeText(generatedPublicKey).then(() => {
      setCopiedPubKey(true)
      setTimeout(() => setCopiedPubKey(false), 2000)
    })
  }

  const handleCopyStatusKey = () => {
    navigator.clipboard.writeText(jobKeyStatus?.public_key ?? '').then(() => {
      setCopiedStatusKey(true)
      setTimeout(() => setCopiedStatusKey(false), 2000)
    })
  }

  const resetJobKeyPanel = () => {
    setJobKeyMode(null); setJobKeyDraft(''); setJobKeyConfirmed(false)
    setJobKeyErr(''); setJobKeyMsg(''); setGeneratedPublicKey('')
    setCopiedPubKey(false); setConfirmDeleteJobKey(false)
  }

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!addLabel.trim()) { setAddError('Bezeichnung ist erforderlich.'); return }
    if (!addKey.trim()) { setAddError('SSH-Key ist erforderlich.'); return }
    setAddError('')
    setAdding(true)
    try {
      await addUserSshKey(addLabel.trim(), addKey.trim())
      setAddLabel('')
      setAddKey('')
      setShowAdd(false)
      await load()
    } catch (err) {
      const detail = err.response?.data?.detail
      if (typeof detail === 'string') setAddError(detail)
      else if (Array.isArray(detail)) setAddError(detail.map(d => d.msg).join(', '))
      else setAddError('Fehler beim Speichern.')
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id) => {
    setDeleting(id); setError('')
    try {
      await deleteUserSshKeyById(id)
      await load()
    } catch {
      setError('Fehler beim Löschen.')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className={cardCls}>
        <p className="text-sm text-gray-400 dark:text-zinc-500">Lädt…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">

      {/* ── Meine SSH Public Keys ── */}
      <div className={cardCls}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Meine SSH Public Keys</p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Werden beim VM-Deployment automatisch hinterlegt.
            </p>
          </div>
          {!showAdd && (
            <button
              onClick={() => { setShowAdd(true); setAddError('') }}
              className="btn-primary flex items-center gap-1.5"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Key hinzufügen
            </button>
          )}
        </div>

        {error && (
          <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2 mb-4">{error}</p>
        )}

        {keys.length === 0 && !showAdd && (
          <div className="border border-dashed border-gray-200 dark:border-zinc-700 rounded-lg p-8 text-center">
            <p className="text-sm text-gray-400 dark:text-zinc-500">Noch keine Keys hinterlegt.</p>
            <p className="text-xs text-gray-300 dark:text-zinc-600 mt-1">Klicke auf &bdquo;Key hinzuf&uuml;gen&ldquo;.</p>
          </div>
        )}

        {keys.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200 dark:border-zinc-700">
                  <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-zinc-400">Bezeichnung</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500 dark:text-zinc-400">Key</th>
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} className="border-b border-gray-100 dark:border-zinc-800 hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                    <td className="py-2 px-3 font-medium text-gray-900 dark:text-zinc-100 whitespace-nowrap">{k.label}</td>
                    <td className="py-2 px-3 text-gray-500 dark:text-zinc-400 font-mono">{keyPreview(k.public_key)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => setDeleteTarget(k)}
                        disabled={deleting === k.id}
                        className="btn-table-danger"
                      >
                        {deleting === k.id ? '…' : 'Entfernen'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showAdd && (
          <form onSubmit={handleAdd} className="mt-4 space-y-3 border border-gray-200 dark:border-zinc-700 rounded-lg p-4 bg-gray-50 dark:bg-zinc-800/30">
            <p className="text-xs font-semibold text-gray-700 dark:text-zinc-300 uppercase tracking-wide">Neuen Key hinzufügen</p>

            {addError && (
              <p className="text-xs text-portal-danger bg-portal-danger/10 border border-portal-danger/30 px-3 py-2">{addError}</p>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">
                Bezeichnung <span className="text-portal-danger">*</span>
              </label>
              <input
                type="text"
                value={addLabel}
                onChange={e => setAddLabel(e.target.value)}
                placeholder="z.B. Laptop, Desktop, Work"
                maxLength={60}
                className={inputCls}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">
                SSH Public Key <span className="text-portal-danger">*</span>
              </label>
              <textarea
                rows={3}
                value={addKey}
                onChange={e => setAddKey(e.target.value)}
                placeholder="ssh-ed25519 AAAA… oder ssh-rsa AAAA…"
                className={`${inputCls} font-mono text-xs resize-y`}
              />
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={adding} className="btn-primary">
                {adding ? 'Speichern…' : 'Speichern'}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setAddLabel(''); setAddKey(''); setAddError('') }}
                className="btn-secondary"
              >
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </div>

      {/* ── SSH-Job-Key ── */}
      <div className={cardCls}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100">SSH-Job-Key (Scheduled Jobs)</p>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
              Privater SSH-Key f&uuml;r Scheduled-Jobs mit Key-Quelle &bdquo;Mein Profil-Key&ldquo;.
              Wird Fernet-verschlüsselt in der Datenbank gespeichert.
            </p>
          </div>
          {jobKeyStatus?.has_key && !jobKeyMode && !confirmDeleteJobKey && (
            <button
              onClick={() => setConfirmDeleteJobKey(true)}
              className="btn-table-danger shrink-0"
            >
              Entfernen
            </button>
          )}
        </div>

        <div className="mt-4 space-y-4">
          {/* Löschen-Bestätigung */}
          {confirmDeleteJobKey && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-700 dark:text-zinc-300">Wirklich löschen?</span>
              <button
                onClick={handleJobKeyDelete}
                disabled={jobKeyLoading}
                className="text-xs text-portal-danger hover:text-portal-danger/80 font-medium disabled:opacity-50"
              >
                Ja, löschen
              </button>
              <button onClick={() => setConfirmDeleteJobKey(false)} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-zinc-300">
                Abbrechen
              </button>
            </div>
          )}

          {/* Status-Badge + öffentlicher Schlüssel */}
          {!jobKeyMode && !confirmDeleteJobKey && (
            <div className="space-y-3">
              {jobKeyStatus?.has_key ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-portal-success bg-portal-success/10 border border-portal-success/30 px-2.5 py-1 rounded-full font-medium">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3"><polyline points="20 6 9 17 4 12"/></svg>
                  Hinterlegt
                </span>
              ) : (
                <p className="text-xs text-gray-400 dark:text-zinc-500 italic">Noch kein SSH-Job-Key hinterlegt.</p>
              )}

              {jobKeyStatus?.has_key && jobKeyStatus?.public_key && (
                <div>
                  <p className="text-xs text-gray-500 dark:text-zinc-400 mb-1">
                    Öffentlicher Schlüssel (für <code className="font-mono">~/.ssh/authorized_keys</code> auf den Ziel-Servern):
                  </p>
                  <div className="relative">
                    <textarea
                      rows={3}
                      readOnly
                      value={jobKeyStatus.public_key}
                      className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 px-3 py-2 text-xs font-mono resize-none pr-24"
                    />
                    <button
                      onClick={handleCopyStatusKey}
                      className="absolute top-2 right-2 text-xs px-2.5 py-1 bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300 hover:bg-gray-300 dark:hover:bg-zinc-600 transition-colors"
                    >
                      {copiedStatusKey ? 'Kopiert!' : 'Kopieren'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Aktions-Buttons */}
          {!jobKeyMode && !confirmDeleteJobKey && (
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { resetJobKeyPanel(); setJobKeyMode('generate') }}
                className="btn-primary"
              >
                Schlüsselpaar generieren
              </button>
              <button
                onClick={() => { resetJobKeyPanel(); setJobKeyMode('import') }}
                className="btn-secondary"
              >
                Eigenen Key importieren
              </button>
            </div>
          )}

          {/* Sicherheitshinweis + Aktionen */}
          {(jobKeyMode === 'generate' || jobKeyMode === 'import') && (
            <div className="space-y-4">
              <div className="bg-portal-warn/10 border border-portal-warn/30 rounded-lg p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-portal-warn shrink-0 mt-0.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  <p className="text-xs font-semibold text-portal-warn">Sicherheitshinweis</p>
                </div>
                <ul className="text-xs text-portal-warn space-y-1 ml-6 list-disc">
                  <li>Der <strong>private Schlüssel</strong> wird Fernet-verschlüsselt in der Datenbank gespeichert (AES-128-CBC, abgeleitet aus dem Portal-<code className="font-mono">SECRET_KEY</code>).</li>
                  <li>Wer sowohl die Datenbank als auch den <code className="font-mono">SECRET_KEY</code> kennt, kann den Schlüssel entschlüsseln.</li>
                  <li>Erstelle am besten ein <strong>dediziertes Schlüsselpaar</strong> nur für P3 Portal – nutze keinen persönlichen Schlüssel.</li>
                  <li>Der öffentliche Schlüssel muss manuell auf den Ziel-Servern in <code className="font-mono">~/.ssh/authorized_keys</code> hinterlegt werden.</li>
                </ul>
                <label className="flex items-start gap-2 mt-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={jobKeyConfirmed}
                    onChange={e => setJobKeyConfirmed(e.target.checked)}
                    className="mt-0.5 accent-portal-accent"
                  />
                  <span className="text-xs text-portal-warn font-medium">
                    Ich verstehe das Risiko und verwende ausschließlich einen für P3 Portal erstellten Schlüssel.
                  </span>
                </label>
              </div>

              {jobKeyMode === 'generate' && (
                <div className="space-y-3">
                  <p className="text-xs text-gray-600 dark:text-zinc-400">
                    Es wird ein <strong>Ed25519-Schlüsselpaar</strong> generiert. Der private Schlüssel wird sofort verschlüsselt gespeichert.
                    Du erhältst den öffentlichen Schlüssel zum Hinterlegen auf deinen Servern.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleJobKeyGenerate}
                      disabled={jobKeyLoading || !jobKeyConfirmed}
                      className="btn-primary"
                    >
                      {jobKeyLoading ? 'Generiere…' : 'Jetzt generieren'}
                    </button>
                    <button onClick={resetJobKeyPanel} className="btn-secondary">Abbrechen</button>
                  </div>
                </div>
              )}

              {jobKeyMode === 'import' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">
                      Privater SSH-Key (PEM-Format) <span className="text-portal-danger">*</span>
                    </label>
                    <textarea
                      rows={6}
                      value={jobKeyDraft}
                      onChange={e => setJobKeyDraft(e.target.value)}
                      placeholder={"-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----"}
                      className={`${inputCls} font-mono text-xs resize-y`}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleJobKeyImport}
                      disabled={jobKeyLoading || !jobKeyConfirmed}
                      className="btn-primary"
                    >
                      {jobKeyLoading ? 'Speichert…' : 'Speichern'}
                    </button>
                    <button onClick={resetJobKeyPanel} className="btn-secondary">Abbrechen</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Öffentlicher Key nach Generierung */}
          {jobKeyMode === 'generated' && generatedPublicKey && (
            <div className="space-y-3">
              <div className="bg-portal-success/10 border border-portal-success/30 rounded-lg p-3">
                <p className="text-xs font-semibold text-portal-success mb-1">Schlüsselpaar erfolgreich erstellt</p>
                <p className="text-xs text-portal-success">
                  Der private Schlüssel ist verschlüsselt gespeichert. Hinterlege den folgenden öffentlichen Schlüssel
                  auf deinen Ziel-Servern in <code className="font-mono">~/.ssh/authorized_keys</code>:
                </p>
              </div>
              <div className="relative">
                <textarea
                  rows={3}
                  readOnly
                  value={generatedPublicKey}
                  className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-700 dark:text-zinc-300 px-3 py-2 text-xs font-mono resize-none pr-24"
                />
                <button
                  onClick={handleCopyPubKey}
                  className="absolute top-2 right-2 text-xs px-2.5 py-1 bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300 hover:bg-gray-300 dark:hover:bg-zinc-600 transition-colors"
                >
                  {copiedPubKey ? 'Kopiert!' : 'Kopieren'}
                </button>
              </div>
              <button onClick={resetJobKeyPanel} className="btn-secondary">
                Fertig
              </button>
            </div>
          )}

          {jobKeyErr && <p className="text-xs text-portal-danger">{jobKeyErr}</p>}
          {jobKeyMsg && <p className="text-xs text-portal-success">{jobKeyMsg}</p>}
        </div>
      </div>

      {/* ── Service SSH Key ── */}
      <div className={cardCls}>
        <p className="text-sm font-semibold text-gray-900 dark:text-zinc-100 mb-1">Service SSH Key</p>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mb-3">
          Vom Administrator konfiguriert. Wird zusammen mit Ihren Profil-Keys bei jeder VM deployed.
        </p>
        {serviceKey ? (
          <textarea
            rows={3}
            readOnly
            value={serviceKey}
            className="w-full bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 text-gray-500 dark:text-zinc-500 px-3 py-2 text-xs font-mono resize-y cursor-default"
          />
        ) : (
          <p className="text-xs text-gray-400 dark:text-zinc-600 italic">Kein Service-Key konfiguriert.</p>
        )}
      </div>

      {deleteTarget && (
        <ConfirmModal
          title="SSH-Key entfernen"
          body={`Key „${deleteTarget.label}" wirklich entfernen?`}
          confirmLabel="Entfernen"
          variant="danger"
          onConfirm={async () => {
            const key = deleteTarget
            setDeleteTarget(null)
            await handleDelete(key.id)
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
