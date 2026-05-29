// p3portal.org
import { Suspense } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth'
import { usePermissions } from '../hooks/usePermissions'
import { usePackerTemplates } from '../hooks/usePackerTemplates'
import { useCapability } from '../hooks/useCapability'
import CapabilityCard from '../components/permissions/CapabilityCard'
import RbacAssignmentsTable from '../components/permissions/RbacAssignmentsTable'
import { useMyNodeAssignments } from '../features/node_assignments/hooks/useNodeAssignments'
import { PlusComponents } from '../plus'
import HelpButton from '../features/help/components/HelpButton'
import Watermark from '../components/common/Watermark'
const AllowedPlaybooksSection = PlusComponents.AllowedPlaybooksSection

const CAP_KEY_ORDER = ['vms', 'storage', 'sdn', 'nodes', 'access', 'dc']

const ROLE_BADGE = {
  admin:    'bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-400',
  operator: 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400',
  viewer:   'bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-zinc-400',
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-3">
        {title}
      </h2>
      {children}
    </section>
  )
}

function SkeletonBlock() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="h-24 bg-gray-100 dark:bg-zinc-800 animate-pulse" />
      ))}
    </div>
  )
}

function PackerTemplatesSection({ role }) {
  const { t } = useTranslation()
  const { templates, loading } = usePackerTemplates()
  const isRestricted = role === 'viewer'
  const visible = isRestricted ? templates.filter(tt => !tt.required_role) : templates

  return (
    <Section title={t('permissions.section_allowed_packer')}>
      {loading ? (
        <div className="space-y-1">{[1, 2].map(i => <div key={i} className="h-8 bg-gray-100 dark:bg-zinc-800 animate-pulse" />)}</div>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">{t('permissions.no_templates')}</p>
      ) : (
        <ul className="space-y-1">
          {visible.map(tt => (
            <li key={tt.id}>
              <Link
                to="/packer"
                className="flex items-center px-3 py-2 text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-orange-300 dark:hover:border-orange-700 transition-colors rounded-lg"
              >
                <span className="text-gray-800 dark:text-zinc-200">{tt.name}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function ProxmoxView({ perms }) {
  const { t } = useTranslation()
  const caps = perms?.capabilities ?? {}
  const groups = perms?.groups ?? []

  const orderedKeys = [
    ...CAP_KEY_ORDER.filter(k => caps[k]),
    ...Object.keys(caps).filter(k => !CAP_KEY_ORDER.includes(k)),
  ]
  const hasAnyCaps = orderedKeys.length > 0

  return (
    <>
      <Section title={t('permissions.section_account')}>
        <div className="space-y-2">
          <div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mb-0.5">{t('permissions.label_username')}</p>
            <p className="text-sm font-mono text-gray-800 dark:text-zinc-200">{perms.username}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mb-1">{t('permissions.label_groups')}</p>
            {groups.length === 0 ? (
              <span className="text-xs bg-gray-100 dark:bg-zinc-800 text-gray-500 dark:text-zinc-400 px-2 py-0.5">
                {t('permissions.no_groups')}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {groups.map(g => (
                  <span key={g} className="text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 px-2 py-0.5 rounded">
                    {g}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title={t('permissions.section_capabilities')}>
        {!hasAnyCaps ? (
          <div className="px-3 py-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 text-xs text-yellow-700 dark:text-yellow-400 rounded-lg">
            {t('permissions.no_caps')}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {orderedKeys.map(k => (
              <CapabilityCard key={k} type={k} permissions={caps[k]} />
            ))}
          </div>
        )}
      </Section>
    </>
  )
}

const NODE_ACTION_LABELS_PROFILE = {
  'node:view_tasks':      'node_assignments.action_view_tasks',
  'node:view_backups':    'node_assignments.action_view_backups',
  'node:upload_iso':      'node_assignments.action_upload_iso',
  'node:view_updates':    'node_assignments.action_view_updates',
  'node:refresh_updates': 'node_assignments.action_refresh_updates',
}

function NodeAssignmentsSection() {
  const { t } = useTranslation()
  const { assignments, loading } = useMyNodeAssignments()

  if (loading) return null
  if (!assignments || assignments.length === 0) return null

  return (
    <Section title={t('node_assignments.profile_section_title')}>
      <ul className="space-y-2">
        {assignments.map((a, i) => (
          <li
            key={`${a.node_id}-${i}`}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 rounded-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-gray-800 dark:text-zinc-200">{a.node_name}</p>
                <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
                  {t('node_assignments.profile_preset')}: {a.preset_name}
                  {' · '}
                  <span className="text-gray-400 dark:text-zinc-500">
                    {a.source === 'direct'
                      ? t('node_assignments.profile_source_direct')
                      : t('node_assignments.profile_source_group', { group: a.source_group_name })}
                  </span>
                </p>
                {a.preset_node_actions?.length > 0 && (
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    {a.preset_node_actions
                      .map(act => t(NODE_ACTION_LABELS_PROFILE[act] ?? act, { defaultValue: act }))
                      .join(', ')}
                  </p>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function LocalView({ perms, rbacData }) {
  const { t } = useTranslation()
  const appRole = perms?.capabilities?.app_role?.[0] ?? 'operator'
  const showAssignments = rbacData && !rbacData.bypass

  return (
    <>
      <Section title={t('permissions.section_account')}>
        <div className="space-y-2">
          <div>
            <p className="text-xs text-gray-500 dark:text-zinc-400 mb-0.5">{t('permissions.label_username')}</p>
            <p className="text-sm font-mono text-gray-800 dark:text-zinc-200">{perms.username}</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5">
              {t('permissions.portal_user')}
            </span>
            <span className={`text-xs px-2 py-0.5 ${ROLE_BADGE[appRole] ?? ROLE_BADGE.viewer}`}>
              {appRole}
            </span>
          </div>
        </div>
      </Section>

      {showAssignments && (
        <Section title={t('permissions.section_resources')}>
          <RbacAssignmentsTable assignments={rbacData.assignments} />
        </Section>
      )}

      <NodeAssignmentsSection />
    </>
  )
}

export default function PermissionsPage() {
  const { t } = useTranslation()
  const { auth_type, role } = useAuth()
  const { proxmoxPerms, rbacData, loading, error, reload } = usePermissions()
  const hasPlaybookPermissions = useCapability('playbook_permissions')

  const isLocal = auth_type === 'local'

  return (
    <div className="flex flex-col flex-1">
      <header className="h-12 flex items-center px-6 border-b border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{t('permissions.title')}</h1>
          <HelpButton helpKey="permissions" />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-8 bg-transparent">
        {loading && <SkeletonBlock />}

        {error && !loading && (
          <div className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-400 flex items-center justify-between rounded-lg">
            <span>{t('permissions.load_error')}</span>
            <button
              onClick={reload}
              className="text-xs underline hover:no-underline ml-4"
            >
              {t('permissions.retry')}
            </button>
          </div>
        )}

        {!loading && !error && proxmoxPerms && (
          <>
            {isLocal
              ? <LocalView perms={proxmoxPerms} rbacData={rbacData} />
              : <ProxmoxView perms={proxmoxPerms} />
            }
            {hasPlaybookPermissions && AllowedPlaybooksSection && (
              <Section title={t('permissions.section_allowed_playbooks')}>
                <Suspense fallback={null}><AllowedPlaybooksSection /></Suspense>
              </Section>
            )}
            <PackerTemplatesSection role={role} />
          </>
        )}
        <Watermark />
      </main>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
