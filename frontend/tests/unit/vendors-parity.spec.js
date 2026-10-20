// The frontend mirrors backend/src/constants/vendors.js by hand. This keeps
// the two from drifting: an id added on one side and not the other fails here.
import { createRequire } from 'node:module'
import { Vendor, VendorInfo, PlatformInfo, CloudProvider, CloudProviderInfo } from '@/models/vendors'

const require = createRequire(import.meta.url)
const backend = require('../../../backend/src/constants/vendors.js')

const sorted = (values) => [...values].sort()

describe('models/vendors mirrors backend constants/vendors', () => {
  test('vendor ids', () => {
    expect(sorted(Object.values(Vendor))).toEqual(sorted(Object.keys(backend.VENDORS)))
    expect(sorted(Object.keys(VendorInfo))).toEqual(sorted(Object.keys(backend.VENDORS)))
  })

  test('vendor labels', () => {
    for (const [id, info] of Object.entries(backend.VENDORS)) {
      expect(VendorInfo[id].label).toBe(info.label)
    }
  })

  test('platform ids, labels, vendors, and live-state mode', () => {
    expect(sorted(Object.keys(PlatformInfo))).toEqual(sorted(Object.keys(backend.PLATFORMS)))
    for (const [id, info] of Object.entries(backend.PLATFORMS)) {
      expect(PlatformInfo[id]).toEqual({ label: info.label, vendor: info.vendor, liveState: info.liveState })
    }
  })

  test('cloud provider ids, labels, and vendors', () => {
    expect(sorted(Object.values(CloudProvider))).toEqual(sorted(Object.keys(backend.CLOUD_PROVIDERS)))
    for (const [id, info] of Object.entries(backend.CLOUD_PROVIDERS)) {
      expect(CloudProviderInfo[id]).toMatchObject({ label: info.label, vendor: info.vendor })
    }
  })
})
