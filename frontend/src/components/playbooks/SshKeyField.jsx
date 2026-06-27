// p3portal.org
import { useEffect, useRef, useState } from 'react'
import { getUserSshKeys } from '../../api/profile'
import { getSshKey } from '../../api/settings'

function keyPreview(key) {
  const parts = key.trim().split(/\s+/)
  const type = parts[0] ?? ''
  const body = parts[1] ?? ''
  if (!body) return key.trim().slice(0, 48) + '…'
  const comment = parts[2] ? ` ${parts[2]}` : ''
  return `${type} ${body.slice(0, 12)}…${body.slice(-8)}${comment}`
}

export default function SshKeyField({ param, onChange, error }) {
  const init = useRef(false)
  const [profileKeys, setProfileKeys] = useState([])   // [{id, label, public_key}]
  const [checkedIds, setCheckedIds] = useState({})     // {id: bool}
  const [serviceKey, setServiceKey] = useState('')
  const [includeService, setIncludeService] = useState(false)

  function buildValue(keys, checked, sk, skIncluded) {
    const selected = keys.filter(k => checked[k.id]).map(k => k.public_key)
    if (skIncluded && sk) selected.push(sk)
    return selected.join('\n')
  }

  useEffect(() => {
    if (init.current) return
    init.current = true

    Promise.allSettled([getUserSshKeys(), getSshKey()]).then(([keysRes, serviceRes]) => {
      const keys = keysRes.status === 'fulfilled' ? (keysRes.value ?? []) : []
      const sk = serviceRes.status === 'fulfilled' ? (serviceRes.value?.key ?? '') : ''
      const checked = Object.fromEntries(keys.map(k => [k.id, true]))
      const skIncluded = sk.length > 0
      setProfileKeys(keys)
      setCheckedIds(checked)
      setServiceKey(sk)
      setIncludeService(skIncluded)
      onChange(param.id, buildValue(keys, checked, sk, skIncluded))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggle(id, checked) {
    const next = { ...checkedIds, [id]: checked }
    setCheckedIds(next)
    onChange(param.id, buildValue(profileKeys, next, serviceKey, includeService))
  }

  function handleServiceToggle(checked) {
    setIncludeService(checked)
    onChange(param.id, buildValue(profileKeys, checkedIds, serviceKey, checked))
  }

  const checkboxRow = (checked, onCheck, label, preview, accent = false) => (
    <label className={`flex items-start gap-2.5 cursor-pointer p-2.5 border rounded transition ${
      checked
        ? accent
          ? 'border-portal-info/50 bg-portal-info/10'
          : 'border-portal-accent/50 bg-portal-accent/10'
        : 'border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800'
    }`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onCheck(e.target.checked)}
        className="mt-0.5 w-4 h-4 shrink-0 border-gray-300 dark:border-zinc-600 text-portal-accent focus:ring-portal-accent"
      />
      <div className="min-w-0">
        <span className="block text-xs font-medium text-gray-700 dark:text-zinc-300">{label}</span>
        <span className="block text-xs font-mono text-gray-500 dark:text-zinc-500 break-all leading-relaxed mt-0.5">{preview}</span>
      </div>
    </label>
  )

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
        {param.label}
        {param.required && <span className="text-portal-danger ml-1">*</span>}
      </label>

      {profileKeys.length === 0 && !serviceKey && (
        <p className="text-xs text-gray-400 dark:text-zinc-500 italic">
          Keine SSH-Keys im Profil hinterlegt. Keys unter &bdquo;Mein Profil &rarr; SSH-Key&ldquo; hinzuf&uuml;gen.
        </p>
      )}

      <div className="space-y-2">
        {profileKeys.map(k =>
          checkboxRow(
            !!checkedIds[k.id],
            (v) => handleToggle(k.id, v),
            k.label,
            keyPreview(k.public_key),
          )
        )}

        {serviceKey &&
          checkboxRow(
            includeService,
            handleServiceToggle,
            'Service-Key (Portal)',
            keyPreview(serviceKey),
            true,
          )
        }
      </div>

      {error && <p className="text-xs text-portal-danger">{error}</p>}
    </div>
  )
}
