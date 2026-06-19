// p3portal.org
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { completeSetup } from '../../api/setup'
import { uploadLicense, startTrial } from '../../api/license'

function Row({ label, value }) {
  return (
    <div className="flex items-start gap-4 py-2 border-b border-zinc-100 dark:border-zinc-800 last:border-0">
      <span className="text-sm text-zinc-500 dark:text-zinc-400 w-44 shrink-0">{label}</span>
      <span className="text-sm text-zinc-900 dark:text-zinc-100 break-all">{value || '—'}</span>
    </div>
  )
}

export default function WizardStep7Complete({ data, onBack, onComplete }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploadLic, setUploadLic] = useState(false)
  const [licenseFile, setLicenseFile] = useState(null)
  const [licenseError, setLicenseError] = useState('')
  const [startTrialOn, setStartTrialOn] = useState(false)  // PROJ-94
  const fileRef = useRef(null)

  const hasTokens = data.viewer_token_id || data.operator_token_id || data.admin_token_id
  const isPostgres = data.db_type === 'postgresql'

  const handleComplete = async () => {
    setError('')
    setLicenseError('')
    setBusy(true)
    try {
      const result = await completeSetup()

      // Auto-Login: JWT direkt aus Setup-Complete-Response (Option A)
      if (result?.access_token) {
        sessionStorage.setItem('token', result.access_token)
      }

      // Optionaler Lizenz-Upload nach JWT-Erhalt (Upload-EP ist auth-pflichtig)
      if (uploadLic && licenseFile) {
        try {
          await uploadLicense(licenseFile)
        } catch (licEx) {
          setLicenseError(
            licEx.response?.status === 422
              ? t('setup.s7_err_lic_invalid')
              : licEx.response?.data?.detail ?? t('setup.s7_err_lic_upload')
          )
          setBusy(false)
          return
        }
      } else if (startTrialOn) {
        // PROJ-94: optionaler 30-Tage-Test (trial/start ist auth-pflichtig → nach JWT)
        try {
          await startTrial()
        } catch {
          setLicenseError(t('setup.s7_err_trial'))
          setBusy(false)
          return
        }
      }

      onComplete(result)
    } catch (ex) {
      setError(ex.response?.data?.detail ?? t('setup.s7_err_complete'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100 mb-1">{t('setup.s7_title')}</h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {t('setup.s7_subtitle')}
        </p>
      </div>

      {/* Datenbank */}
      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-4 py-2">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">{t('setup.s7_sec_db')}</p>
        <Row label={t('setup.s7_row_type')} value={isPostgres ? 'PostgreSQL' : t('setup.s7_sqlite_val')} />
        {isPostgres && (
          <>
            <Row label={t('setup.field_host')} value={`${data.db_host}:${data.db_port}`} />
            <Row label={t('setup.s7_row_db_name')} value={data.db_database} />
            <Row label={t('setup.s7_row_username')} value={data.db_username} />
            <Row label={t('setup.s7_row_restart')} value={t('setup.s7_row_restart_val')} />
          </>
        )}
      </div>

      {/* Admin */}
      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-4 py-2">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">{t('setup.s7_sec_admin')}</p>
        <Row label={t('setup.s7_row_username')} value={data.username} />
        <Row label={t('setup.s7_row_password')} value="●●●●●●●●●●●●" />
      </div>

      {/* Proxmox-Node */}
      <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-4 py-2">
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">{t('setup.s7_sec_proxmox')}</p>
        <Row label={t('setup.field_name')} value={data.node_name} />
        <Row label={t('setup.s7_row_pve_url')} value={data.node_url} />
        <Row label={t('setup.s7_row_pve_node')} value={data.node_proxmox_node} />
        <Row label={t('setup.s7_row_ssl')} value={data.node_verify_ssl ? t('setup.s7_row_yes') : t('setup.s7_row_no')} />
      </div>

      {/* Tokens */}
      {hasTokens && (
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-4 py-2">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">{t('setup.s7_sec_tokens')}</p>
          {data.viewer_token_id && <Row label={t('setup.s7_row_viewer')} value={data.viewer_token_id} />}
          {data.operator_token_id && <Row label={t('setup.s7_row_operator')} value={data.operator_token_id} />}
          {data.admin_token_id && <Row label={t('setup.s7_row_admin_token')} value={data.admin_token_id} />}
        </div>
      )}

      {/* Packer */}
      {(data.packer_token_id || data.packer_http_ip) && (
        <div className="bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-4 py-2">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">{t('setup.s7_sec_packer')}</p>
          {data.packer_token_id && <Row label={t('setup.s7_row_packer')} value={data.packer_token_id} />}
          {data.packer_http_ip && <Row label={t('setup.s7_row_builder_ip')} value={data.packer_http_ip} />}
        </div>
      )}

      {/* Sicherheits-Hinweis */}
      <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4 flex gap-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <p className="text-sm text-green-700 dark:text-green-300">
          {t('setup.s7_security_hint')}
        </p>
      </div>

      {/* Lizenz-Upload-Toggle */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('setup.s7_lic_title')}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t('setup.s7_lic_hint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!uploadLic) setStartTrialOn(false); setUploadLic((v) => !v); setLicenseError('') }}
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${uploadLic ? 'bg-orange-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${uploadLic ? 'translate-x-5' : ''}`} />
          </button>
        </div>

        {uploadLic && (
          <div className="space-y-2">
            <label className="block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {t('setup.s7_lic_file_label')} <span className="text-zinc-400 font-normal">(.lic)</span>
            </label>
            <div
              className="border-2 border-dashed border-zinc-300 dark:border-zinc-600 rounded-lg p-4 text-center cursor-pointer hover:border-orange-400 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              {licenseFile ? (
                <p className="text-sm text-zinc-700 dark:text-zinc-300">{licenseFile.name}</p>
              ) : (
                <p className="text-sm text-zinc-400">{t('setup.s7_lic_drop')}</p>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".lic,.json"
              className="sr-only"
              onChange={(e) => { setLicenseFile(e.target.files?.[0] ?? null); setLicenseError('') }}
            />
            {licenseError && (
              <p className="text-xs text-red-500">{licenseError}</p>
            )}
          </div>
        )}
      </div>

      {/* PROJ-94: 30-Tage-Test starten (alternativ zum Lizenz-Upload) */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('setup.s7_trial_title')}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              {t('setup.s7_trial_hint')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { if (!startTrialOn) { setUploadLic(false); setLicenseFile(null) } setStartTrialOn((v) => !v); setLicenseError('') }}
            className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${startTrialOn ? 'bg-orange-500' : 'bg-zinc-300 dark:bg-zinc-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${startTrialOn ? 'translate-x-5' : ''}`} />
          </button>
        </div>
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
        <button
          type="button"
          onClick={handleComplete}
          disabled={busy || (uploadLic && !licenseFile)}
          className="btn-primary"
        >
          {busy ? t('setup.s7_completing') : t('setup.s7_finish')}
        </button>
      </div>
    </div>
  )
}
