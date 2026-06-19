// p3portal.org
// Generischer Error-Boundary für lazy-geladene Komponenten. Fängt einen
// fehlgeschlagenen Chunk-Load (z. B. Netzwerkproblem) ab und zeigt einen
// Fallback statt eines White-Screens (PROJ-75 EC-12).
import { Component } from 'react'

export default class LazyErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback ?? (
        <div className="flex items-center justify-center h-full p-6 text-sm text-gray-500 dark:text-zinc-400 text-center">
          {this.props.message ?? 'Diese Ansicht ist gerade nicht verfügbar. Bitte Netzwerk prüfen und neu laden.'}
        </div>
      )
    }
    return this.props.children
  }
}
