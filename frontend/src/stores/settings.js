import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import settingsService from '@/services/settings.service'
import debugLog, { DebugCategory } from '@/utils/debug'

export const useSettingsStore = defineStore('settings', () => {
  // State
  const apiCredentials = ref([])
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

  return {
    // State
    apiCredentials,
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
    clearError,
  }
})
