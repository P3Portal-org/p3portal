// p3portal.org
/**
 * PROJ-78: Schedule picker for Proxmox backup jobs.
 *
 * Mirrors the UX of the Scheduled-Jobs cron picker (type dropdown + time +
 * weekday toggles), but produces **Proxmox systemd calendar-event** strings —
 * NOT 5-field cron — because /cluster/backup expects calendar events:
 *   daily   18:30          -> "18:30"
 *   weekly  Mon,Fri 21:00  -> "mon,fri 21:00"
 *   hourly  minute 15      -> "*:15"
 *   every15                -> every 15 minutes
 *   custom                 -> raw passthrough
 *
 * Core component (no Plus dependency) — the Plus CronPicker is licensed
 * separately and emits an incompatible cron format.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

// Schedule type option keys (labels resolved via i18n in render)
const SCHEDULE_TYPES = ['daily', 'weekly', 'hourly', 'every15', 'custom']

// Proxmox/systemd weekday tokens (lowercase 3-letter); labels via i18n
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const WD_ORDER = WEEKDAYS

const pad = n => String(parseInt(n, 10) || 0).padStart(2, '0')

/** Parse a Proxmox calendar-event string into picker state. */
export function parseScheduleToState(schedule) {
  const def = { type: 'daily', time: '02:00', weekdays: ['mon'], custom: '' }
  if (!schedule) return def
  const s = schedule.trim()

  if (s === '*/15') return { ...def, type: 'every15' }

  // hourly: "*:MM"
  let m = s.match(/^\*:(\d{1,2})$/)
  if (m) return { ...def, type: 'hourly', time: `00:${pad(m[1])}` }

  // daily: "HH:MM"
  m = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m) return { ...def, type: 'daily', time: `${pad(m[1])}:${pad(m[2])}` }

  // weekly: "<days> HH:MM" where days are comma-separated 3-letter tokens
  m = s.match(/^([a-z]{3}(?:,[a-z]{3})*)\s+(\d{1,2}):(\d{2})$/i)
  if (m) {
    const days = m[1].toLowerCase().split(',').filter(d => WD_ORDER.includes(d))
    if (days.length > 0) {
      return { ...def, type: 'weekly', time: `${pad(m[2])}:${pad(m[3])}`, weekdays: days }
    }
  }

  return { ...def, type: 'custom', custom: s }
}

/** Build a Proxmox calendar-event string from picker state. */
export function buildScheduleFromState(type, time, weekdays, custom) {
  if (type === 'every15') return '*/15'
  const [h = '0', mn = '0'] = (time || '02:00').split(':')
  if (type === 'hourly') return `*:${pad(mn)}`
  if (type === 'daily')  return `${pad(h)}:${pad(mn)}`
  if (type === 'weekly') {
    const days = (weekdays && weekdays.length > 0)
      ? [...weekdays].sort((a, b) => WD_ORDER.indexOf(a) - WD_ORDER.indexOf(b)).join(',')
      : 'mon'
    return `${days} ${pad(h)}:${pad(mn)}`
  }
  return (custom || '').trim()
}

function humanLabel(type, time, weekdays, t) {
  const ti = time || '02:00'
  if (type === 'every15') return t('backup_jobs.human_every15')
  if (type === 'hourly')  return t('backup_jobs.human_hourly', { minute: parseInt(ti.split(':')[1], 10) || 0 })
  if (type === 'daily')   return t('backup_jobs.human_daily', { time: ti })
  if (type === 'weekly') {
    if (!weekdays || weekdays.length === 0) return t('backup_jobs.human_weekly_notime', { time: ti })
    const names = [...weekdays]
      .sort((a, b) => WD_ORDER.indexOf(a) - WD_ORDER.indexOf(b))
      .map(v => WEEKDAYS.includes(v) ? t(`backup_jobs.wd_${v}`) : v)
      .join(', ')
    return t('backup_jobs.human_weekly_days', { names, time: ti })
  }
  return ''
}

const cls = 'text-sm border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-gray-900 dark:text-zinc-100 px-3 py-2 rounded focus:outline-none focus:ring-1 focus:ring-portal-accent'

export default function BackupSchedulePicker({ value, onChange, label }) {
  const { t } = useTranslation()
  const init = parseScheduleToState(value)
  const [type,     setType]     = useState(init.type)
  const [time,     setTime]     = useState(init.time)
  const [weekdays, setWeekdays] = useState(init.weekdays)
  const [custom,   setCu]       = useState(init.custom)

  const emit = (ty, ti, wds, cu) => onChange(buildScheduleFromState(ty, ti, wds, cu))

  const onType   = v => { setType(v); emit(v, time, weekdays, custom) }
  const onTime   = v => { setTime(v); emit(type, v, weekdays, custom) }
  const onCustom = v => { setCu(v);   emit(type, time, weekdays, v) }

  const toggleDay = v => {
    const next = weekdays.includes(v)
      ? weekdays.filter(d => d !== v)
      : [...weekdays, v]
    if (next.length === 0) return // mindestens 1 Tag muss gewählt sein
    setWeekdays(next)
    emit(type, time, next, custom)
  }

  const schedule = buildScheduleFromState(type, time, weekdays, custom)
  const human    = humanLabel(type, time, weekdays, t)
  const minute   = parseInt((time || '00:00').split(':')[1], 10) || 0

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-xs font-medium text-gray-600 dark:text-zinc-400 mb-1">
          {label} <span className="text-portal-danger">*</span>
        </label>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <select value={type} onChange={e => onType(e.target.value)} className={`${cls} flex-1 min-w-[150px]`}>
          {SCHEDULE_TYPES.map(o => <option key={o} value={o}>{t(`backup_jobs.sched_${o}`)}</option>)}
        </select>

        {(type === 'daily' || type === 'weekly') && (
          <input
            type="time"
            value={time}
            onChange={e => onTime(e.target.value)}
            className={cls}
          />
        )}

        {type === 'hourly' && (
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-zinc-400">
            <span>{t('backup_jobs.minute_label')}</span>
            <input
              type="number"
              min={0}
              max={59}
              value={minute}
              onChange={e => onTime(`00:${pad(Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)))}`)}
              className={`${cls} w-20 text-center`}
            />
          </div>
        )}
      </div>

      {type === 'weekly' && (
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map(d => {
            const activeDay = weekdays.includes(d)
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                title={t(`backup_jobs.wd_${d}`)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  activeDay
                    ? 'bg-portal-accent text-white'
                    : 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300 hover:bg-gray-200 dark:hover:bg-zinc-600'
                }`}
              >
                {t(`backup_jobs.wd_short_${d}`)}
              </button>
            )
          })}
        </div>
      )}

      {type === 'custom' && (
        <input
          type="text"
          value={custom}
          onChange={e => onCustom(e.target.value)}
          placeholder={t('backup_jobs.custom_ph')}
          className={`${cls} w-full font-mono`}
        />
      )}

      <p className="text-xs text-gray-400 dark:text-zinc-500">
        {human && `${human} · `}
        <code className="font-mono">{schedule || '–'}</code>
      </p>

      <span className="rq hidden" aria-hidden="true" />
    </div>
  )
}
