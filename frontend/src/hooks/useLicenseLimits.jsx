// p3portal.org
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getLicenseStatus } from '../api/license'

export function useLicenseLimits() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['license'],
    queryFn: getLicenseStatus,
    staleTime: 120_000,
  })

  const reload = () => queryClient.invalidateQueries({ queryKey: ['license'] })

  const limits              = data?.limits ?? null
  const userLimit           = limits?.users                  ?? null
  const presetLimit         = limits?.presets                ?? null
  const groupLimit          = limits?.groups                 ?? null
  const ownershipsLimit     = limits?.ownerships             ?? null
  const scheduledJobsLimit  = limits?.scheduled_jobs_per_user ?? null

  const userAtLimit       = !!(userLimit       && !userLimit.unlimited       && userLimit.current       >= userLimit.max)
  const presetAtLimit     = !!(presetLimit     && !presetLimit.unlimited     && presetLimit.current     >= presetLimit.max)
  const groupAtLimit      = !!(groupLimit      && !groupLimit.unlimited      && groupLimit.current      >= groupLimit.max)

  return {
    isPlus: data?.valid === true,
    // PROJ-94: trial flags (from /api/license/status) for the start-button visibility
    trialUsed:   data?.trial_used === true,
    trialActive: data?.trial_active === true,
    userLimit,
    presetLimit,
    groupLimit,
    ownerships: ownershipsLimit,
    scheduledJobsLimit,
    userAtLimit,
    presetAtLimit,
    groupAtLimit,
    loading: isLoading,
    reload,
    appVersion: data?.app_version ?? null,
  }
}
