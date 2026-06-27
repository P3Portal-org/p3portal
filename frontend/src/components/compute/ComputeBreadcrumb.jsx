// p3portal.org
import { Link } from 'react-router-dom'

export default function ComputeBreadcrumb({ node }) {
  return (
    <nav className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-zinc-400">
      <Link to="/compute" className="hover:text-portal-accent transition-colors">
        Compute Nodes
      </Link>
      {node && (
        <>
          <span className="text-gray-300 dark:text-zinc-600">/</span>
          <span className="text-gray-900 dark:text-zinc-100 font-medium">{node}</span>
        </>
      )}
    </nav>
  )
}
