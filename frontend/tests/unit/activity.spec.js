// The Activity feed's display model, and its categories against the backend's.
import { createRequire } from 'node:module'
import { ACTIVITY_CATEGORIES, DEFAULT_ACTIVITY_CATEGORIES, activityInfo, dayLabel, durationLabel } from '@/models/activity'

const require = createRequire(import.meta.url)
const backend = require('../../../backend/src/constants/activity.js')

const device = { id: 'd1', name: 'SW1' }

describe('models/activity', () => {
  test('categories mirror backend constants/activity', () => {
    expect(ACTIVITY_CATEGORIES.map((c) => c.value)).toEqual(backend.ACTIVITY_CATEGORIES)
    expect(DEFAULT_ACTIVITY_CATEGORIES).toEqual(backend.DEFAULT_ACTIVITY_CATEGORIES)
  })

  test('a status change says what it was before and links to History', () => {
    const info = activityInfo({
      kind: 'event', category: 'status', type: 'ping.offline', at: '2026-10-22T10:00:00Z', device, data: { previous: 'online' },
    })
    expect(info).toMatchObject({ label: 'Stopped answering ping', detail: 'was online', color: 'error' })
    expect(info.link).toEqual({ path: '/devices/d1', query: { tab: 'history' } })
  })

  test('a folded port flap reads as flapping with its count', () => {
    const info = activityInfo({
      kind: 'event', category: 'port', type: 'port.link.up', port: '1/1/5', device, data: {},
      at: '2026-10-22T10:06:00Z', since: '2026-10-22T10:00:00Z', count: 4,
    })
    expect(info.label).toBe('Port 1/1/5 flapping')
    expect(info.detail).toBe('4 changes in 6 min, now link up')
    expect(info.color).toBe('warning')
    expect(info.link.query).toEqual({ tab: 'live' })
  })

  test('config changes and alerts', () => {
    expect(activityInfo({ kind: 'config', trigger: 'scheduled', device }).detail).toBe('Found by a scheduled backup')
    expect(activityInfo({ kind: 'alert', type: 'alert.opened', rule: 'backup.failed', severity: 'warning', message: 'boom', deviceId: 'd1', device }))
      .toMatchObject({ label: 'Warning alert: Backup failed', detail: 'boom' })
    expect(activityInfo({ kind: 'alert', type: 'alert.resolved', rule: 'backup.failed', title: 'SW1 backup failed', deviceId: 'd1', device }).label)
      .toBe('Alert cleared: Backup failed')
  })

  test('cloud alarms: raised, folded, and cleared by timer or by dropping out', () => {
    const raised = activityInfo({
      kind: 'cloud-alarm', type: 'cloud-alarm.raised', provider: 'juniper_mist', name: 'Switch Bad Optics', severity: 'warning',
      summary: 'rx power low', incidents: 3, ports: ['xe-0/1/0'], device,
    })
    expect(raised).toMatchObject({
      label: 'Mist: Switch Bad Optics', color: 'warning', detail: 'rx power low · 3 incidents · ports xe-0/1/0',
    })
    expect(raised.link).toEqual({ path: '/devices/d1' })

    const folded = activityInfo({
      kind: 'cloud-alarm', type: 'cloud-alarm.raised', provider: 'aruba_central', name: 'OSPF Peer Down', severity: 'warning',
      count: 4, at: '2026-10-22T10:03:00Z', since: '2026-10-22T10:00:00Z', siteName: 'HQ', device: null,
    })
    expect(folded.label).toBe('Central: OSPF Peer Down ×4')
    expect(folded.detail).toBe('4 in 3 min')
    expect(folded.link).toBeNull()

    const timer = activityInfo({
      kind: 'cloud-alarm', type: 'cloud-alarm.cleared', provider: 'aruba_central', name: 'Switch Reboot',
      clearedReason: 'Due to clear alert timer configuration', device,
    })
    expect(timer).toMatchObject({ color: 'medium-emphasis', detail: "Cleared by Central's timer; the problem may not be fixed" })
    expect(activityInfo({ kind: 'cloud-alarm', type: 'cloud-alarm.cleared', provider: 'aruba_central', name: 'X', device }).detail)
      .toBe('No longer active in Central')
  })

  test('a deleted device has no link', () => {
    expect(activityInfo({ kind: 'config', trigger: 'manual', device: { id: 'x', name: 'Gone', deleted: true } }).link).toBeNull()
  })

  test('day labels and durations', () => {
    const now = new Date(2026, 9, 22, 12)
    expect(dayLabel(new Date(2026, 9, 22, 1), now)).toBe('Today')
    expect(dayLabel(new Date(2026, 9, 21, 23), now)).toBe('Yesterday')
    expect(durationLabel(90 * 1000)).toBe('2 min')
  })
})
