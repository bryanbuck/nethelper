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

  test('ending the session keeps display preferences: theme and each user\'s Devices view', async () => {
    localStorage.setItem('access_token', 'expired')
    localStorage.setItem('user', '{}')
    localStorage.setItem('nethelper.theme', 'dark')
    localStorage.setItem('nethelper.devicesView.u1', '{"page":3}')
    expect(await settled(api.get('/devices'))).toBe('rejected')
    expect(localStorage.getItem('access_token')).toBeNull()
    expect(localStorage.getItem('user')).toBeNull()
    expect(localStorage.getItem('nethelper.theme')).toBe('dark')
    expect(localStorage.getItem('nethelper.devicesView.u1')).toBe('{"page":3}')
  })
})
