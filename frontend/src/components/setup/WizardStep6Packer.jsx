// p3portal.org
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setupTokens, setupPortalSettings, getHostIp } from '../../api/setup'

const PACKER_PRIVS = 'VM.Audit,VM.Allocate,VM.Clone,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.HWType,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,VM.GuestAgent.Audit,Datastore.AllocateSpace,Datastore.Audit,SDN.Use,Pool.Audit,Sys.Modify'

function EyeIcon({ open }) {
  return open ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function buildPackerCommands(tokenId) {
  const idx = tokenId ? tokenId.indexOf('!') : -1
  const user = idx >= 0 ? tokenId.slice(0, idx) : 'portal-packer@pve'
  const tokenName = idx >= 0 ? tokenId.slice(idx + 1) : 'portal-packer'
  return [
    `pveum user add ${user} --comment "P3 Portal Packer"`,
    `pveum role add PortalPacker --privs "${PACKER_PRIVS}"`,
    `pveum acl modify / --user ${user} --role PortalPacker --propagate 1`,
    `pveum user token add ${user} ${tokenName} --privsep 0`,
  ].join('\n')
}

function PackerCommandBlock({ tokenId }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const lines = buildPackerCommands(tokenId)

  const copy = () => {
    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
      >
        <ChevronIcon open={open} />
        {t('setup.show_cmds')}
      </button>
      {open && (
        <div className="mt-2 relative">
          <pre className="text-xs bg-zinc-900 dark:bg-zinc-950 text-zinc-100 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap leading-relaxed">{lines}</pre>
          <button
            type="button"
            onClick={copy}
            className="absolute top-2 right-2 p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
            title="Kopieren"
          >
            {copied ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 text-portal-success">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : <CopyIcon />}
          </button>
        </div>
      )}
    </div>
  )
}

export default function WizardStep6Packer({ initial, onNext, onBack }) {
  const { t } = useTranslation()
  const [packerTokenId, setPackerTokenId] = useState(
    initial?.packer_token_id ?? 'portal-packer@pve!portal-packer'
  )
  const [packerTokenSecret, setPackerTokenSecret] = useState(
    initial?.packer_token_secret ?? ''
  )
  const [showSecret, setShowSecret] = useState(false)
  const [packerHttpIp, setPackerHttpIp] = useState(initial?.packer_http_ip ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!packerHttpIp) {
      getHostIp().then(({ ip }) => {
        if (ip) setPackerHttpIp(ip)
      }).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (packerTokenId || packerTokenSecret) {
        await setupTokens({
          packer_token_id: packerTokenId || undefined,
          packer_token_secret: packerTokenSecret || undefined,
        })
      }
      await setupPortalSettings({ portal_name: 'P3 Portal', packer_http_ip: packerHttpIp })
      onNext({ packer_token_id: packerTokenId, packer_http_ip: packerHttpIp })
    } catch (ex) {
      setError(ex.response?.data?.detail ?? t('setup.s6_err_save'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{t('setup.s6_title')}</h2>
          <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
            Optional
          </span>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.s6_subtitle')}
        </p>
      </div>

      {/* Packer-Token */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('setup.s6_token_label')}</p>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t('setup.token_id')}</label>
          <input
            type="text"
            value={packerTokenId}
            onChange={(e) => setPackerTokenId(e.target.value)}
            className={inputCls}
            placeholder="portal-packer@pve!portal-packer"
          />
        </div>

        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t('setup.token_secret')}</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={packerTokenSecret}
              onChange={(e) => setPackerTokenSecret(e.target.value)}
              className={`${inputCls} pr-10`}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost"
            >
              <EyeIcon open={showSecret} />
            </button>
          </div>
        </div>

        <PackerCommandBlock tokenId={packerTokenId} />
      </div>

      {/* Builder HTTP IP */}
      <div>
        <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
          {t('setup.s6_http_ip_label')} <span className="text-zinc-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={packerHttpIp}
          onChange={(e) => setPackerHttpIp(e.target.value)}
          className={inputCls}
          placeholder="192.168.1.100"
        />
        <p className="text-xs text-zinc-400 mt-1">
          {t('setup.s6_http_ip_hint')}
        </p>
      </div>

      {error && (
        <p className="text-sm text-portal-danger bg-portal-danger/10 border border-portal-danger/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="btn-secondary">
          {t('setup.back')}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onNext({ packer_token_id: '', packer_http_ip: '' })}
            className="btn-secondary"
          >
            {t('setup.skip')}
          </button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? t('setup.saving') : t('setup.next')}
          </button>
        </div>
      </div>
    </form>
  )
}
