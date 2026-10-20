// The displayed device status is computed on both tiers (the backend for
// lists and socket events, the frontend for map nodes). They must agree.
import { createRequire } from 'node:module'
import { effectiveStatus, unreachableFromHere, answersPingButCloudOffline } from '@/models/Device'

const require = createRequire(import.meta.url)
const backend = require('../../../backend/src/utils/device-status.js')

describe('effectiveStatus mirrors backend utils/device-status', () => {
  test('every ping/cloud/mode combination', () => {
    for (const pingStatus of [null, 'online', 'warning', 'offline']) {
      for (const cloudStatus of [null, 'online', 'warning', 'offline']) {
        for (const managementMode of ['cloud', 'direct']) {
          const device = { pingStatus, cloudStatus, managementMode }
          expect([device, effectiveStatus(device)]).toEqual([device, backend.effectiveStatus(device)])
        }
      }
    }
  })

  test('unreachableFromHere is the cloud-up, ping-down case only', () => {
    expect(unreachableFromHere({ pingStatus: 'offline', cloudStatus: 'online', managementMode: 'cloud' })).toBe(true)
    expect(unreachableFromHere({ pingStatus: 'warning', cloudStatus: 'online', managementMode: 'cloud' })).toBe(false)
    expect(unreachableFromHere({ pingStatus: 'offline', cloudStatus: 'online', managementMode: 'direct' })).toBe(false)
  })

  test('answersPingButCloudOffline is the cloud-down, ping-up case only', () => {
    expect(answersPingButCloudOffline({ pingStatus: 'online', cloudStatus: 'offline', managementMode: 'cloud' })).toBe(true)
    expect(answersPingButCloudOffline({ pingStatus: 'online', cloudStatus: 'online', managementMode: 'cloud' })).toBe(false)
    expect(answersPingButCloudOffline({ pingStatus: 'online', cloudStatus: 'offline', managementMode: 'direct' })).toBe(false)
  })
})
