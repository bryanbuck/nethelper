import { vi } from 'vitest'

vi.mock('@/router', () => ({ default: { push: vi.fn() } }))

const { default: api } = await import('@/services/api')
const { default: router } = await import('@/router')

// Every request answers 401, like a wrong password on /auth/login.
const reject401 = (config) => Promise.reject(Object.assign(new Error('401'), {
  config,
  response: { status: 401, data: { error: 'Invalid credentials' } }
}))

const settled = (promise, ms = 200) => Promise.race([
  promise.then(() => 'resolved', () => 'rejected'),
  new Promise(resolve => setTimeout(() => resolve('pending'), ms))
])

describe('api 401 interceptor', () => {
  beforeEach(() => {
    localStorage.clear()
    router.push.mockClear()
    api.defaults.adapter = reject401
  })

  test('repeated failed logins each reject and never trigger a redirect', async () => {
    expect(await settled(api.post('/auth/login', {}))).toBe('rejected')
    expect(await settled(api.post('/auth/login', {}))).toBe('rejected')
    expect(router.push).not.toHaveBeenCalled()
  })

  test('a 401 with no refresh token does not wedge later requests', async () => {
    expect(await settled(api.get('/devices'))).toBe('rejected')
    expect(router.push).toHaveBeenCalledWith('/login')
    expect(await settled(api.get('/devices'))).toBe('rejected')
    expect(await settled(api.post('/auth/login', {}))).toBe('rejected')
  })
})
