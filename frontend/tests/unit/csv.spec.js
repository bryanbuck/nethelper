import { toCsv } from '@/utils/csv'
import { deviceTypeInfo } from '@/models/Device'

describe('toCsv', () => {
  test('quotes only cells that need it and doubles embedded quotes', () => {
    const csv = toCsv(['Name', 'Location'], [['sw-1', 'Lab, rack "A"'], ['ap-2', null]])

    expect(csv).toBe('Name,Location\r\nsw-1,"Lab, rack ""A"""\r\nap-2,')
  })

  test('writes dates as ISO timestamps', () => {
    expect(toCsv(['At'], [[new Date('2026-10-21T12:00:00Z')]])).toBe('At\r\n2026-10-21T12:00:00.000Z')
  })
})

describe('deviceTypeInfo', () => {
  test('labels every backend DeviceType value', () => {
    for (const [type, label] of [['access_point', 'Access Point'], ['switch', 'Switch'], ['gateway', 'Gateway'], ['controller', 'Controller'], ['other', 'Other']]) {
      expect(deviceTypeInfo(type).label).toBe(label)
    }
  })

  test('falls back to a generic entry for an unknown type', () => {
    expect(deviceTypeInfo('router')).toMatchObject({ label: 'router', icon: 'mdi-help-circle', color: 'grey' })
  })
})
