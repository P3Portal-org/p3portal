// p3portal.org
import p3LogoImg from '../../assets/p3logo.png'
import { Suspense } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../hooks/useAuth'
import { useLicenseLimits } from '../../hooks/useLicenseLimits'
import { useCapability } from '../../hooks/useCapability'
import { useSidebarPins } from '../../features/sidebar_pins/hooks/useSidebarPins'
import PlusBadge from '../common/PlusBadge'
import { PlusComponents } from '../../plus'
// PROJ-64: EC-10 – kein direkter Import aus plus/Approvals/hooks (ESLint)
const UseApprovalCountHost = PlusComponents.UseApprovalCountHost

// Bookmark-Icon für Favoriten-Einträge
function BookmarkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" className="w-4 h-4 shrink-0 text-portal-accent">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  )
}

function P3Logo({ size = 48 }) {
  return <img src={p3LogoImg} width={size} height={size} alt="P3 Portal" aria-hidden="true" style={{ flexShrink: 0, objectFit: 'contain' }} />
}

const NAV_ITEMS = [
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    to: '/compute',
    label: 'Compute Nodes',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
        <rect x="2" y="3" width="20" height="5" rx="1" /><rect x="2" y="10" width="20" height="5" rx="1" />
        <rect x="2" y="17" width="20" height="5" rx="1" />
        <line x1="6" y1="5.5" x2="6.01" y2="5.5" strokeWidth={2} />
        <line x1="6" y1="12.5" x2="6.01" y2="12.5" strokeWidth={2} />
        <line x1="6" y1="19.5" x2="6.01" y2="19.5" strokeWidth={2} />
      </svg>
    ),
  },
  {
    to: '/provisioning',
    label: 'Provisioning',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
  },
  {
    to: '/automation',
    label: 'Automation',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  {
    to: '/image-factory',
    label: 'Image Factory',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    to: '/events',
    label: 'Events',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="12" y2="17" />
      </svg>
    ),
  },
]

export default function V2Sidebar({ onNavClick }) {
  const { t } = useTranslation()
  const { logout, role, username, portalPermissions } = useAuth()
  const navigate = useNavigate()
  const { appVersion } = useLicenseLimits()
  const isPlus = useCapability('sidebar_pins_extended')
  // PROJ-64: Approval-Workflow-Status aus Capabilities (BUG-64-1 Fix)
  const approvalWorkflowEnabled = useCapability('approval_workflow_enabled')
  // PROJ-76: Stacks-Nav nur bei aktiver Plus-Capability
  const canUseStacks = useCapability('stacks')
  const { pins } = useSidebarPins()

  const isAdmin = role === 'admin'
  const isRestricted = role === 'restricted'
  const hasPerm = (perm) => isAdmin || (portalPermissions ?? []).includes(perm)
  const showSystemSettings =
    hasPerm('manage_users') || hasPerm('manage_nodes') ||
    hasPerm('manage_settings') || hasPerm('manage_api_keys')
  // PROJ-80: "Netzwerk" entry – visible if the user may manage node networking
  // (PROJ-79) OR cluster SDN (PROJ-80). The page itself gates each area finer.
  const showNetwork = hasPerm('manage_networks') || hasPerm('manage_sdn')
  // PROJ-90: "Firewall" entry – datacenter/node firewall. Lightweight gate on
  // manage_firewall (matching the Netzwerk entry); node:manage_firewall-only users
  // reach the firewall via the Compute-Node tab (AC-UI-3). The server enforces 403.
  const showFirewall = hasPerm('manage_firewall')

  const location = useLocation()
  const acctTab = new URLSearchParams(location.search).get('tab')
  const acctSub = new URLSearchParams(location.search).get('sub')
  const isMyAccountActive = location.pathname === '/account' && (!acctTab || acctTab === 'konto')
  const isMyRequestsActive = location.pathname === '/account' && acctTab === 'workflow' && acctSub === 'antraege'
  const bottomNavCls = (active) =>
    `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
      active ? 'text-portal-white bg-portal-bg3' : 'text-portal-text2 hover:bg-portal-bg3 hover:text-portal-white'
    }`

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const navLinkCls = ({ isActive }) =>
    `flex items-center gap-2.5 px-4 py-2 text-sm border-l-2 transition-colors ${
      isActive
        ? 'border-portal-accent bg-portal-bg3 text-portal-white'
        : 'border-transparent text-portal-text2 hover:bg-portal-bg3 hover:text-portal-white'
    }`

  const handleClick = () => onNavClick?.()

  return (
    <aside className="w-60 shrink-0 flex flex-col bg-portal-sidebar border-r border-portal-border h-full">
      {/* Logo */}
      <div className="h-[87px] flex items-center px-4 gap-3 shrink-0">
        <P3Logo />
        <div className="flex flex-col leading-none min-w-0 flex-1">
          <span className="text-base font-bold text-portal-white tracking-tight truncate">P3 Portal</span>
          <span className="text-[9px] text-portal-text3 uppercase tracking-widest mt-1">{t('common.tagline')}</span>
        </div>
      </div>

      <hr className="border-portal-border" />

      {/* Navigation */}
      <nav className="flex-1 pt-2 pb-2 overflow-y-auto min-h-0">
        {NAV_ITEMS.filter(({ to }) => {
          if (!isRestricted) return true
          return to === '/dashboard'
        }).map(({ to, label, labelKey, icon }) => (
          <NavLink key={to} to={to} className={navLinkCls} onClick={handleClick}>
            {icon}
            <span>{labelKey ? t(labelKey) : label}</span>
          </NavLink>
        ))}

        {/* PROJ-80: Netzwerk (Node-Interfaces + SDN), gated admin OR manage_networks OR manage_sdn */}
        {!isRestricted && showNetwork && (
          <NavLink to="/network" className={navLinkCls} onClick={handleClick}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
              <rect x="9" y="2" width="6" height="6" rx="1" />
              <rect x="2" y="16" width="6" height="6" rx="1" />
              <rect x="16" y="16" width="6" height="6" rx="1" />
              <path d="M12 8v4M12 12H5v4M12 12h7v4" />
            </svg>
            <span>Netzwerk</span>
          </NavLink>
        )}

        {/* PROJ-90: Firewall (Datacenter + Node), gated admin OR manage_firewall */}
        {!isRestricted && showFirewall && (
          <NavLink to="/firewall" className={navLinkCls} onClick={handleClick}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Firewall</span>
          </NavLink>
        )}

        {/* PROJ-76: Stacks (Plus-only) */}
        {!isRestricted && canUseStacks && (
          <NavLink to="/stacks" className={navLinkCls} onClick={handleClick}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
            <span className="flex-1">{t('stacks.title')}</span>
            <PlusBadge className="w-3.5 h-3.5 text-portal-success" />
          </NavLink>
        )}

        {/* Favoriten-Sektion (PROJ-54) – nur sichtbar wenn ≥1 Pin */}
        {!isRestricted && pins.length > 0 && (
          <>
            <hr className="border-portal-border my-2" />
            <p className="px-4 py-1 text-xs uppercase text-portal-text3 tracking-wider select-none">
              {t('sidebar.favorites')}
            </p>
            {pins.map(pin => (
              <NavLink
                key={pin.id}
                to={pin.route}
                className={navLinkCls}
                onClick={handleClick}
                title={pin.label || pin.route}
              >
                <BookmarkIcon />
                <span className="truncate">{pin.label || pin.route.split('/').pop() || pin.route}</span>
              </NavLink>
            ))}
          </>
        )}

        {/* System Settings – only for admins / permission-gated */}
        {!isRestricted && showSystemSettings && (
          <>
            <hr className="border-portal-border my-2" />
            <NavLink to="/system-settings" className={navLinkCls} onClick={handleClick}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
              <span>System Settings</span>
            </NavLink>
          </>
        )}


      </nav>

      {/* Bottom: Account + persönliche Approval-Links + Logout */}
      <div className="py-2 shrink-0">
        <hr className="border-portal-border mb-2" />
        <NavLink
          to="/account?tab=konto"
          end
          className={() => bottomNavCls(isMyAccountActive)}
          onClick={handleClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
          <span className="truncate">{t('sidebar.my_account')}</span>
          {username && <span className="text-[10px] font-normal opacity-60 truncate max-w-[5rem]">({username})</span>}
        </NavLink>

        {/* PROJ-59/64: persönliche Approval-Sichten unterhalb My Account */}
        {!isRestricted && approvalWorkflowEnabled && (
          <>
            <NavLink
              to="/account?tab=workflow&sub=antraege"
              end
              className={() => bottomNavCls(isMyRequestsActive)}
              onClick={handleClick}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <span className="truncate flex-1">{t('sidebar.my_requests')}</span>
            </NavLink>
            <NavLink
              to="/approvals"
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
                  isActive
                    ? 'text-portal-white bg-portal-bg3'
                    : 'text-portal-text2 hover:bg-portal-bg3 hover:text-portal-white'
                }`
              }
              onClick={handleClick}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
                <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <span className="truncate flex-1">{t('sidebar.to_approve')}</span>
              {/* PROJ-64: EC-10 Render-Prop via UseApprovalCountHost */}
              <Suspense fallback={null}>
                <UseApprovalCountHost render={(count) => count > 0 ? (
                  <span className="ml-auto px-1.5 py-0.5 text-[10px] font-bold rounded-full bg-portal-warn text-portal-bg leading-none">
                    {count > 99 ? '99+' : count}
                  </span>
                ) : null} />
              </Suspense>
            </NavLink>
          </>
        )}

        {/* PROJ-57: Handbuch-Link (Sidebar-Footer, analog Logout) */}
        <NavLink
          to="/help"
          className={({ isActive }) =>
            `flex items-center gap-2.5 px-4 py-2 text-sm transition-colors ${
              isActive
                ? 'text-[var(--accent)] font-medium'
                : 'text-portal-text2 hover:text-portal-text'
            }`
          }
          onClick={handleClick}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" strokeLinecap="round" />
            <circle cx="12" cy="17" r="0.5" fill="currentColor" />
          </svg>
          <span>{t('sidebar.manual')}</span>
        </NavLink>

        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-portal-text2 hover:text-portal-danger transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="w-4 h-4 shrink-0">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span>{t('sidebar.logout')}</span>
        </button>
        {/* PROJ-59: dezenter p3portal.org-Branding-Hinweis */}
        <p className="px-4 pt-3 pb-2 text-[9px] text-portal-text3/70 tracking-wider select-none flex items-center gap-3">
          <span
            title={appVersion ?? 'beta'}
            className={`px-1 py-px text-[9px] font-medium rounded border cursor-default select-none transition-colors shrink-0 ${
              isPlus
                ? 'border-portal-success/50 text-portal-success'
                : 'border-portal-border text-portal-text3/70 hover:text-portal-text2'
            }`}
          >beta</span>
          <a
            href="http://p3portal.org"
            target="_blank"
            rel="noopener noreferrer"
            className="select-text hover:text-portal-text2 hover:underline transition-colors"
          >
            p3portal.org
          </a>
        </p>
        <span className="rq hidden" aria-hidden="true" />
      </div>
    </aside>
  )
}
