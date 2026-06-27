// p3portal.org
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setupNode, testNodeConnection } from '../../api/setup'

function parseNodeUrl(fullUrl) {
  if (!fullUrl) return { host: '', port: '' }
  try {
    const u = new URL(fullUrl)
    return { host: `${u.protocol}//${u.hostname}`, port: u.port || '' }
  } catch {
    return { host: fullUrl, port: '' }
  }
}

function buildNodeUrl(host, port) {
  const h = (host || '').replace(/\/$/, '')
  if (!h) return ''
  return port ? `${h}:${port}` : h
}

export default function WizardStep4Node({ initial, onNext, onBack }) {
  const { t } = useTranslation()
  const _parsed = parseNodeUrl(initial?.url ?? '')
  const [form, setForm] = useState({
    name: initial?.name ?? 'Heimcluster',
    host: _parsed.host,
    port: _parsed.port,
    proxmox_node: initial?.proxmox_node ?? 'pve',
    verify_ssl: initial?.verify_ssl ?? true,
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [connResult, setConnResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setConnResult(null)
  }

  const validate = () => {
    if (!form.name.trim()) return t('setup.s4_err_name')
    if (!form.host.trim()) return t('setup.s4_err_host')
    if (!form.host.startsWith('http://') && !form.host.startsWith('https://')) return t('setup.s4_err_host_proto')
    if (!form.proxmox_node.trim()) return t('setup.s4_err_pve_node')
    return null
  }

  const handleTest = async () => {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setTesting(true)
    setConnResult(null)
    try {
      const result = await testNodeConnection({ url: buildNodeUrl(form.host, form.port), verify_ssl: form.verify_ssl })
      setConnResult(result)
    } catch (ex) {
      setConnResult({ ok: false, error: ex.response?.data?.detail ?? t('setup.test_btn') })
    } finally {
      setTesting(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setBusy(true)
    try {
      const url = buildNodeUrl(form.host, form.port)
      await setupNode({ name: form.name, url, proxmox_node: form.proxmox_node, verify_ssl: form.verify_ssl })
      onNext({ name: form.name, url, proxmox_node: form.proxmox_node, verify_ssl: form.verify_ssl })
    } catch (ex) {
      setError(ex.response?.data?.detail ?? t('setup.s4_err_save'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-portal-accent'

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('setup.s4_title')}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.s4_subtitle')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.field_name')}</label>
          <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="Heimcluster" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.s4_field_pve_node')}</label>
          <input type="text" value={form.proxmox_node} onChange={(e) => set('proxmox_node', e.target.value)} className={inputCls} placeholder="pve" required />
        </div>
      </div>

      <div className="grid grid-cols-[1fr_8rem] gap-3">
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('setup.s4_field_host')}</label>
          <input type="text" value={form.host} onChange={(e) => set('host', e.target.value)} className={inputCls} placeholder="https://192.168.1.100" required />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
            {t('setup.field_port')} <span className="text-zinc-400 font-normal text-xs">{t('setup.s4_port_hint')}</span>
          </label>
          <input type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', e.target.value)} className={inputCls} placeholder="8006" />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => set('verify_ssl', !form.verify_ssl)}
          className={`relative w-10 h-5 rounded-full transition-colors ${form.verify_ssl ? 'bg-portal-accent' : 'bg-zinc-300 dark:bg-zinc-600'}`}
        >
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.verify_ssl ? 'translate-x-5' : ''}`} />
        </button>
        <span className="text-sm text-zinc-700 dark:text-zinc-300">{t('setup.s4_ssl_toggle')}</span>
      </div>

      {/* Verbindungstest */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || !form.host}
            className="btn-secondary"
          >
            {testing ? t('setup.testing') : t('setup.test_btn')}
          </button>
          {connResult && !connResult.ok && (
            <span className="text-sm text-portal-danger">✗ {connResult.error ?? t('setup.test_btn')}</span>
          )}
        </div>

        {connResult?.ok && (
          <div className="flex items-center gap-2 bg-portal-success/10 border border-portal-success/30 rounded-lg px-3 py-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-portal-success shrink-0">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-sm text-portal-success">
              {connResult.version
                ? t('setup.s4_test_ok', { version: connResult.version })
                : t('setup.s4_test_ok_noversion')}
            </span>
          </div>
        )}

        {connResult && !connResult.ok && (
          <div className="flex items-start gap-2 bg-portal-warn/10 border border-portal-warn/30 rounded-lg px-3 py-2">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 text-portal-warn shrink-0 mt-0.5">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-xs text-portal-warn">
              {t('setup.s4_test_fail_hint')}
            </p>
          </div>
        )}
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
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? t('setup.saving') : t('setup.next')}
        </button>
      </div>
    </form>
  )
}
