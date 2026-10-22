// The device page's Last Seen card (models/device-seen.js).
import { lastSeenSummary } from '@/models/device-seen'

const at = (hhmm) => `2026-10-22T${hhmm}:00.000Z`
const summary = (device) => lastSeenSummary(device, { cloudName: 'Mist' })
const cloudDevice = (over) => ({
  managementMode: 'cloud', cloudIntegrationId: 'i1', ipAddress: '10.0.0.5', ...over,
})

describe('lastSeenSummary', () => {
  test('ping and the cloud both see it: confirmed by both, at the newest', () => {
    expect(summary(cloudDevice({
      pingStatus: 'online', pingLastSeen: at('10:05'), cloudStatus: 'online', cloudCheckedAt: at('10:02'),
    }))).toEqual({ at: new Date(at('10:05')), by: 'ping and Mist', current: true, tone: 'success', ping: null })
  })

  test('the cloud sees it but ping does not: confirmed by the cloud, with the last ping reply', () => {
    expect(summary(cloudDevice({
      pingStatus: 'offline', pingLastSeen: at('08:00'), cloudStatus: 'online', cloudCheckedAt: at('10:02'),
    }))).toMatchObject({ at: new Date(at('10:02')), by: 'Mist', current: true, tone: 'warning', ping: { at: new Date(at('08:00')) } })
  })

  test('ping answers but the cloud says offline: the cloud\'s last sighting is the confirmation', () => {
    expect(summary(cloudDevice({
      pingStatus: 'online', pingLastSeen: at('10:05'), cloudStatus: 'offline', cloudLastSeen: at('06:00'),
    }))).toMatchObject({
      at: new Date(at('06:00')), by: 'Mist', current: false, tone: 'warning',
      ping: { at: new Date(at('10:05')) },
    })
  })

  test('a direct device answering ping is confirmed by ping', () => {
    expect(summary({ managementMode: 'direct', pingStatus: 'online', pingLastSeen: at('10:05') }))
      .toMatchObject({ by: 'ping', current: true, tone: 'success', ping: null })
  })

  test('the cloud sees it and it never answered ping: ping has no time', () => {
    expect(summary(cloudDevice({ pingStatus: 'offline', cloudStatus: 'online', cloudCheckedAt: at('10:02') })).ping)
      .toEqual({ at: null })
  })

  test('down everywhere: the newest trusted sighting, a connection test included', () => {
    expect(summary({
      managementMode: 'direct', pingStatus: 'offline', pingLastSeen: at('07:00'),
      apiTestStatus: 'success', apiLastTested: at('09:00'),
    })).toMatchObject({ at: new Date(at('09:00')), by: 'a connection test', current: false, tone: null })
  })

  test('rows without per-source times fall back to lastSeen', () => {
    expect(summary({ managementMode: 'direct', lastSeen: at('05:00') }))
      .toMatchObject({ at: new Date(at('05:00')), by: null })
    expect(summary({ managementMode: 'direct' }).at).toBeNull()
  })
})
