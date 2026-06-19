// p3portal.org
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider } from './hooks/useAuth'
import { ThemeProvider } from './hooks/useTheme'
import { SetupStatusProvider, useSetupStatus } from './hooks/useSetupStatus'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import SetupPage from './pages/SetupPage'
import DashboardPage from './pages/DashboardPage'
import GroupsPage from './features/groups/Page'
// PROJ-64: Approvals-Routen nach plus/Approvals/ migriert – via Registry lazy geladen
import { Suspense } from 'react'
import { PlusComponents } from './plus'
const ApprovalsPage = PlusComponents.ApprovalsPage
const ApprovalPendingPage = PlusComponents.ApprovalPendingPage
// PROJ-76: Stacks-Routen via Plus-Registry lazy geladen
const StacksListPage = PlusComponents.StacksListPage
const StackEditorPage = PlusComponents.StackEditorPage
const StackDetailPage = PlusComponents.StackDetailPage
import ChangePasswordPage from './pages/ChangePasswordPage'
import PermissionsPage from './pages/PermissionsPage'
import NotificationsHubPage from './features/notifications/Page'
import VmDetailPage from './pages/VmDetailPage'

// PROJ-57: Help-Modul
import HelpPage from './features/help/Page'
import { HelpSlideOverProvider } from './features/help/components/HelpSlideOverContext'

// V2 pages
import ComputeNodesPage from './pages/v2/ComputeNodesPage'
import NodeDetailPage from './pages/v2/NodeDetailPage'
import NetworkPage from './pages/v2/NetworkPage'
import FirewallPage from './pages/v2/FirewallPage'
import ProvisioningPage from './pages/v2/ProvisioningPage'
import AutomationPage from './pages/v2/AutomationPage'
import ImageFactoryPage from './pages/v2/ImageFactoryPage'
import EventsPage from './pages/v2/EventsPage'
import SystemSettingsPage from './pages/v2/SystemSettingsPage'
import MyAccountPage from './pages/v2/MyAccountPage'

function ProtectedLayout({ children, requiredRole, requiredPermission }) {
  return (
    <ProtectedRoute requiredRole={requiredRole} requiredPermission={requiredPermission}>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  )
}


function AppRoutes() {
  const { setupRequired } = useSetupStatus()
  const location = useLocation()

  if (setupRequired === null) {
    return (
      <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 flex items-center justify-center">
        <span className="text-zinc-400 text-sm">Laden…</span>
      </div>
    )
  }

  if (setupRequired && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* ── Core Routes ──────────────────────────────────────────────────── */}
      <Route path="/dashboard" element={<ProtectedLayout><DashboardPage /></ProtectedLayout>} />
      <Route path="/permissions" element={<ProtectedLayout><PermissionsPage /></ProtectedLayout>} />
      <Route path="/announcements" element={<ProtectedLayout><NotificationsHubPage /></ProtectedLayout>} />
      <Route path="/vm/:node/:type/:vmid" element={<ProtectedLayout><VmDetailPage /></ProtectedLayout>} />
      <Route path="/change-password" element={<ProtectedRoute><ChangePasswordPage /></ProtectedRoute>} />

      {/* ── V2 Routes ────────────────────────────────────────────────────── */}
      <Route path="/compute" element={<ProtectedLayout><ComputeNodesPage /></ProtectedLayout>} />
      <Route path="/compute/:node" element={<ProtectedLayout><NodeDetailPage /></ProtectedLayout>} />
      <Route path="/network" element={<ProtectedLayout><NetworkPage /></ProtectedLayout>} />
      <Route path="/firewall" element={<ProtectedLayout><FirewallPage /></ProtectedLayout>} />
      <Route path="/provisioning" element={<ProtectedLayout><ProvisioningPage /></ProtectedLayout>} />
      <Route path="/automation" element={<ProtectedLayout><AutomationPage /></ProtectedLayout>} />
      <Route path="/image-factory" element={<ProtectedLayout><ImageFactoryPage /></ProtectedLayout>} />
      <Route path="/events" element={<ProtectedLayout><EventsPage /></ProtectedLayout>} />
      <Route path="/events/:id" element={<ProtectedLayout><EventsPage /></ProtectedLayout>} />
      <Route path="/system-settings" element={<ProtectedLayout><SystemSettingsPage /></ProtectedLayout>} />
      <Route path="/account" element={<ProtectedLayout><MyAccountPage /></ProtectedLayout>} />
      <Route path="/admin/groups" element={<ProtectedLayout requiredPermission="manage_groups"><GroupsPage /></ProtectedLayout>} />
      <Route path="/help" element={<ProtectedLayout><HelpPage /></ProtectedLayout>} />

      {/* ── PROJ-50: Approval-Workflow ────────────────────────────────────── */}
      <Route path="/approvals" element={<ProtectedLayout><Suspense fallback={null}><ApprovalsPage /></Suspense></ProtectedLayout>} />
      <Route path="/approvals/pending/:approvalId" element={<ProtectedLayout><Suspense fallback={null}><ApprovalPendingPage /></Suspense></ProtectedLayout>} />

      {/* ── PROJ-76: Stacks (Plus-only; im Core-Build undefined → Redirect) ── */}
      <Route path="/stacks" element={<ProtectedLayout>{StacksListPage ? <Suspense fallback={null}><StacksListPage /></Suspense> : <Navigate to="/dashboard" replace />}</ProtectedLayout>} />
      <Route path="/stacks/new" element={<ProtectedLayout>{StackEditorPage ? <Suspense fallback={null}><StackEditorPage /></Suspense> : <Navigate to="/dashboard" replace />}</ProtectedLayout>} />
      <Route path="/stacks/:id" element={<ProtectedLayout>{StackDetailPage ? <Suspense fallback={null}><StackDetailPage /></Suspense> : <Navigate to="/dashboard" replace />}</ProtectedLayout>} />
      <Route path="/stacks/:id/edit" element={<ProtectedLayout>{StackEditorPage ? <Suspense fallback={null}><StackEditorPage /></Suspense> : <Navigate to="/dashboard" replace />}</ProtectedLayout>} />

      {/* ── Legacy redirects (V1 routes) ─────────────────────────────────── */}
      <Route path="/playbooks" element={<Navigate to="/provisioning" replace />} />
      <Route path="/builder" element={<Navigate to="/image-factory" replace />} />
      <Route path="/logs" element={<Navigate to="/events" replace />} />
      <Route path="/logs/:id" element={<Navigate to="/events" replace />} />
      <Route path="/jobs" element={<Navigate to="/events" replace />} />
      <Route path="/jobs/:id" element={<Navigate to="/events" replace />} />
      <Route path="/scheduled-jobs" element={<Navigate to="/automation" replace />} />
      <Route path="/profile" element={<Navigate to="/account" replace />} />
      <Route path="/admin/users" element={<Navigate to="/system-settings" replace />} />
      <Route path="/admin/settings" element={<Navigate to="/system-settings" replace />} />
      <Route path="/admin/nodes" element={<Navigate to="/system-settings" replace />} />
      <Route path="/admin/api-keys" element={<Navigate to="/system-settings" replace />} />
      {/* ── PROJ-59: Restrukturierungs-Redirects (Sub-Tabs in System Settings) ── */}
      <Route path="/admin/pools" element={<Navigate to="/system-settings?tab=users&sub=pools" replace />} />
      <Route path="/admin/playbook-permissions" element={<Navigate to="/system-settings?tab=users&sub=playbook_permissions" replace />} />
      <Route path="/admin/approval-rules" element={<Navigate to="/system-settings?tab=portal&sub=approval_workflow" replace />} />

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <SetupStatusProvider>
          <AuthProvider>
            <HelpSlideOverProvider>
              <AppRoutes />
            </HelpSlideOverProvider>
          </AuthProvider>
        </SetupStatusProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
