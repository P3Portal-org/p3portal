// p3portal.org
// PROJ-96: Tests für den Core-Impact-Guard (409 dependency_impact → Dialog →
// confirm-Retry; reiner 409-Vertrag, kein Plus-Import).
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useDependencyImpactGuard } from './useDependencyImpactGuard'

function impact409(dependents) {
  const err = new Error('409')
  // Echte Backend-Form: FastAPI verpackt HTTPException(detail={...}) als {"detail": {...}}.
  err.response = {
    status: 409,
    data: { detail: { error: 'dependency_impact', count: dependents.length, dependents } },
  }
  return err
}

// Test-Harness: rendert den Guard und stellt guardedRun + das Ergebnis bereit.
function Harness({ apiCall, onResult }) {
  const { guardedRun, impactModal } = useDependencyImpactGuard()
  return (
    <div>
      <button onClick={() => guardedRun(apiCall, 'Stoppen').then((r) => onResult({ ok: r }), (e) => onResult({ err: e }))}>
        run
      </button>
      {impactModal}
    </div>
  )
}

describe('useDependencyImpactGuard', () => {
  it('runs the action directly when there are no dependents (no dialog)', async () => {
    const apiCall = vi.fn((confirm) => Promise.resolve(`done:${confirm}`))
    const onResult = vi.fn()
    render(<Harness apiCall={apiCall} onResult={onResult} />)
    fireEvent.click(screen.getByText('run'))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: 'done:false' }))
    expect(apiCall).toHaveBeenCalledTimes(1)
    expect(apiCall).toHaveBeenCalledWith(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the impact dialog on 409 and retries with confirm=true on „Trotzdem fortfahren"', async () => {
    const apiCall = vi.fn((confirm) =>
      confirm ? Promise.resolve('confirmed') : Promise.reject(impact409([{ vmid: 200, name: 'web-1', installation: 'prod' }])),
    )
    const onResult = vi.fn()
    render(<Harness apiCall={apiCall} onResult={onResult} />)
    await act(async () => { fireEvent.click(screen.getByText('run')) })

    // Dialog mit dem Abhängigen erscheint
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('web-1')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/Trotzdem fortfahren/))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith({ ok: 'confirmed' }))
    expect(apiCall).toHaveBeenCalledTimes(2)
    expect(apiCall).toHaveBeenNthCalledWith(2, true)
  })

  it('rejects with a cancelled error when the dialog is dismissed', async () => {
    const apiCall = vi.fn((confirm) =>
      confirm ? Promise.resolve('confirmed') : Promise.reject(impact409([{ vmid: 200, name: 'web-1' }])),
    )
    const onResult = vi.fn()
    render(<Harness apiCall={apiCall} onResult={onResult} />)
    await act(async () => { fireEvent.click(screen.getByText('run')) })

    fireEvent.click(screen.getByText(/Abbrechen/))
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    const arg = onResult.mock.calls[0][0]
    expect(arg.err?.cancelled).toBe(true)
    expect(apiCall).toHaveBeenCalledTimes(1) // kein Retry
  })

  it('re-throws non-409 errors unchanged (no dialog)', async () => {
    const boom = Object.assign(new Error('boom'), { response: { status: 403 } })
    const apiCall = vi.fn(() => Promise.reject(boom))
    const onResult = vi.fn()
    render(<Harness apiCall={apiCall} onResult={onResult} />)
    fireEvent.click(screen.getByText('run'))
    await waitFor(() => expect(onResult).toHaveBeenCalled())
    expect(onResult.mock.calls[0][0].err).toBe(boom)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
