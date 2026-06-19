// p3portal.org
// PROJ-94: LicenseSectionAdmin — trial start button visibility + start flow + trial hints.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import LicenseSectionAdmin from './LicenseSectionAdmin'

vi.mock('../../api/license', () => ({
  getLicenseStatus:  vi.fn(),
  getLicenseDetails: vi.fn(),
  uploadLicense:     vi.fn(),
  deactivateLicense: vi.fn(),
  startTrial:        vi.fn(),
}))

import {
  getLicenseStatus,
  getLicenseDetails,
  startTrial,
} from '../../api/license'

const iso = (offsetDays) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)

// Status (/api/license/status, drives useLicenseLimits → trial flags + isPlus)
const STATUS = {
  core:        { edition: 'core',       valid: false, trial_used: false, trial_active: false, limits: {} },
  validLic:    { edition: 'plus_v1',    valid: true,  trial_used: false, trial_active: false, limits: {} },
  trialActive: { edition: 'plus_trial', valid: true,  trial_used: true,  trial_active: true,  limits: {} },
  trialExpired:{ edition: 'core',       valid: false, trial_used: true,  trial_active: false, limits: {} },
}
// Details (/api/license/details, drives the section display)
const DETAILS = {
  core:         { edition: 'core',       valid: false, reason: 'missing' },
  validLic:     { edition: 'plus_v1',    valid: true,  reason: null, contact_name: 'Acme', expiry: iso(365) },
  trialActive:  { edition: 'plus_trial', valid: true,  reason: 'trial', expiry: iso(15) },
  trialExpired: { edition: 'core',       valid: false, reason: 'trial_expired', expiry: iso(-2) },
}

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <LicenseSectionAdmin />
      </I18nextProvider>
    </QueryClientProvider>
  )
}

const startBtn = () => screen.queryByRole('button', { name: '30-Tage-Test starten' })

describe('LicenseSectionAdmin – PROJ-94 trial', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the start-trial button in plain Core (trial never used)', async () => {
    getLicenseStatus.mockResolvedValue(STATUS.core)
    getLicenseDetails.mockResolvedValue(DETAILS.core)
    renderSection()
    await waitFor(() => expect(startBtn()).toBeTruthy())
  })

  it('hides the start-trial button when a valid license is active', async () => {
    getLicenseStatus.mockResolvedValue(STATUS.validLic)
    getLicenseDetails.mockResolvedValue(DETAILS.validLic)
    renderSection()
    // wait until the section settled (deactivate button is real-license only)
    await screen.findByRole('button', { name: 'Lizenz deaktivieren' })
    expect(startBtn()).toBeNull()
  })

  it('during an active trial: no start button, no deactivate, shows days left', async () => {
    getLicenseStatus.mockResolvedValue(STATUS.trialActive)
    getLicenseDetails.mockResolvedValue(DETAILS.trialActive)
    renderSection()
    await screen.findByText(/noch \d+ Tage/)
    expect(startBtn()).toBeNull()
    expect(screen.queryByRole('button', { name: 'Lizenz deaktivieren' })).toBeNull()
  })

  it('after expiry: no start button, shows expired hint + p3portal.org link', async () => {
    getLicenseStatus.mockResolvedValue(STATUS.trialExpired)
    getLicenseDetails.mockResolvedValue(DETAILS.trialExpired)
    renderSection()
    const link = await screen.findByRole('link', { name: 'p3portal.org' })
    expect(link.getAttribute('href')).toBe('http://p3portal.org')
    expect(startBtn()).toBeNull()
  })

  it('starting the trial calls the API and shows a success message', async () => {
    getLicenseStatus.mockResolvedValue(STATUS.core)
    getLicenseDetails.mockResolvedValue(DETAILS.core)
    startTrial.mockResolvedValue({ edition: 'plus_trial', valid: true, trial_active: true })
    renderSection()
    const btn = await screen.findByRole('button', { name: '30-Tage-Test starten' })
    fireEvent.click(btn)
    await waitFor(() => expect(startTrial).toHaveBeenCalledTimes(1))
    await screen.findByText(/Testzeitraum gestartet/)
  })

  it('shows a clear message on 409 valid_license_present', async () => {
    getLicenseStatus.mockResolvedValue(STATUS.core)
    getLicenseDetails.mockResolvedValue(DETAILS.core)
    startTrial.mockRejectedValue({ response: { status: 409, data: { detail: 'valid_license_present' } } })
    renderSection()
    const btn = await screen.findByRole('button', { name: '30-Tage-Test starten' })
    fireEvent.click(btn)
    await screen.findByText('Es ist bereits eine gültige Lizenz aktiv.')
  })

  it('shows a clear message on 409 trial_already_used', async () => {
    getLicenseStatus.mockResolvedValue(STATUS.core)
    getLicenseDetails.mockResolvedValue(DETAILS.core)
    startTrial.mockRejectedValue({ response: { status: 409, data: { detail: 'trial_already_used' } } })
    renderSection()
    const btn = await screen.findByRole('button', { name: '30-Tage-Test starten' })
    fireEvent.click(btn)
    await screen.findByText(/bereits genutzt/)
  })
})
