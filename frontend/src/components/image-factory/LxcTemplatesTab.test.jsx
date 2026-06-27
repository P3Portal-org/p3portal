// p3portal.org
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import i18n from '../../i18n'
import LxcTemplatesTab from './LxcTemplatesTab'
import { createQueryWrapper } from '../../test-utils'

// QueryClient + i18n-Provider kombiniert (frischer Client pro render), damit t() echte (deutsche) Werte liefert.
const makeWrap = () => {
  const QW = createQueryWrapper()
  const W = ({ children }) => <I18nextProvider i18n={i18n}><QW>{children}</QW></I18nextProvider>
  W.displayName = 'TestWrap'
  return W
}

vi.mock('../../hooks/useLxcTemplates', () => ({
  useLxcTemplates: vi.fn(),
}))

vi.mock('../../hooks/useAuth', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../api/cluster', () => ({
  deleteLxcTemplate: vi.fn(),
  getPortalNodes: vi.fn(),
  getLxcTemplateStorages: vi.fn(),
}))

import { useLxcTemplates } from '../../hooks/useLxcTemplates'
import { useAuth } from '../../hooks/useAuth'
import { deleteLxcTemplate, getPortalNodes, getLxcTemplateStorages } from '../../api/cluster'

const MOCK_INSTALLED = [
  { volid: 'local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst', portal_node_name: 'pve-main', storage: 'local', size: 512000000 },
]
const MOCK_AVAILABLE = [
  { template: 'ubuntu-24.04-standard_24.04-1_amd64.tar.zst', title: 'Ubuntu 24.04', description: 'Ubuntu LTS', size: 512000000 },
]

function makeHookData(overrides = {}) {
  return {
    available: MOCK_AVAILABLE,
    installed: MOCK_INSTALLED,
    failedNodes: [],
    isLoading: false,
    isError: false,
    errorMessage: null,
    refetch: vi.fn(),
    ...overrides,
  }
}

describe('LxcTemplatesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuth.mockReturnValue({ role: 'admin' })
    useLxcTemplates.mockReturnValue(makeHookData())
    getPortalNodes.mockResolvedValue([{ name: 'pve-main', proxmox_node: 'pve' }])
    getLxcTemplateStorages.mockResolvedValue(['local'])
    deleteLxcTemplate.mockResolvedValue(undefined)
  })

  it('renders_loading_state', () => {
    useLxcTemplates.mockReturnValue(makeHookData({ isLoading: true }))
    render(<LxcTemplatesTab />, { wrapper: makeWrap() })
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
    expect(screen.queryByText('Ubuntu 24.04')).toBeNull()
  })

  it('renders_installed_templates', () => {
    render(<LxcTemplatesTab />, { wrapper: makeWrap() })
    expect(screen.getByText('local:vztmpl/ubuntu-24.04-standard_24.04-1_amd64.tar.zst')).toBeTruthy()
    expect(screen.getByText('Ubuntu 24.04')).toBeTruthy()
  })

  it('download_button_opens_modal', async () => {
    render(<LxcTemplatesTab />, { wrapper: makeWrap() })
    const downloadBtn = screen.getByRole('button', { name: /download/i })
    fireEvent.click(downloadBtn)
    await waitFor(() => expect(getPortalNodes).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByText('LXC Template herunterladen')).toBeTruthy())
  })

  it('delete_shows_confirmation', async () => {
    render(<LxcTemplatesTab />, { wrapper: makeWrap() })
    const deleteBtn = screen.getByRole('button', { name: /löschen/i })
    fireEvent.click(deleteBtn)
    expect(screen.getByText('Löschen?')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Ja$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /nein/i })).toBeTruthy()
  })

  it('upload_button_visible_for_admin', () => {
    useAuth.mockReturnValue({ role: 'admin' })
    render(<LxcTemplatesTab />, { wrapper: makeWrap() })
    expect(screen.getByRole('button', { name: /upload/i })).toBeTruthy()
  })
})
