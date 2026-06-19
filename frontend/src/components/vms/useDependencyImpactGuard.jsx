// p3portal.org
// PROJ-96: Core-Hook, der eine VM-Aktion mit der Abhängigkeits-Impact-Warnung
// umhüllt. Reine 409-Vertrag-Logik (kein Plus-Import → kein Core-Bundle-Leak;
// im Core-Mode kommt nie ein 409 → der Dialog erscheint nie).
//
//   const { guardedRun, impactModal } = useDependencyImpactGuard()
//   // statt  await stopVm(vmid, node)
//   await guardedRun((confirm) => stopVm(vmid, node, { confirm }), 'Stoppen')
//   // … und irgendwo im JSX:  {impactModal}
//
// guardedRun(apiCall, actionLabel?) ruft apiCall(false). Liefert der Server ein
// 409 dependency_impact, wird der Dialog gezeigt; „Trotzdem fortfahren" ruft
// apiCall(true) und resolved/rejected die ursprüngliche Promise. „Abbrechen"
// rejected mit einem als `cancelled` markierten Fehler, den der Aufrufer
// ignorieren kann (kein Fehler-Toast).
import { useState, useCallback } from 'react'
import DependencyImpactModal from './DependencyImpactModal'

/** Vom Aufrufer abfragbar, um den Abbruch nicht als echten Fehler zu behandeln. */
export class DependencyImpactCancelled extends Error {
  constructor() {
    super('dependency_impact_cancelled')
    this.name = 'DependencyImpactCancelled'
    this.cancelled = true
  }
}

export function isImpactCancelled(err) {
  return !!err?.cancelled
}

export function useDependencyImpactGuard() {
  const [state, setState] = useState(null) // { data, apiCall, label, resolve, reject }

  const guardedRun = useCallback((apiCall, actionLabel) => {
    return Promise.resolve()
      .then(() => apiCall(false))
      .catch((err) => {
        // FastAPI verpackt HTTPException(detail={...}) als {"detail": {...}} →
        // den Vertrag aus dem detail-Feld lesen (kanonisches Muster wie firewallErrMsg).
        const body = err?.response?.data?.detail
        if (
          err?.response?.status === 409 &&
          body && typeof body === 'object' &&
          body.error === 'dependency_impact'
        ) {
          return new Promise((resolve, reject) => {
            setState({ data: body, apiCall, label: actionLabel, resolve, reject })
          })
        }
        throw err
      })
  }, [])

  const onConfirm = useCallback(async () => {
    if (!state) return
    const { apiCall, resolve, reject } = state
    try {
      const r = await apiCall(true)
      resolve(r)
    } catch (e) {
      reject(e)
    } finally {
      setState(null)
    }
  }, [state])

  const onCancel = useCallback(() => {
    if (!state) return
    state.reject(new DependencyImpactCancelled())
    setState(null)
  }, [state])

  const impactModal = state
    ? <DependencyImpactModal data={state.data} actionLabel={state.label} onConfirm={onConfirm} onCancel={onCancel} />
    : null

  return { guardedRun, impactModal }
}
