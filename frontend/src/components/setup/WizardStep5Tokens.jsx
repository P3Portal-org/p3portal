// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setupTokens, testSetupConnection } from '../../api/setup'
import { useCapability } from '../../hooks/useCapability'

const VIEWER_PRIVS = 'VM.Audit,VM.GuestAgent.Audit,Pool.Audit,Sys.Audit'
const OPERATOR_PRIVS = 'VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,Pool.Audit'
const ADMIN_PRIVS = 'VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,VM.Allocate,VM.Clone,VM.Backup,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.HWType,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,Datastore.Allocate,Datastore.AllocateSpace,Datastore.Audit,SDN.Use,SDN.Allocate,Pool.Audit,Sys.Audit,Sys.Modify'
// PROJ-76 Phase 2a: PortalTofu role – least-privilege OpenTofu engine token.
// Sys.Modify (PROJ-87) lets a stack create its own node-level bridge
// (/nodes/{node}/network); without it the apply 403s. SDN.Allocate (PROJ-89)
// lets a stack create its own SDN VNet/subnet.
const TOFU_PRIVS = 'VM.Allocate,VM.Clone,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.HWType,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,VM.PowerMgmt,VM.Audit,Datastore.Allocate,Datastore.AllocateSpace,Pool.Audit,SDN.Use,SDN.Allocate,Sys.Modify'

function parseTokenId(tokenId) {
  if (!tokenId) return null
  const idx = tokenId.indexOf('!')
  if (idx === -1) return { user: tokenId, tokenName: '' }
  return { user: tokenId.slice(0, idx), tokenName: tokenId.slice(idx + 1) }
}

function buildCommands(tokenId, roleName, privs) {
  const parsed = parseTokenId(tokenId)
  const placeholder = !tokenId
  const user = parsed?.user || `portal-${roleName.toLowerCase()}@pve`
  const tokenName = parsed?.tokenName || `portal-${roleName.toLowerCase()}`
  const lines = [
    `pveum user add ${user} --comment "P3 Portal ${roleName}"`,
    `pveum role add Portal${roleName} --privs "${privs}"`,
    `pveum acl modify / --user ${user} --role Portal${roleName} --propagate 1`,
    `pveum user token add ${user} ${tokenName} --privsep 0`,
  ].join('\n')
  return { lines, placeholder }
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

function CommandBlock({ tokenId, roleName, privs }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { lines, placeholder } = buildCommands(tokenId, roleName, privs)

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
        {placeholder && <span className="text-zinc-400">{t('setup.s5_cmds_placeholder')}</span>}
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
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 text-green-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : <CopyIcon />}
          </button>
        </div>
      )}
    </div>
  )
}

function TokenPair({ label, idKey, secretKey, roleName, privs, form, onChange, nodeUrl, nodeVerifySsl }) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const canTest = Boolean(form[idKey]) && Boolean(form[secretKey])

  const handleTokenTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testSetupConnection({
        url: nodeUrl,
        token_id: form[idKey],
        token_secret: form[secretKey],
        verify_ssl: nodeVerifySsl ?? false,
      })
      setTestResult(result)
    } catch (ex) {
      setTestResult({ ok: false, error: ex.response?.data?.detail ?? t('setup.test_btn') })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</p>
      <div>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t('setup.token_id')}</label>
        <input
          type="text"
          value={form[idKey]}
          onChange={(e) => { onChange(idKey, e.target.value); setTestResult(null) }}
          className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
          placeholder="user@pve!tokenname"
        />
      </div>
      <div>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t('setup.token_secret')}</label>
        <div className="relative">
          <input
            type={show ? 'text' : 'password'}
            value={form[secretKey]}
            onChange={(e) => { onChange(secretKey, e.target.value); setTestResult(null) }}
            className="w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500 pr-10"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
          />
          <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 btn-ghost">
            <EyeIcon open={show} />
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleTokenTest}
          disabled={!canTest || testing}
          className="btn-secondary"
        >
          {testing ? t('setup.testing') : t('setup.test_btn')}
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
            {testResult.ok ? `✓ PVE ${testResult.version}` : `✗ ${testResult.error}`}
          </span>
        )}
      </div>
      <CommandBlock tokenId={form[idKey]} roleName={roleName} privs={privs} />
    </div>
  )
}

export default function WizardStep5Tokens({ initial, nodeUrl, nodeVerifySsl, onNext, onBack }) {
  const { t } = useTranslation()
  const stacksEnabled = useCapability('stacks')  // PROJ-76 Phase 2a (Plus-only)
  const [form, setForm] = useState({
    viewer_token_id: initial?.viewer_token_id ?? 'portal-viewer@pve!portal-viewer',
    viewer_token_secret: initial?.viewer_token_secret ?? '',
    operator_token_id: initial?.operator_token_id ?? 'portal-operator@pve!portal-operator',
    operator_token_secret: initial?.operator_token_secret ?? '',
    admin_token_id: initial?.admin_token_id ?? 'portal-admin@pve!portal-admin',
    admin_token_secret: initial?.admin_token_secret ?? '',
    // PROJ-76 Phase 2a: optional OpenTofu engine token (only sent/shown when Plus)
    tofu_token_id: initial?.tofu_token_id ?? '',
    tofu_token_secret: initial?.tofu_token_secret ?? '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setTestResult(null) }

  const handleTest = async () => {
    if (!form.viewer_token_id || !form.viewer_token_secret) {
      setTestResult({ ok: false, error: t('setup.s5_err_viewer') })
      return
    }
    if (!nodeUrl) {
      setTestResult({ ok: false, error: t('setup.s5_err_url') })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testSetupConnection({
        url: nodeUrl,
        token_id: form.viewer_token_id,
        token_secret: form.viewer_token_secret,
        verify_ssl: nodeVerifySsl ?? false,
      })
      setTestResult(result)
    } catch (ex) {
      setTestResult({ ok: false, error: ex.response?.data?.detail ?? t('setup.test_btn') })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await setupTokens(form)
      onNext(form)
    } catch (ex) {
      setError(ex.response?.data?.detail ?? t('setup.s5_err_save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('setup.s5_title')}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.s5_subtitle')}
        </p>
      </div>

      <TokenPair label={t('setup.s5_viewer_label')} idKey="viewer_token_id" secretKey="viewer_token_secret" roleName="Viewer" privs={VIEWER_PRIVS} form={form} onChange={set} nodeUrl={nodeUrl} nodeVerifySsl={nodeVerifySsl} />
      <TokenPair label={t('setup.s5_operator_label')} idKey="operator_token_id" secretKey="operator_token_secret" roleName="Operator" privs={OPERATOR_PRIVS} form={form} onChange={set} nodeUrl={nodeUrl} nodeVerifySsl={nodeVerifySsl} />
      <TokenPair label={t('setup.s5_admin_label')} idKey="admin_token_id" secretKey="admin_token_secret" roleName="Admin" privs={ADMIN_PRIVS} form={form} onChange={set} nodeUrl={nodeUrl} nodeVerifySsl={nodeVerifySsl} />
      {stacksEnabled && (
        <TokenPair label={t('setup.s5_tofu_label')} idKey="tofu_token_id" secretKey="tofu_token_secret" roleName="Tofu" privs={TOFU_PRIVS} form={form} onChange={set} nodeUrl={nodeUrl} nodeVerifySsl={nodeVerifySsl} />
      )}

      {/* Verbindungstest mit Viewer-Token */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="btn-secondary"
        >
          {testing ? t('setup.testing') : t('setup.test_btn')}
        </button>
        <span className="text-xs text-zinc-400">{t('setup.s5_global_test_hint')}</span>
        {testResult && (
          <span className={`text-sm ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
            {testResult.ok ? `✓ PVE ${testResult.version}` : `✗ ${testResult.error}`}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <div className="flex justify-between">
        <button type="button" onClick={onBack} className="btn-secondary">
          {t('setup.back')}
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={() => onNext(form)} className="btn-secondary">
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
