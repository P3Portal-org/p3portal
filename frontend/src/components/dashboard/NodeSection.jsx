// p3portal.org
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import NodeCard from './NodeCard'

export default function NodeSection({ nodes, loading, selectedNode, onNodeSelect }) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('widget_nodes_collapsed') === 'true'
  )

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('widget_nodes_collapsed', String(next))
  }

  function handleCardClick(nodeName) {
    onNodeSelect?.(selectedNode === nodeName ? null : nodeName)
  }

  return (
    <section>
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 w-full text-left mb-3 group"
        aria-expanded={!collapsed}
      >
        <span className="text-xs font-semibold text-gray-500 dark:text-zinc-500 uppercase tracking-wider">
          Nodes ({nodes.length})
        </span>
        <span className={`text-gray-400 dark:text-zinc-600 text-[10px] transition-transform duration-150 group-hover:text-gray-600 dark:group-hover:text-zinc-400 ${collapsed ? '-rotate-90' : ''}`}>
          ▼
        </span>
      </button>

      {!collapsed && (
        loading && nodes.length === 0 ? (
          <div className="grid grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-gray-100 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg h-40 animate-pulse" />
            ))}
          </div>
        ) : nodes.length === 0 ? (
          <p className="text-gray-500 dark:text-zinc-500 text-sm">Keine Nodes gefunden.</p>
        ) : (
          <div className={`grid items-start gap-4 ${nodes.length === 1 ? 'grid-cols-1' : nodes.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {nodes.map((n) => {
              const isSelected = selectedNode === n.node
              return (
                <div
                  key={n.node}
                  className="relative group cursor-pointer"
                  onClick={() => handleCardClick(n.node)}
                  role="button"
                  aria-pressed={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && handleCardClick(n.node)}
                >
                  <NodeCard node={n} />
                  <div className={`absolute inset-0 rounded-lg pointer-events-none transition-all ${
                    isSelected
                      ? 'ring-2 ring-portal-accent'
                      : 'ring-0 group-hover:ring-2 ring-portal-accent'
                  }`} />
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/compute/${n.node}`) }}
                      className="text-xs text-portal-accent bg-white dark:bg-zinc-900 px-2 py-0.5 border border-portal-accent/30 hover:bg-portal-accent/10 dark:hover:bg-zinc-800 transition-colors"
                    >
                      Details →
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </section>
  )
}
