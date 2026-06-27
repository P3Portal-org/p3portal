// p3portal.org
// PROJ-54v2: Thumbtack/Reißzwecke-Icon in drei Zuständen: gefüllt (gepinnt), leer (nicht gepinnt), disabled (Limit).
export default function PinIcon({ pinned = false, disabled = false, className = 'w-4 h-4', title }) {
  const base = 'transition-colors shrink-0'

  if (disabled) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${base} text-gray-300 dark:text-zinc-600 ${className}`}
        aria-label={title}
        role={title ? 'img' : undefined}
      >
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v3.76z" />
        <path d="M12 17v5" />
        <line x1="4" y1="4" x2="20" y2="20" strokeWidth={1.75} />
      </svg>
    )
  }

  if (pinned) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${base} text-portal-accent ${className}`}
        aria-label={title}
        role={title ? 'img' : undefined}
      >
        <path
          d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v3.76z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth={1.5}
        />
        <path d="M12 17v5" stroke="currentColor" strokeWidth={2} />
      </svg>
    )
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} text-gray-400 dark:text-zinc-500 hover:text-portal-accent ${className}`}
      aria-label={title}
      role={title ? 'img' : undefined}
    >
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v3.76z" />
      <path d="M12 17v5" />
    </svg>
  )
}
