import { setActivePinia, createPinia } from 'pinia'
import { vi } from 'vitest'

vi.mock('@/services/settings.service', () => ({
  default: {
    getCloudIntegrations: vi.fn(),
    createCloudIntegration: vi.fn(),
    updateCloudIntegration: vi.fn(),
    testCloudIntegration: vi.fn(),
    deleteCloudIntegration: vi.fn(),
    getApiCredentials: vi.fn()
  }
}))

const { default: settingsService } = await import('@/services/settings.service')
const { useSettingsStore } = await import('@/stores/settings')

const CENTRAL = { id: 'i1', provider: 'aruba_central', name: 'Central', credentials: { clientSecret: '***' } }
const MIST = { id: 'i2', provider: 'juniper_mist', name: 'Mist', credentials: { apiToken: '***' } }

describe('settings store: cloud integrations', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    settingsService.getCloudIntegrations.mockResolvedValue({
      data: { integrations: [CENTRAL, MIST], providers: [{ id: 'aruba_central' }, { id: 'juniper_mist' }] }
    })
  })

  test('fetch loads integrations and the provider catalog', async () => {
    const store = useSettingsStore()

    await store.fetchCloudIntegrations()

    expect(store.cloudIntegrations.map((i) => i.id)).toEqual(['i1', 'i2'])
    expect(store.cloudProviders).toHaveLength(2)
    expect(store.integrationsLoading).toBe(false)
  })

  test('several integrations of the same provider can coexist', async () => {
    const second = { ...CENTRAL, id: 'i3', name: 'Central (lab)' }
    settingsService.createCloudIntegration.mockResolvedValue({ data: second })
    const store = useSettingsStore()
    await store.fetchCloudIntegrations()

    await store.createCloudIntegration({ provider: 'aruba_central', name: 'Central (lab)' })

    expect(store.cloudIntegrations.filter((i) => i.provider === 'aruba_central')).toHaveLength(2)
  })

  test('update replaces the row in place', async () => {
    settingsService.updateCloudIntegration.mockResolvedValue({ data: { ...MIST, name: 'Mist EU' } })
    const store = useSettingsStore()
    await store.fetchCloudIntegrations()

    await store.updateCloudIntegration('i2', { name: 'Mist EU' })

    expect(store.cloudIntegrations[1].name).toBe('Mist EU')
  })

  test('test result is reflected on the integration', async () => {
    settingsService.testCloudIntegration.mockResolvedValue({ data: { success: false, testedAt: '2026-09-25T00:00:00Z' } })
    const store = useSettingsStore()
    await store.fetchCloudIntegrations()

    await store.testCloudIntegration('i1')

    expect(store.cloudIntegrations[0]).toMatchObject({ lastTestStatus: 'failed', lastTested: '2026-09-25T00:00:00Z' })
  })

  test('delete removes the row; failures keep it and set error', async () => {
    const store = useSettingsStore()
    await store.fetchCloudIntegrations()

    settingsService.deleteCloudIntegration.mockRejectedValueOnce(new Error('in use'))
    await expect(store.deleteCloudIntegration('i1')).rejects.toThrow('in use')
    expect(store.integrationsError).toBe('in use')
    // Only the integrations section shows it
    expect(store.credentialsError).toBeNull()
    expect(store.gitBackupError).toBeNull()
    expect(store.cloudIntegrations).toHaveLength(2)

    settingsService.deleteCloudIntegration.mockResolvedValueOnce({})
    await store.deleteCloudIntegration('i1')
    expect(store.cloudIntegrations.map((i) => i.id)).toEqual(['i2'])
  })
})

describe('settings store: per-section errors', () => {
  beforeEach(() => setActivePinia(createPinia()))

  test('a credentials failure stays in the credentials section', async () => {
    settingsService.getApiCredentials.mockRejectedValueOnce(new Error('denied'))
    const store = useSettingsStore()

    await expect(store.fetchApiCredentials()).rejects.toThrow('denied')

    expect(store.credentialsError).toBe('denied')
    expect(store.integrationsError).toBeNull()
    expect(store.gitBackupError).toBeNull()

    store.clearError('credentials')
    expect(store.credentialsError).toBeNull()
  })
})
