// p3portal.org
import { useState, useEffect } from 'react'
import api from '../../api/client'
import { renderMarkdown } from './DescriptionPanel'

export default function PageDescription({ pageId, fallback = 'Auswählen' }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!pageId) return
    setLoading(true)
    setContent(null)
    api.get(`/api/pages/${pageId}`)
      .then(res => setContent(res.data.content ?? null))
      .catch(() => setContent(null))
      .finally(() => setLoading(false))
  }, [pageId])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <svg className="animate-spin w-5 h-5 text-portal-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      </div>
    )
  }

  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-sm text-gray-500 dark:text-zinc-400">{fallback}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-10 space-y-1.5">
        {renderMarkdown(content)}
      </div>
    </div>
  )
}
