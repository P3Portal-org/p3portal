// p3portal.org
import { useEffect, useRef, useState } from 'react'
import { getUserSshKeys } from '../../api/profile'

function keyPreview(key) {
  const parts = key.trim().split(/\s+/)
  const type = parts[0] ?? ''
  const body = parts[1] ?? ''
  if (!body) return key.trim().slice(0, 48) + '…'
  const comment = parts[2] ? ` ${parts[2]}` : ''
  return `${type} ${body.slice(0, 12)}…${body.slice(-8)}${comment}`
}

export default function VmAccessField({ param, onChange }) {
  const init = useRef(false)
  const [mode, setMode] = useState('root')
  const [profileKeys, setProfileKeys] = useState([])  // [{id, label, public_key}]
  const [checkedIds, setCheckedIds] = useState({})    // {id: bool}
  const [showManual, setShowManual] = useState(false)
  const [manualKey, setManualKey] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [username, setUsername] = useState('')
  const [internalErrors, setInternalErrors] = useState({})

  useEffect(() => {
    if (init.current) return
    init.current = true
    getUserSshKeys()
      .then(keys => {
        setProfileKeys(keys ?? [])
        const checked = Object.fromEntries((keys ?? []).map(k => [k.id, true]))
        setCheckedIds(checked)
        const combined = buildSshKeyFromState(keys ?? [], checked, '')
        emitAll('root', '', combined, '')
      })
      .catch(() => emitAll('root', '', '', ''))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function buildSshKeyFromState(keys, checked, mk) {
    const selected = keys.filter(k => checked[k.id]).map(k => k.public_key)
    if (mk.trim()) selected.push(mk.trim())
    return selected.join('\n')
  }

  function emitAll(m, u, combinedKey, pw) {
    onChange(param.id, m)
    onChange('vm_access_mode', m)
    onChange('vm_access_username', u)
    onChange('vm_access_ssh_key', combinedKey)
    onChange('vm_access_password', pw)
  }

  function reemit(m, u, keys, checked, mk, pw) {
    const combined = buildSshKeyFromState(keys, checked, mk)
    onChange(param.id, m)
    onChange('vm_access_mode', m)
    onChange('vm_access_username', u)
    onChange('vm_access_ssh_key', combined)
    onChange('vm_access_password', pw)
    validateInternal(m, u, combined, pw)
  }

  function validateInternal(m, u, combinedKey, pw) {
    const e = {}
    if (m === 'user' && !u.trim()) e.username = 'Benutzername ist erforderlich'
    if (!combinedKey.trim() && !pw.trim()) e.access = 'Mindestens SSH-Key oder Passwort muss gesetzt sein'
    setInternalErrors(e)
  }

  function handleMode(m) {
    setMode(m)
    reemit(m, username, profileKeys, checkedIds, manualKey, password)
  }

  function handleKeyToggle(id, checked) {
    const next = { ...checkedIds, [id]: checked }
    if (!checked && !Object.values(next).some(Boolean)) setShowManual(true)
    setCheckedIds(next)
    reemit(mode, username, profileKeys, next, manualKey, password)
  }

  function handleManualKey(v) {
    setManualKey(v)
    reemit(mode, username, profileKeys, checkedIds, v, password)
  }

  function handlePassword(v) {
    setPassword(v)
    reemit(mode, username, profileKeys, checkedIds, manualKey, v)
  }

  function handleUsername(v) {
    setUsername(v)
    reemit(mode, v, profileKeys, checkedIds, manualKey, password)
  }

  const inputBase =
    'w-full border px-3 py-2 text-sm bg-white dark:bg-zinc-800 border-gray-300 dark:border-zinc-600 ' +
    'text-gray-900 dark:text-zinc-100 placeholder-gray-400 dark:placeholder-zinc-500 ' +
    'focus:outline-none focus:ring-1 focus:ring-portal-accent focus:border-portal-accent transition'
  const textareaBase = `${inputBase} text-xs font-mono resize-y`
  const hasAccessError = !!internalErrors.access
  const currentCombined = buildSshKeyFromState(profileKeys, checkedIds, manualKey)

  return (
    <div className="space-y-4">

      {/* Mode toggle */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300 mb-2">
          {param.label}
          {param.required && <span className="text-portal-danger ml-1">*</span>}
        </label>
        <div className="flex rounded border border-gray-300 dark:border-zinc-600 overflow-hidden text-sm">
          {[
            { value: 'root', label: 'Root-Zugang' },
            { value: 'user', label: 'VM-User anlegen' },
          ].map(opt => (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleMode(opt.value)}
              className={`flex-1 px-3 py-2 text-center transition ${
                mode === opt.value
                  ? 'bg-portal-accent text-white font-medium'
                  : 'bg-white dark:bg-zinc-800 text-gray-600 dark:text-zinc-400 hover:bg-gray-50 dark:hover:bg-zinc-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Username (user mode only) */}
      {mode === 'user' && (
        <div className="space-y-1">
          <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400">
            Benutzername <span className="text-portal-danger">*</span>
          </label>
          <input
            type="text"
            value={username}
            onChange={e => handleUsername(e.target.value)}
            placeholder="z.B. chris"
            className={`${inputBase} ${internalErrors.username ? 'border-portal-danger' : ''}`}
          />
          {internalErrors.username && (
            <p className="text-xs text-portal-danger">{internalErrors.username}</p>
          )}
        </div>
      )}

      {/* SSH Keys */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400">
          SSH Public Key{' '}
          <span className="text-gray-400 dark:text-zinc-500 font-normal">(optional)</span>
        </label>

        {profileKeys.length > 0 ? (
          <div className="space-y-2">
            {profileKeys.map(k => (
              <label
                key={k.id}
                className={`flex items-start gap-2 cursor-pointer p-2 border rounded transition ${
                  checkedIds[k.id]
                    ? 'border-portal-accent/50 bg-portal-accent/10'
                    : 'border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={!!checkedIds[k.id]}
                  onChange={e => handleKeyToggle(k.id, e.target.checked)}
                  className="mt-0.5 w-4 h-4 border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent flex-shrink-0"
                />
                <div className="min-w-0">
                  <span className="block text-xs font-medium text-gray-700 dark:text-zinc-300">{k.label}</span>
                  <span className="block text-xs font-mono text-gray-500 dark:text-zinc-500 break-all leading-relaxed mt-0.5">
                    {keyPreview(k.public_key)}
                  </span>
                </div>
              </label>
            ))}

            {!showManual ? (
              <button
                type="button"
                onClick={() => setShowManual(true)}
                className="text-xs text-portal-accent hover:underline"
              >
                + Weiteren Key manuell eingeben
              </button>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500 dark:text-zinc-500">Weiterer Key (manuell)</span>
                  <button
                    type="button"
                    onClick={() => { setShowManual(false); handleManualKey('') }}
                    className="text-xs text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300"
                  >
                    ✕ entfernen
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={manualKey}
                  onChange={e => handleManualKey(e.target.value)}
                  placeholder="ssh-rsa AAAA… oder ssh-ed25519 AAAA…"
                  className={`${textareaBase} ${hasAccessError && !password ? 'border-portal-danger' : ''}`}
                />
              </div>
            )}
          </div>
        ) : (
          <textarea
            rows={3}
            value={manualKey}
            onChange={e => handleManualKey(e.target.value)}
            placeholder="ssh-rsa AAAA… oder ssh-ed25519 AAAA…"
            className={`${textareaBase} ${hasAccessError && !password ? 'border-portal-danger' : ''}`}
          />
        )}
      </div>

      {/* Password */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400">
          {mode === 'root' ? 'Root-Passwort' : 'Passwort'}{' '}
          <span className="text-gray-400 dark:text-zinc-500 font-normal">(optional)</span>
        </label>
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={e => handlePassword(e.target.value)}
            placeholder="••••••••"
            className={`${inputBase} pr-10 ${hasAccessError && !currentCombined ? 'border-portal-danger' : ''}`}
          />
          <button
            type="button"
            onClick={() => setShowPassword(s => !s)}
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300"
          >
            {showPassword ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {hasAccessError && (
        <p className="text-xs text-portal-danger">{internalErrors.access}</p>
      )}

      <p className="text-xs text-gray-400 dark:text-zinc-500">
        Portal-Zugang (sysadm) bleibt als Service-User erhalten.
      </p>
    </div>
  )
}
