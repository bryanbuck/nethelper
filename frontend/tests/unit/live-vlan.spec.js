// Live tab VLAN display (models/live-vlan.js). Rows are shaped like the
// backend's cx-live.js output for the real Sw-CoreA-style capture in
// backend/tests/fixtures/aos-cx-live/interfaces-vlans-lag.json.
import { compressVlans, vlanLines, vlanModeLabel, vlanSummary } from '@/models/live-vlan'

const access = { mode: 'access', untagged: 50 }
const trunk = { mode: 'trunk', native: 9, nativeTagged: false, allowed: [9, 10, 19, 20, 21, 99], allAllowed: false }
const allTrunk = { mode: 'trunk', native: 1, nativeTagged: false, allowed: [], allAllowed: true }
const taggedLag = { mode: 'trunk', native: 99, nativeTagged: true, allowed: [10, 30], allAllowed: false, lag: 'lag1' }

describe('live-vlan', () => {
  test('compressVlans collapses runs of three or more', () => {
    expect(compressVlans([110, 10, 11, 12, 13, 20, 21, 1])).toBe('1, 10-13, 20, 21, 110')
    expect(compressVlans([])).toBe('')
  })

  test('mode labels', () => {
    expect(vlanModeLabel(access)).toBe('Access')
    expect(vlanModeLabel(trunk)).toBe('Trunk')
    expect(vlanModeLabel({ mode: 'routed' })).toBe('Routed')
    expect(vlanModeLabel({ mode: null, lag: 'lag3' })).toBe('')
    expect(vlanModeLabel(null)).toBe('')
  })

  test('VLAN cell lines: access id, trunk Native/Allowed', () => {
    expect(vlanLines(access)).toEqual(['50'])
    expect(vlanLines(trunk)).toEqual(['Native: 9', 'Allowed: 9, 10, 19-21, 99'])
    expect(vlanLines(allTrunk)).toEqual(['Native: 1', 'Allowed: all'])
    expect(vlanLines(taggedLag)).toEqual(['Native: 99 (tagged)', 'Allowed: 10, 30'])
    expect(vlanLines({ mode: 'routed' })).toEqual([])
    expect(vlanLines(null)).toEqual([])
  })

  test('phone summary', () => {
    expect(vlanSummary(access)).toBe('Access 50')
    expect(vlanSummary(allTrunk)).toBe('Trunk · Native 1 · Allowed all')
    expect(vlanSummary({ ...access, lag: 'lag3' })).toBe('Access 50 · lag3')
    expect(vlanSummary({ mode: null, lag: 'lag3' })).toBe('lag3')
    expect(vlanSummary(null)).toBe('')
  })
})
