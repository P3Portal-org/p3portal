// p3portal.org
// PROJ-94 AC-START-3: the Setup-Wizard license step offers a "start 30-day trial"
// toggle, mutually exclusive with the license-upload toggle, and starts the trial
// (after completeSetup, so the JWT exists for the auth-gated trial/start endpoint).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import WizardStep7Complete from './WizardStep7Complete'

vi.mock('../../api/setup', () => ({ completeSetup: vi.fn() }))
vi.mock('../../api/license', () => ({ uploadLicense: vi.fn(), startTrial: vi.fn() }))

import { completeSetup } from '../../api/setup'
import { uploadLicense, startTrial } from '../../api/license'

const DATA = {
  db_type: 'sqlite', username: 'admin', node_name: 'pve1',
  node_url: 'https://pve:8006', node_proxmox_node: 'pve1', node_verify_ssl: true,
}

function renderStep(props = {}) {
  const onComplete = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <WizardStep7Complete data={DATA} onBack={() => {}} onComplete={onComplete} {...props} />
    </I18nextProvider>
  )
  return { onComplete }
}

const trialToggle = () =>
  screen.getByText('30-Tage-Test starten').closest('div').parentElement.querySelector('button[type="button"]')
const licToggle = () =>
  screen.getByText('Plus-Lizenz jetzt hochladen').closest('div').parentElement.querySelector('button[type="button"]')

describe('WizardStep7Complete – PROJ-94 trial toggle (AC-START-3)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the trial toggle next to the license-upload toggle', () => {
    renderStep()
    expect(screen.getByText('30-Tage-Test starten')).toBeTruthy()
    expect(screen.getByText('Plus-Lizenz jetzt hochladen')).toBeTruthy()
  })

  it('trial and license-upload toggles are mutually exclusive', () => {
    renderStep()
    // enabling the license upload shows the drop-zone
    fireEvent.click(licToggle())
    expect(screen.getByText('Klicken zum Auswählen oder Datei hierher ziehen')).toBeTruthy()
    // enabling the trial must switch the license upload OFF again → drop-zone gone
    fireEvent.click(trialToggle())
    expect(screen.queryByText('Klicken zum Auswählen oder Datei hierher ziehen')).toBeNull()
  })

  it('starts the trial AFTER completeSetup when the trial toggle is on', async () => {
    completeSetup.mockResolvedValue({ access_token: 'jwt-xyz' })
    startTrial.mockResolvedValue({ edition: 'plus_trial', valid: true })
    const { onComplete } = renderStep()
    fireEvent.click(trialToggle())
    fireEvent.click(screen.getByRole('button', { name: /Setup abschließen/ }))
    await waitFor(() => expect(startTrial).toHaveBeenCalledTimes(1))
    expect(completeSetup).toHaveBeenCalledTimes(1)
    expect(uploadLicense).not.toHaveBeenCalled()
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
  })

  it('does NOT start a trial when neither toggle is on', async () => {
    completeSetup.mockResolvedValue({ access_token: 'jwt-xyz' })
    const { onComplete } = renderStep()
    fireEvent.click(screen.getByRole('button', { name: /Setup abschließen/ }))
    await waitFor(() => expect(onComplete).toHaveBeenCalled())
    expect(startTrial).not.toHaveBeenCalled()
    expect(uploadLicense).not.toHaveBeenCalled()
  })
})
