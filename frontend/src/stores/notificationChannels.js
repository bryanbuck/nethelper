import { defineStore } from 'pinia'
import { ref } from 'vue'
import settingsService from '@/services/settings.service'

/**
 * Alert notification channels (Settings → Notifications, admin only): where
 * alerts go besides the app. The server sends one notification when a
 * matching alert opens and one when it resolves, and, for channels with
 * cloudAlarms on, when a cloud alarm is raised and when it clears.
 */
export const useNotificationChannelsStore = defineStore('notificationChannels', () => {
  const channels = ref([])
  // Whether the server has SMTP set up; email channels can't deliver without it
  const emailConfigured = ref(true)
  const loading = ref(false)
  const error = ref(null)
  // Suggestions for a channel's cloud alarm filter, [{ provider, name }]
  const cloudAlarmNames = ref(null)

  async function fetchChannels() {
    loading.value = true
    error.value = null
    try {
      const response = await settingsService.getNotificationChannels()
      channels.value = response.data || []
      emailConfigured.value = response.emailConfigured !== false
      return channels.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  const replace = (row) => {
    const index = channels.value.findIndex((c) => c.id === row.id)
    if (index === -1) channels.value.push(row)
    else channels.value[index] = row
    channels.value.sort((a, b) => a.name.localeCompare(b.name))
    return row
  }

  async function createChannel(payload) {
    return replace(await settingsService.createNotificationChannel(payload))
  }

  async function updateChannel(id, payload) {
    return replace(await settingsService.updateNotificationChannel(id, payload))
  }

  async function deleteChannel(id) {
    await settingsService.deleteNotificationChannel(id)
    channels.value = channels.value.filter((c) => c.id !== id)
  }

  /** Loaded once per session; a failure leaves the filter free-text only. */
  async function fetchCloudAlarmNames() {
    if (cloudAlarmNames.value) return cloudAlarmNames.value
    try {
      cloudAlarmNames.value = await settingsService.getCloudAlarmNames()
    } catch {
      cloudAlarmNames.value = []
    }
    return cloudAlarmNames.value
  }

  /** Send a sample; the result says whether it got through, and why not. */
  async function testChannel(id) {
    return settingsService.testNotificationChannel(id)
  }

  return {
    channels, emailConfigured, loading, error, cloudAlarmNames,
    fetchChannels, createChannel, updateChannel, deleteChannel, testChannel, fetchCloudAlarmNames
  }
})
