import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/user.service', () => ({
  default: {
    getUsers: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetPassword: vi.fn(),
    deleteUser: vi.fn()
  }
}))

const { default: userService } = await import('@/services/user.service')
const { useUsersStore } = await import('@/stores/users')
const { apiErrorMessage } = await import('@/utils/apiError')

describe('users store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    userService.getUsers.mockResolvedValue({ data: [{ id: 'u1', email: 'a@x', role: 'admin' }, { id: 'u2', email: 'b@x', role: 'viewer' }] })
  })

  test('create appends the user returned by /auth/register', async () => {
    userService.createUser.mockResolvedValue({ data: { user: { id: 'u3', email: 'c@x', role: 'operator' } } })
    const store = useUsersStore()
    await store.fetchUsers()

    await store.createUser({ email: 'c@x', name: 'C', role: 'operator', password: 'x'.repeat(12) })

    expect(store.users.map((u) => u.id)).toEqual(['u1', 'u2', 'u3'])
  })

  test('update replaces the row', async () => {
    userService.updateUser.mockResolvedValue({ data: { id: 'u2', email: 'b@x', role: 'operator' } })
    const store = useUsersStore()
    await store.fetchUsers()

    await store.updateUser('u2', { role: 'operator' })

    expect(store.users[1].role).toBe('operator')
  })

  test('delete removes the row and reports transferred records', async () => {
    userService.deleteUser.mockResolvedValue({ data: { reassigned: { cloudIntegration: 2 } } })
    const store = useUsersStore()
    await store.fetchUsers()

    const reassigned = await store.deleteUser('u2')

    expect(reassigned).toEqual({ cloudIntegration: 2 })
    expect(store.users.map((u) => u.id)).toEqual(['u1'])
  })
})

describe('apiErrorMessage', () => {
  test('prefers the server error, then its first validation message', () => {
    expect(apiErrorMessage({ response: { data: { error: 'You cannot delete your own account' } } }))
      .toBe('You cannot delete your own account')
    expect(apiErrorMessage({ originalError: { response: { data: { errors: [{ msg: 'Password must be at least 12 characters' }] } } } }))
      .toBe('Password must be at least 12 characters')
    expect(apiErrorMessage({ userMessage: 'Unable to connect' })).toBe('Unable to connect')
    expect(apiErrorMessage(undefined)).toBe('Request failed')
  })
})
