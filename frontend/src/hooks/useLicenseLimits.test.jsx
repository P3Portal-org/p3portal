// p3portal.org
import { renderHook, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { useLicenseLimits } from './useLicenseLimits'
import { createQueryWrapper } from '../test-utils'

vi.mock('../api/license', () => ({
  getLicenseStatus: vi.fn(),
}))

import { getLicenseStatus } from '../api/license'

const CORE_RESPONSE = {
  edition: 'core',
  valid: false,
  limits: {
    users:   { current: 3, max: 6, unlimited: false },
    presets: { current: 2, max: 5, unlimited: false },
  },
}

const PLUS_RESPONSE = {
  edition: 'plus_v1',
  valid: true,
  limits: {
    users:   { current: 8, max: null, unlimited: true },
    presets: { current: 4, max: null, unlimited: true },
  },
}

// PROJ-94
const TRIAL_ACTIVE_RESPONSE = {
  edition: 'plus_trial',
  valid: true,
  trial_used: true,
  trial_active: true,
  limits: { users: { current: 1, max: null, unlimited: true } },
}

const TRIAL_EXPIRED_RESPONSE = {
  edition: 'core',
  valid: false,
  trial_used: true,
  trial_active: false,
  limits: { users: { current: 1, max: 6, unlimited: false } },
}

describe('useLicenseLimits', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns limits from API on load', async () => {
    getLicenseStatus.mockResolvedValue(CORE_RESPONSE)
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.userLimit).toEqual({ current: 3, max: 6, unlimited: false })
    expect(result.current.presetLimit).toEqual({ current: 2, max: 5, unlimited: false })
  })

  it('userAtLimit is false when below max', async () => {
    getLicenseStatus.mockResolvedValue(CORE_RESPONSE)
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.userAtLimit).toBe(false)
    expect(result.current.presetAtLimit).toBe(false)
  })

  it('userAtLimit is true when at max', async () => {
    getLicenseStatus.mockResolvedValue({
      ...CORE_RESPONSE,
      limits: {
        users:   { current: 6, max: 6, unlimited: false },
        presets: { current: 5, max: 5, unlimited: false },
      },
    })
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.userAtLimit).toBe(true)
    expect(result.current.presetAtLimit).toBe(true)
  })

  it('never reports atLimit in Plus edition', async () => {
    getLicenseStatus.mockResolvedValue(PLUS_RESPONSE)
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.userAtLimit).toBe(false)
    expect(result.current.presetAtLimit).toBe(false)
  })

  it('returns null limits on API error', async () => {
    getLicenseStatus.mockRejectedValue(new Error('Network error'))
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.userLimit).toBeNull()
    expect(result.current.presetLimit).toBeNull()
    expect(result.current.userAtLimit).toBe(false)
    expect(result.current.presetAtLimit).toBe(false)
  })

  // PROJ-94: trial flags
  it('reports trialActive + isPlus during an active trial', async () => {
    getLicenseStatus.mockResolvedValue(TRIAL_ACTIVE_RESPONSE)
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.isPlus).toBe(true)
    expect(result.current.trialUsed).toBe(true)
    expect(result.current.trialActive).toBe(true)
  })

  it('reports trialUsed but not active/plus after expiry', async () => {
    getLicenseStatus.mockResolvedValue(TRIAL_EXPIRED_RESPONSE)
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.isPlus).toBe(false)
    expect(result.current.trialUsed).toBe(true)
    expect(result.current.trialActive).toBe(false)
  })

  it('defaults trial flags to false in core (no flags)', async () => {
    getLicenseStatus.mockResolvedValue(CORE_RESPONSE)
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.trialUsed).toBe(false)
    expect(result.current.trialActive).toBe(false)
  })

  it('reload re-fetches limits', async () => {
    getLicenseStatus
      .mockResolvedValueOnce(CORE_RESPONSE)
      .mockResolvedValueOnce({
        ...CORE_RESPONSE,
        limits: {
          users:   { current: 5, max: 6, unlimited: false },
          presets: { current: 3, max: 5, unlimited: false },
        },
      })
    const { result } = renderHook(() => useLicenseLimits(), { wrapper: createQueryWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.userLimit.current).toBe(3)

    await act(() => result.current.reload())
    await waitFor(() => expect(result.current.userLimit.current).toBe(5))
  })
})
