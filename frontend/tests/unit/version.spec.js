import { describe, test, expect } from 'vitest'
import { prereleaseLabel } from '@/utils/version'

describe('prereleaseLabel', () => {
  test('a release or a dev build without a version has no label', () => {
    expect(prereleaseLabel('0.9.0')).toBe('')
    expect(prereleaseLabel('1.0.0+build.5')).toBe('')
    expect(prereleaseLabel('')).toBe('')
    expect(prereleaseLabel(undefined)).toBe('')
  })

  test('a beta is Beta, any other suffix is Pre-release', () => {
    expect(prereleaseLabel('0.9.0-beta.5')).toBe('Beta')
    expect(prereleaseLabel('1.0.0-rc.1')).toBe('Pre-release')
    expect(prereleaseLabel('1.0.0-alpha')).toBe('Pre-release')
  })
})
