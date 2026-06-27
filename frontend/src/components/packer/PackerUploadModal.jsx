// p3portal.org
import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { uploadPackerDefinition } from '../../api/packer'

export default function PackerUploadModal({ onClose, onUploaded }) {
  const { t } = useTranslation()
  const [zipFile, setZipFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!zipFile) {
      setError(t('packer.upload_select_file'))
      return
    }
    setUploading(true)
    setError(null)
    try {
      await uploadPackerDefinition(zipFile)
      onUploaded()
      onClose()
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(typeof detail === 'string' ? detail : t('packer.upload_failed'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-700 w-full max-w-lg mx-4 shadow-xl rounded-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('packer.upload_title')}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300 transition-colors"
            aria-label={t('packer.close')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* ZIP drop zone */}
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-zinc-300">
              {t('packer.upload_archive_label')} <span className="text-portal-danger">*</span>
              <span className="ml-1 text-xs text-gray-400 dark:text-zinc-500">(.zip)</span>
            </label>
            <div
              className="border border-dashed border-gray-300 dark:border-zinc-600 px-4 py-5 flex flex-col items-center gap-2 cursor-pointer hover:border-portal-accent/50 transition-colors"
              onClick={() => inputRef.current?.click()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-gray-300 dark:text-zinc-600">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {zipFile ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-900 dark:text-zinc-100 truncate max-w-xs">{zipFile.name}</span>
                  <button
                    type="button"
                    onClick={e => { e.stopPropagation(); setZipFile(null) }}
                    className="text-gray-400 hover:text-gray-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                    aria-label={t('packer.remove')}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-400 dark:text-zinc-500">{t('packer.upload_dropzone')}</span>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={e => setZipFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {/* Structure hint */}
          <div className="bg-gray-50 dark:bg-zinc-800/60 border border-gray-200 dark:border-zinc-700 px-4 py-3 space-y-1.5 rounded">
            <p className="text-xs font-medium text-gray-600 dark:text-zinc-400">{t('packer.upload_structure_hint')}</p>
            <pre className="text-xs text-gray-500 dark:text-zinc-500 leading-relaxed font-mono">{t('packer.upload_structure_tree')}</pre>
            <p className="text-xs text-gray-400 dark:text-zinc-600">
              {t('packer.upload_keys_hint_prefix')}<code className="font-mono">files/sysadm</code>{t('packer.upload_keys_hint_suffix')}
            </p>
          </div>

          {error && (
            <div className="bg-portal-danger/10 border border-portal-danger/30 px-4 py-3 text-sm text-portal-danger">
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
            >
              {t('packer.cancel')}
            </button>
            <button
              type="submit"
              disabled={uploading}
              className="btn-primary flex-1 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                  </svg>
                  {t('packer.uploading')}
                </>
              ) : t('packer.upload')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
