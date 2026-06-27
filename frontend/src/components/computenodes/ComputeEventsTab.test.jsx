// p3portal.org
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ComputeEventsTab from './ComputeEventsTab'

vi.mock('../../api/cluster', () => ({
  getNodeTasks: vi.fn(),
}))

import { getNodeTasks } from '../../api/cluster'

const TASKS = [
  { upid: 'UPID:pve1:001', type: 'qmstart',  user: 'root@pam', status: 'OK',      starttime: 1715000000, duration: 5 },
  { upid: 'UPID:pve1:002', type: 'vzdump',   user: 'admin',    status: 'ERROR',   starttime: 1715001000, duration: 120 },
  { upid: 'UPID:pve1:003', type: 'vzevent',  user: 'user1',   status: 'RUNNING',  starttime: 1715002000, duration: null },
]

describe('ComputeEventsTab', () => {
  beforeEach(() => vi.clearAllMocks())

  it('AC-10: fetches tasks when active=true', async () => {
    getNodeTasks.mockResolvedValue(TASKS)
    render(<ComputeEventsTab nodeName="pve1" active={true} />)
    await screen.findByText('qmstart')
    expect(getNodeTasks).toHaveBeenCalledWith('pve1', { limit: 50 })
  })

  it('AC-11: shows Typ, Benutzer, Status, Startzeit, Dauer columns', async () => {
    getNodeTasks.mockResolvedValue(TASKS)
    render(<ComputeEventsTab nodeName="pve1" active={true} />)
    await screen.findByText('qmstart')
    expect(screen.getByText('vzdump')).toBeInTheDocument()
    expect(screen.getByText('root@pam')).toBeInTheDocument()
    expect(screen.getByText('admin')).toBeInTheDocument()
    expect(screen.getByText('5s')).toBeInTheDocument()
    expect(screen.getByText('2m 0s')).toBeInTheDocument()
  })

  it('AC-12: status badges – OK green, RUNNING orange, ERROR red', async () => {
    getNodeTasks.mockResolvedValue(TASKS)
    const { container } = render(<ComputeEventsTab nodeName="pve1" active={true} />)
    await screen.findByText('qmstart')
    // green dot for OK
    expect(container.querySelector('.bg-portal-success')).not.toBeNull()
    // orange dot for RUNNING
    expect(container.querySelector('.bg-portal-accent')).not.toBeNull()
    // red dot for ERROR
    expect(container.querySelector('.bg-portal-danger')).not.toBeNull()
  })

  it('AC-13: shows loading skeleton before data arrives', () => {
    getNodeTasks.mockReturnValue(new Promise(() => {})) // never resolves
    const { container } = render(<ComputeEventsTab nodeName="pve1" active={true} />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('AC-14: shows error message on API failure', async () => {
    getNodeTasks.mockRejectedValue(new Error('Network error'))
    render(<ComputeEventsTab nodeName="pve1" active={true} />)
    expect(await screen.findByText('Ereignisse konnten nicht geladen werden.')).toBeInTheDocument()
  })

  it('shows empty state when task list is empty', async () => {
    getNodeTasks.mockResolvedValue([])
    render(<ComputeEventsTab nodeName="pve1" active={true} />)
    expect(await screen.findByText('Keine Ereignisse gefunden')).toBeInTheDocument()
  })

  it('does NOT fetch when active=false', () => {
    render(<ComputeEventsTab nodeName="pve1" active={false} />)
    expect(getNodeTasks).not.toHaveBeenCalled()
  })

  it('resets and re-fetches when node changes', async () => {
    getNodeTasks.mockResolvedValue(TASKS)
    const { rerender } = render(<ComputeEventsTab nodeName="pve1" active={true} />)
    await screen.findByText('qmstart')

    getNodeTasks.mockResolvedValue([{ upid: 'UPID:pve2:001', type: 'backup', user: 'sys', status: 'OK', starttime: 1715003000, duration: 60 }])
    rerender(<ComputeEventsTab nodeName="pve2" active={true} />)
    await screen.findByText('backup')
    expect(getNodeTasks).toHaveBeenCalledTimes(2)
  })

  it('duration shown as dashes for running tasks', async () => {
    const running = [{ upid: 'UPID:x:001', type: 'job', user: 'u', status: 'RUNNING', starttime: 1715000000, duration: null }]
    getNodeTasks.mockResolvedValue(running)
    render(<ComputeEventsTab nodeName="pve1" active={true} />)
    await screen.findByText('job')
    expect(screen.getByText('–')).toBeInTheDocument()
  })
})
