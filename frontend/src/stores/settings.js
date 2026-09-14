import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import settingsService from '@/services/settings.service'
import debugLog, { DebugCategory } from '@/utils/debug'

export const useSettingsStore = defineStore('settings', () => {
  // State
  const apiCredentials = ref([])
  const cloudIntegrations = ref([])
  const cloudProviders = ref([])
  const gitBackupConfig = ref(null)
  const gitBackupDefaults = ref({})
  const gitBackupFields = ref([])
  const loading = ref(false)
  const error = ref(null)

  // Getters
  const credentialsByDevice = computed(() => {
    const map = new Map()
    apiCredentials.value.forEach(cred => {
      if (cred.deviceId) {
        if (!map.has(cred.deviceId)) {
          map.set(cred.deviceId, [])
        }
        map.get(cred.deviceId).push(cred)
      }
    })
    return map
  })

  const credentialCount = computed(() => apiCredentials.value.length)

  // Actions
  const fetchApiCredentials = async () => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Fetching API credentials')
      const response = await settingsService.getApiCredentials()
      apiCredentials.value = response.data
      debugLog.success(DebugCategory.SETTINGS, `Fetched ${response.data.length} credentials`)
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to fetch credentials:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const createApiCredential = async (credentialData) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Creating API credential', credentialData)
      const response = await settingsService.createApiCredential(credentialData)
      apiCredentials.value.push(response.data)
      debugLog.success(DebugCategory.SETTINGS, 'Created credential:', response.data.id)
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to create credential:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const updateApiCredential = async (id, updates) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, `Updating credential ${id}`)
      const response = await settingsService.updateApiCredential(id, updates)
      const index = apiCredentials.value.findIndex(c => c.id === id)
      if (index !== -1) {
        apiCredentials.value[index] = response.data
      }
      debugLog.success(DebugCategory.SETTINGS, 'Updated credential:', id)
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to update credential:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const deleteApiCredential = async (id) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, `Deleting credential ${id}`)
      await settingsService.deleteApiCredential(id)
      apiCredentials.value = apiCredentials.value.filter(c => c.id !== id)
      debugLog.success(DebugCategory.SETTINGS, 'Deleted credential:', id)
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to delete credential:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const testApiCredential = async (id) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, `Testing credential ${id}`)
      const response = await settingsService.testApiCredential(id)
      debugLog.success(DebugCategory.SETTINGS, 'Credential test result:', response.data)
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to test credential:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const clearError = () => {
    error.value = null
  }

  // ============================================
  // Cloud Integration Actions
  //
  // Several integrations can be active at once, including multiple tenants of
  // the same provider (e.g. two Central accounts + a Mist org).
  // ============================================

  const fetchCloudIntegrations = async () => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Fetching cloud integrations')
      const response = await settingsService.getCloudIntegrations()
      cloudIntegrations.value = response.data?.integrations || []
      cloudProviders.value = response.data?.providers || []
      debugLog.success(DebugCategory.SETTINGS, `Fetched ${cloudIntegrations.value.length} cloud integration(s)`)
      return cloudIntegrations.value
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to fetch cloud integrations:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const createCloudIntegration = async (data) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Creating cloud integration', { provider: data.provider, name: data.name })
      const response = await settingsService.createCloudIntegration(data)
      cloudIntegrations.value.push(response.data)
      debugLog.success(DebugCategory.SETTINGS, 'Created cloud integration:', response.data.id)
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to create cloud integration:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const updateCloudIntegration = async (id, data) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, `Updating cloud integration ${id}`)
      const response = await settingsService.updateCloudIntegration(id, data)
      const index = cloudIntegrations.value.findIndex(i => i.id === id)
      if (index !== -1) {
        cloudIntegrations.value[index] = response.data
      }
      debugLog.success(DebugCategory.SETTINGS, 'Updated cloud integration:', id)
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to update cloud integration:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const testCloudIntegration = async (id) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, `Testing cloud integration ${id}`)
      const response = await settingsService.testCloudIntegration(id)
      // Reflect the persisted test status without a full refetch.
      const integration = cloudIntegrations.value.find(i => i.id === id)
      if (integration) {
        integration.lastTested = response.data.testedAt
        integration.lastTestStatus = response.data.success ? 'success' : 'failed'
      }
      debugLog.success(DebugCategory.SETTINGS, 'Connection test result:', response.data)
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to test cloud integration:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const deleteCloudIntegration = async (id) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, `Deleting cloud integration ${id}`)
      await settingsService.deleteCloudIntegration(id)
      cloudIntegrations.value = cloudIntegrations.value.filter(i => i.id !== id)
      debugLog.success(DebugCategory.SETTINGS, 'Deleted cloud integration:', id)
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to delete cloud integration:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  // --- Git backup mirror ---

  const fetchGitBackupConfig = async () => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Fetching Git backup configuration')
      const response = await settingsService.getGitBackupConfig()
      gitBackupConfig.value = response.data.config
      gitBackupDefaults.value = response.data.defaults || {}
      gitBackupFields.value = response.data.credentialFields || []
      debugLog.success(DebugCategory.SETTINGS, 'Fetched Git backup configuration')
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to fetch Git backup configuration:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const saveGitBackupConfig = async (payload) => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Saving Git backup configuration')
      const response = await settingsService.saveGitBackupConfig(payload)
      gitBackupConfig.value = response.data
      debugLog.success(DebugCategory.SETTINGS, 'Saved Git backup configuration')
      return response.data
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to save Git backup configuration:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  const testGitBackupConfig = async () => {
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Testing Git backup configuration')
      const response = await settingsService.testGitBackupConfig()
      // Refresh so lastTested / lastTestStatus reflect the run.
      await fetchGitBackupConfig()
      debugLog.success(DebugCategory.SETTINGS, 'Tested Git backup configuration')
      return response
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to test Git backup configuration:', err)
      throw err
    }
  }

  const deleteGitBackupConfig = async () => {
    loading.value = true
    error.value = null

    try {
      debugLog.progress(DebugCategory.SETTINGS, 'Deleting Git backup configuration')
      await settingsService.deleteGitBackupConfig()
      gitBackupConfig.value = null
      debugLog.success(DebugCategory.SETTINGS, 'Deleted Git backup configuration')
    } catch (err) {
      error.value = err.message
      debugLog.error(DebugCategory.SETTINGS, 'Failed to delete Git backup configuration:', err)
      throw err
    } finally {
      loading.value = false
    }
  }

  return {
    // State
    apiCredentials,
    cloudIntegrations,
    cloudProviders,
    gitBackupConfig,
    gitBackupDefaults,
    gitBackupFields,
    loading,
    error,

    // Getters
    credentialsByDevice,
    credentialCount,

    // Actions
    fetchApiCredentials,
    createApiCredential,
    updateApiCredential,
    deleteApiCredential,
    testApiCredential,
    fetchCloudIntegrations,
    createCloudIntegration,
    updateCloudIntegration,
    testCloudIntegration,
    deleteCloudIntegration,
    fetchGitBackupConfig,
    saveGitBackupConfig,
    testGitBackupConfig,
    deleteGitBackupConfig,
    clearError,
  }
})
