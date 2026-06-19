// p3portal.org
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { createNode, updateNode, testNodeConnection, testNodeToken } from '../../api/nodes'
import { testSetupConnection } from '../../api/setup'
import { useCapability } from '../../hooks/useCapability'
import ModalHelpButton from '../../features/help/components/ModalHelpButton'

const VIEWER_PRIVS   = 'VM.Audit,VM.GuestAgent.Audit,Pool.Audit,Sys.Audit'
const OPERATOR_PRIVS = 'VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,Pool.Audit'
const ADMIN_PRIVS    = 'VM.Audit,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,VM.Allocate,VM.Clone,VM.Backup,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.HWType,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,Datastore.Allocate,Datastore.AllocateSpace,Datastore.Audit,SDN.Use,SDN.Allocate,Pool.Audit,Sys.Audit,Sys.Modify'
const PACKER_PRIVS   = 'VM.Allocate,VM.Clone,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.HWType,VM.Config.Network,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,VM.Console,VM.PowerMgmt,VM.Audit,VM.GuestAgent.Audit,Datastore.Allocate,Datastore.AllocateSpace,Datastore.AllocateTemplate,Datastore.Audit,SDN.Use'
// PROJ-76 Phase 2a: PortalTofu role – least-privilege OpenTofu engine token.
// Sys.Modify (PROJ-87) lets a stack create its own node-level bridge
// (/nodes/{node}/network); without it the apply 403s. SDN.Allocate (PROJ-89)
// lets a stack create its own SDN VNet/subnet.
const TOFU_PRIVS     = 'VM.Allocate,VM.Clone,VM.Config.CPU,VM.Config.Memory,VM.Config.Disk,VM.Config.Network,VM.Config.HWType,VM.Config.Options,VM.Config.Cloudinit,VM.Config.CDROM,VM.PowerMgmt,VM.Audit,Datastore.Allocate,Datastore.AllocateSpace,Pool.Audit,SDN.Use,SDN.Allocate,Sys.Modify'

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

function parseTokenId(tokenId) {
  if (!tokenId) return null
  const idx = tokenId.indexOf('!')
  if (idx === -1) return { user: tokenId, tokenName: '' }
  return { user: tokenId.slice(0, idx), tokenName: tokenId.slice(idx + 1) }
}

function buildCommands(tokenId, roleName, privs) {
  const parsed = parseTokenId(tokenId)
  const isPlaceholder = !tokenId
  const user      = parsed?.user      || `portal-${roleName.toLowerCase()}@pve`
  const tokenName = parsed?.tokenName || `portal-${roleName.toLowerCase()}`
  const lines = [
    `pveum user add ${user} --comment "P3 Portal ${roleName}"`,
    `pveum role add Portal${roleName} --privs "${privs}"`,
    `pveum acl modify / --user ${user} --role Portal${roleName} --propagate 1`,
    `pveum user token add ${user} ${tokenName} --privsep 0`,
  ].join('\n')
  return { lines, isPlaceholder }
}

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`}>
      <polyline points="6 9 12 15 18 9" />
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

function CommandBlock({ tokenId, roleName, privs }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const { lines, isPlaceholder } = buildCommands(tokenId, roleName, privs)

  const copy = () => {
    navigator.clipboard.writeText(lines).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="mt-2 pt-2 border-t border-zinc-100 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
      >
        <ChevronIcon open={open} />
        {t('admin.nodes.pveum_commands_show')}
        {isPlaceholder && (
          <span className="text-zinc-400 dark:text-zinc-600">{t('admin.nodes.pveum_commands_placeholder')}</span>
        )}
      </button>
      {open && (
        <div className="mt-2 relative">
          <pre className="text-xs bg-zinc-900 dark:bg-zinc-950 text-zinc-100 rounded-lg p-3 overflow-x-auto whitespace-pre leading-relaxed">{lines}</pre>
          <button
            type="button"
            onClick={copy}
            className="absolute top-2 right-2 p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
            title={t('admin.nodes.pveum_copy')}
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

const EMPTY = {
  name: '', host: '', port: '', proxmox_node: 'pve', verify_ssl: true,
  poll_interval: 30,
  // Token-ID defaults mirror the Setup Wizard (WizardStep5Tokens + WizardStep6Packer):
  // most users follow proxmox-setup.md verbatim and create exactly these token IDs.
  viewer_token_id:   'portal-viewer@pve!portal-viewer',     viewer_token_secret: '',
  operator_token_id: 'portal-operator@pve!portal-operator', operator_token_secret: '',
  admin_token_id:    'portal-admin@pve!portal-admin',       admin_token_secret: '',
  packer_token_id:   'portal-packer@pve!portal-packer',     packer_token_secret: '',
  // PROJ-76 Phase 2a: optional OpenTofu engine token (only shown/sent when Plus)
  tofu_token_id:     '',                                     tofu_token_secret: '',
  cluster_nodes: [],
}

function PollIntervalTooltip() {
  return (
    <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3 text-xs text-zinc-700 dark:text-zinc-300 pointer-events-none">
      <p className="font-semibold mb-2 text-zinc-900 dark:text-zinc-100">Empfohlene Intervalle:</p>
      <table className="w-full text-left">
        <thead>
          <tr className="text-zinc-400 dark:text-zinc-500 border-b border-zinc-100 dark:border-zinc-800">
            <th className="pb-1 font-medium">Clustergröße</th>
            <th className="pb-1 font-medium">Empfehlung</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
          <tr><td className="py-1 pr-2">1–3 Nodes, &lt;50 VMs</td><td className="py-1">15–30 s</td></tr>
          <tr><td className="py-1 pr-2">4–10 Nodes, 50–200 VMs</td><td className="py-1">30–60 s</td></tr>
          <tr><td className="py-1 pr-2">&gt;10 Nodes, &gt;200 VMs</td><td className="py-1">60–120 s</td></tr>
          <tr><td className="py-1 pr-2">Viele gleichzeitige Nutzer</td><td className="py-1">Wert × 1,5–2</td></tr>
        </tbody>
      </table>
      <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-white dark:bg-zinc-900 border-r border-b border-zinc-200 dark:border-zinc-700" />
    </div>
  )
}

function TokenPairSection({ role, roleName, privs, label, hint, form, set, isEdit, required, formUrl, formVerifySsl, nodeId }) {
  const { t } = useTranslation()
  const [show, setShow] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const idKey  = `${role}_token_id`
  const secKey = `${role}_token_secret`
  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500'
  const canTest = Boolean(form[idKey]) && (Boolean(form[secKey]) || (isEdit && Boolean(nodeId)))

  const handleTokenTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      let result
      if (form[secKey]) {
        result = await testSetupConnection({
          url: formUrl,
          token_id: form[idKey],
          token_secret: form[secKey],
          verify_ssl: formVerifySsl,
        })
      } else {
        result = await testNodeToken(nodeId, role)
      }
      setTestResult(result)
    } catch (ex) {
      setTestResult({ ok: false, error: ex.response?.data?.detail ?? t('admin.nodes.err_connection') })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-2 pb-3 border-b border-zinc-100 dark:border-zinc-800 last:border-0 last:pb-0">
      <div>
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
        {required
          ? <span className="ml-1 text-xs text-red-400">*</span>
          : <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500 italic">{t('common.optional')}</span>
        }
        <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">{t('admin.nodes.token_id')}</label>
          <input
            type="text"
            value={form[idKey]}
            onChange={(e) => { set(idKey, e.target.value); setTestResult(null) }}
            className={inputCls}
            placeholder="user@pam!token"
          />
        </div>
        <div>
          <label className="block text-xs text-zinc-500 dark:text-zinc-400 mb-1">
            {t('admin.nodes.token_secret')}{isEdit && <span className="ml-1 text-zinc-400 font-normal">{t('admin.nodes.token_secret_unchanged')}</span>}
          </label>
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={form[secKey]}
              onChange={(e) => { set(secKey, e.target.value); setTestResult(null) }}
              className={`${inputCls} pr-9`}
              placeholder={isEdit ? '••••••••••••••••' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 btn-ghost"
            >
              <EyeIcon open={show} />
            </button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleTokenTest}
          disabled={!canTest || testing}
          className="btn-secondary"
        >
          {testing ? '…' : t('admin.nodes.test_token_btn')}
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
            {testResult.ok ? `✓ PVE ${testResult.version}` : `✗ ${testResult.error ?? t('common.error')}`}
          </span>
        )}
      </div>
      <CommandBlock tokenId={form[idKey]} roleName={roleName} privs={privs} />
    </div>
  )
}

function ClusterNodesSection({ clusterNodes, onChange }) {
  const { t } = useTranslation()
  const [inputVal, setInputVal] = useState('')
  const inputRef = useRef(null)
  const inputCls = 'flex-1 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500'

  const addNode = () => {
    const name = inputVal.trim()
    if (!name || clusterNodes.includes(name)) { setInputVal(''); return }
    onChange([...clusterNodes, name])
    setInputVal('')
    inputRef.current?.focus()
  }

  const removeNode = (name) => onChange(clusterNodes.filter(n => n !== name))

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addNode() }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t('admin.nodes.cluster_nodes_hint_1')}
        <br />
        <span className="text-zinc-400">{t('admin.nodes.cluster_nodes_hint_2')}</span>
      </p>

      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          className={inputCls}
          placeholder="node-b"
        />
        <button
          type="button"
          onClick={addNode}
          disabled={!inputVal.trim()}
          className="btn-secondary text-xs px-3 py-2"
        >
          {t('admin.nodes.cluster_node_add')}
        </button>
      </div>

      {clusterNodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {clusterNodes.map(name => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
            >
              {name}
              <button
                type="button"
                onClick={() => removeNode(name)}
                className="ml-0.5 text-blue-400 hover:text-blue-600 dark:hover:text-blue-200 leading-none"
                aria-label={t('admin.nodes.cluster_node_remove', { name })}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3 h-3">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NodeFormModal({ node, onClose, onSaved }) {
  const { t } = useTranslation()
  const isEdit = Boolean(node)
  const stacksEnabled = useCapability('stacks')  // PROJ-76 Phase 2a (Plus-only)
  const initialClusterNodes = isEdit ? (node.cluster_nodes ?? []) : []

  const ROLES = [
    { key: 'viewer',   roleName: 'Viewer',   privs: VIEWER_PRIVS,   label: t('admin.nodes.role_viewer_label'),   hint: t('admin.nodes.role_viewer_hint'),   required: true },
    { key: 'operator', roleName: 'Operator', privs: OPERATOR_PRIVS, label: t('admin.nodes.role_operator_label'), hint: t('admin.nodes.role_operator_hint'),  required: false },
    { key: 'admin',    roleName: 'Admin',    privs: ADMIN_PRIVS,    label: t('admin.nodes.role_admin_label'),    hint: t('admin.nodes.role_admin_hint'),     required: false },
    { key: 'packer',   roleName: 'Packer',   privs: PACKER_PRIVS,   label: t('admin.nodes.role_packer_label'),   hint: t('admin.nodes.role_packer_hint'),    required: false },
    // PROJ-76 Phase 2a: OpenTofu engine token – Plus-only, optional per node
    ...(stacksEnabled ? [{ key: 'tofu', roleName: 'Tofu', privs: TOFU_PRIVS, label: t('admin.nodes.role_tofu_label'), hint: t('admin.nodes.role_tofu_hint'), required: false }] : []),
  ]

  const _parsed = isEdit ? parseNodeUrl(node.url) : null

  const [form, setForm] = useState(isEdit
    ? {
        name: node.name, host: _parsed.host, port: _parsed.port, proxmox_node: node.proxmox_node,
        verify_ssl: node.verify_ssl,
        poll_interval: node.poll_interval ?? 30,
        viewer_token_id:   node.viewer_token_id   ?? '',  viewer_token_secret: '',
        operator_token_id: node.operator_token_id ?? '',  operator_token_secret: '',
        admin_token_id:    node.admin_token_id    ?? '',  admin_token_secret: '',
        packer_token_id:   node.packer_token_id   ?? '',  packer_token_secret: '',
        tofu_token_id:     node.tofu_token_id     ?? '',  tofu_token_secret: '',
        cluster_nodes: initialClusterNodes,
      }
    : { ...EMPTY }
  )

  const [isCluster, setIsCluster] = useState(initialClusterNodes.length > 0)
  const [showPollTooltip, setShowPollTooltip] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setTestResult(null) }

  const toggleCluster = () => {
    const next = !isCluster
    setIsCluster(next)
    if (!next) set('cluster_nodes', [])
  }

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const validate = () => {
    if (!form.name.trim()) return t('admin.nodes.err_name_empty')
    if (!form.host.trim()) return t('admin.nodes.err_host_empty')
    if (!form.host.startsWith('http://') && !form.host.startsWith('https://')) return t('admin.nodes.err_url_protocol')
    if (!form.proxmox_node.trim()) return t('admin.nodes.err_node_empty')
    const pi = Number(form.poll_interval)
    if (!Number.isInteger(pi) || pi < 10 || pi > 300) return t('admin.nodes.err_poll_interval')
    for (const r of ROLES) {
      const idVal = form[`${r.key}_token_id`].trim()
      const secVal = form[`${r.key}_token_secret`].trim()
      if (r.required) {
        if (!idVal) return t('admin.nodes.err_token_id_empty', { label: r.label })
        if (!isEdit && !secVal) return t('admin.nodes.err_token_secret_empty', { label: r.label })
      } else {
        // optional: if ID is given, secret must be provided on create; mixed state is invalid
        if (idVal && !isEdit && !secVal) return t('admin.nodes.err_token_secret_empty', { label: r.label })
      }
    }
    if (isCluster && form.cluster_nodes.includes(form.proxmox_node.trim())) {
      return t('admin.nodes.err_node_in_cluster', { node: form.proxmox_node })
    }
    return null
  }

  const handleTest = async () => {
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setTesting(true)
    setTestResult(null)
    try {
      const hasViewerSecret = Boolean(form.viewer_token_secret)
      const hasViewerId     = Boolean(form.viewer_token_id)
      if (isEdit && !hasViewerSecret) {
        const result = await testNodeConnection(node.id)
        setTestResult(result)
      } else if (hasViewerId && hasViewerSecret) {
        const result = await testSetupConnection({
          url: buildNodeUrl(form.host, form.port),
          token_id: form.viewer_token_id,
          token_secret: form.viewer_token_secret,
          verify_ssl: form.verify_ssl,
        })
        setTestResult(result)
      } else {
        setTestResult({ ok: false, error: t('admin.nodes.err_viewer_token_required') })
      }
    } catch (ex) {
      setTestResult({ ok: false, error: ex.response?.data?.detail ?? t('admin.nodes.err_connection') })
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
      const { host, port, ...rest } = form
    const payload = { ...rest, url: buildNodeUrl(host, port), cluster_nodes: isCluster ? form.cluster_nodes : [] }
      if (isEdit) {
        const secretFields = ['viewer_token_secret', 'operator_token_secret', 'admin_token_secret', 'packer_token_secret', 'tofu_token_secret']
        for (const f of secretFields) {
          if (!payload[f]) delete payload[f]
        }
        await updateNode(node.id, payload)
      } else {
        await createNode(payload)
      }
      onSaved()
    } catch (ex) {
      setError(ex.response?.data?.detail ?? t('admin.nodes.err_save'))
    } finally {
      setBusy(false)
    }
  }

  const inputCls = 'w-full px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-200 dark:border-zinc-700 w-full max-w-xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-700 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {isEdit ? t('admin.nodes.modal_edit_title') : t('admin.nodes.modal_create_title')}
          </h2>
          <div className="flex items-center gap-1">
            <ModalHelpButton helpKey="modal.node_form" />
            <button onClick={onClose} className="btn-ghost">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

            {/* Name + PVE-Node */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('admin.nodes.label_name')}</label>
                <input type="text" value={form.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="Heimcluster" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('admin.nodes.label_primary_node')}
                </label>
                <input type="text" value={form.proxmox_node} onChange={(e) => set('proxmox_node', e.target.value)} className={inputCls} placeholder="pve" required />
              </div>
            </div>

            {/* Host + Port */}
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">{t('admin.nodes.label_host')}</label>
                <input type="text" value={form.host} onChange={(e) => set('host', e.target.value)} className={inputCls} placeholder="https://pve01.example.com" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t('admin.nodes.label_port')}
                  <span className="ml-1 text-zinc-400 font-normal">{t('admin.nodes.port_hint')}</span>
                </label>
                <input type="number" min={1} max={65535} value={form.port} onChange={(e) => set('port', e.target.value)} className={inputCls} placeholder="8006" />
              </div>
            </div>

            {/* SSL */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => set('verify_ssl', !form.verify_ssl)}
                className={`relative w-9 h-5 rounded-full transition-colors ${form.verify_ssl ? 'bg-orange-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.verify_ssl ? 'translate-x-4' : ''}`} />
              </button>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{t('admin.nodes.label_verify_ssl')}</span>
            </div>

            {/* Poll-Intervall */}
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('admin.nodes.label_poll_interval')}</label>
                <div className="relative">
                  <button
                    type="button"
                    onMouseEnter={() => setShowPollTooltip(true)}
                    onMouseLeave={() => setShowPollTooltip(false)}
                    onFocus={() => setShowPollTooltip(true)}
                    onBlur={() => setShowPollTooltip(false)}
                    className="w-4 h-4 rounded-full border border-zinc-400 dark:border-zinc-500 text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 hover:border-zinc-600 dark:hover:border-zinc-300 flex items-center justify-center text-[10px] font-semibold leading-none transition-colors"
                    aria-label="Poll-Intervall Hinweis"
                  >
                    i
                  </button>
                  {showPollTooltip && <PollIntervalTooltip />}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={form.poll_interval}
                  onChange={(e) => set('poll_interval', Number(e.target.value))}
                  className="w-28 px-3 py-2 text-sm rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('admin.nodes.poll_interval_hint')}</span>
              </div>
            </div>

            {/* Cluster-Toggle – Core + Plus */}
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={toggleCluster}
                  className={`relative w-9 h-5 rounded-full transition-colors ${isCluster ? 'bg-blue-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
                  aria-checked={isCluster}
                  role="switch"
                >
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isCluster ? 'translate-x-4' : ''}`} />
                </button>
                <div>
                  <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('admin.nodes.cluster_label')}</span>
                  <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">{t('admin.nodes.cluster_hint')}</span>
                </div>
              </div>

              {isCluster && (
                <ClusterNodesSection
                  clusterNodes={form.cluster_nodes}
                  onChange={(nodes) => set('cluster_nodes', nodes)}
                />
              )}
            </div>

            {/* Token sections */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">{t('admin.nodes.api_tokens_label')}</span>
                <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('admin.nodes.api_tokens_hint')}</span>
              </div>
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 space-y-3">
                {ROLES.map(r => (
                  <TokenPairSection
                    key={r.key}
                    role={r.key}
                    roleName={r.roleName}
                    privs={r.privs}
                    label={r.label}
                    hint={r.hint}
                    form={form}
                    set={set}
                    isEdit={isEdit}
                    required={r.required}
                    formUrl={buildNodeUrl(form.host, form.port)}
                    formVerifySsl={form.verify_ssl}
                    nodeId={isEdit ? node.id : null}
                  />
                ))}
              </div>
            </div>

            {/* Connection test */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTest}
                disabled={testing}
                className="btn-secondary text-xs px-3 py-1.5"
              >
                {testing ? t('admin.nodes.testing') : t('admin.nodes.test_btn')}
              </button>
              <span className="text-xs text-zinc-400 dark:text-zinc-500">{t('admin.nodes.test_uses_viewer')}</span>
              {testResult && (
                <span className={`text-xs ${testResult.ok ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                  {testResult.ok ? `✓ PVE ${testResult.version}` : `✗ ${testResult.error ?? t('common.error')}`}
                </span>
              )}
            </div>

            {error && (
              <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
                {error}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
            <button type="button" onClick={onClose} className="btn-secondary transition-colors">
              {t('admin.nodes.cancel')}
            </button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? t('admin.nodes.saving') : t('admin.nodes.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
