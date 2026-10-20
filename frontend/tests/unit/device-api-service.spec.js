import { vi } from 'vitest'

vi.mock('@/services/api', () => ({ default: { post: vi.fn() } }))

const { default: api } = await import('@/services/api')
const { default: deviceApiService, connectionTestResult } = await import('@/services/deviceApi.service')

// A failed NETCONF test as the backend sends it: the envelope says the test
// ran, the inner result says it failed.
const FAILED_TEST = {
  success: true,
  data: {
    success: false,
    message: 'NETCONF connection failed: All configured authentication methods failed.',
    transport: 'netconf',
    cloudStatus: { provider: 'My Mist', status: 'online' }
  }
}

describe('deviceApi.service connection test', () => {
  test('returns the test result, not the HTTP envelope', async () => {
    api.post.mockResolvedValue({ data: FAILED_TEST })

    const result = await deviceApiService.testDeviceConnection('d1')

    expect(api.post).toHaveBeenCalledWith('/device-api/test/d1')
    expect(result.success).toBe(false)
    expect(result.transport).toBe('netconf')
    expect(result.cloudStatus.status).toBe('online')
  })

  test('a test that could not start keeps its error', () => {
    const body = { success: false, error: 'No credentials configured for this device', message: 'Please add API credentials' }
    expect(connectionTestResult(body)).toBe(body)
  })

  test('an empty reply is a failure', () => {
    expect(connectionTestResult(undefined).success).toBe(false)
  })
})
