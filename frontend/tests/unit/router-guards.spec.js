// The router's guard and redirects (src/router/index.js): sign-in required,
// admin-only pages, auth pages hidden once signed in, and the old paths that
// redirect. Guards a vue-router major upgrade.
import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/views/auth/LoginView.vue', () => ({ default: { name: 'LoginView', render: () => null } }))
vi.mock('@/views/dashboard/DashboardView.vue', () => ({ default: { name: 'DashboardView', render: () => null } }))
vi.mock('@/views/users/UsersView.vue', () => ({ default: { name: 'UsersView', render: () => null } }))
vi.mock('@/views/devices/DevicesView.vue', () => ({ default: { name: 'DevicesView', render: () => null } }))

const { useAuthStore } = await import('@/stores/auth')

const freshRouter = async () => {
  vi.resetModules()
  const { default: router } = await import('@/router/index.js')
  return router
}

const signIn = (role) => {
  const auth = useAuthStore()
  auth.token = 'token'
  auth.user = { id: 'u1', name: 'U', email: 'u@x.io', role }
  vi.spyOn(auth, 'checkTokenExpiry').mockReturnValue(false)
}

describe('router', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  test('a signed-out visit goes to Login, remembering where it was going', async () => {
    const router = await freshRouter()
    setActivePinia(createPinia())
    await router.push('/devices?status=online')
    expect(router.currentRoute.value.name).toBe('Login')
    expect(router.currentRoute.value.query.redirect).toBe('/devices?status=online')
  })

  test('admin-only pages send other roles to the dashboard', async () => {
    const router = await freshRouter()
    signIn('operator')
    await router.push('/users')
    expect(router.currentRoute.value.name).toBe('Dashboard')
  })

  test('an admin reaches admin-only pages; Login is skipped once signed in', async () => {
    const router = await freshRouter()
    signIn('admin')
    await router.push('/users')
    expect(router.currentRoute.value.path).toBe('/users')
    await router.push('/login')
    expect(router.currentRoute.value.name).toBe('Dashboard')
  })

  test.each([
    ['/', '/dashboard', {}],
    ['/schedule', '/automations', {}],
    ['/executions/abc', '/automations/executions', {}],
    ['/settings/device-api-testing', '/settings', { tab: 'testing' }]
  ])('%s redirects to %s', async (from, path, query) => {
    const router = await freshRouter()
    const resolved = router.resolve(from)
    const target = router.resolve(resolved.matched[0].redirect)
    expect(target.path).toBe(path)
    expect(target.query).toEqual(query)
  })
})
