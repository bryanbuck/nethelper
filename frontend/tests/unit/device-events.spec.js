// Display metadata for DeviceEvent rows (models/device-events.js).
import { DEVICE_EVENTS, eventInfo } from '@/models/device-events'

describe('device event labels', () => {
  test('every event type the backend records has a label', () => {
    const recorded = [
      // live/port-state.js and live/state-monitor.service.js
      'port.link.up', 'port.link.down', 'port.admin.up', 'port.admin.down',
      'port.poe.up', 'port.poe.down', 'port.poe.fault', 'monitor.connected', 'monitor.disconnected',
      // cloud/mist-stream.js
      'device.restarted',
      // cloud-status.service.js: cloud.<DeviceStatus>
      'cloud.online', 'cloud.offline', 'cloud.warning', 'cloud.maintenance',
    ]
    expect(recorded.filter((type) => !DEVICE_EVENTS[type])).toEqual([])
  })

  test('a cloud status change names the provider', () => {
    expect(eventInfo({ type: 'cloud.offline', data: { provider: 'juniper_mist', previous: 'online' } }))
      .toMatchObject({ label: 'Mist reports offline', color: 'error' })
    expect(eventInfo({ type: 'cloud.online', data: {} }).label).toBe('Cloud reports online')
  })

  test('details fold into the label; an unknown type still shows', () => {
    expect(eventInfo({ type: 'port.link.up', data: { speedMbps: 2500 } }).label).toBe('link up at 2.5G')
    expect(eventInfo({ type: 'something.new', data: {} })).toMatchObject({ label: 'something.new' })
  })
})
