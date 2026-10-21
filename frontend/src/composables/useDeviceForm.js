import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { cloudProviderLabel } from '@/models/vendors'

// Options and rules shared by the add and edit device forms.

export const managementModeOptions = [
  { title: 'Direct (REST/SSH)', value: 'direct' },
  { title: 'Cloud-managed', value: 'cloud' }
]

// Device types — values are the backend DeviceType enum, so no display-string
// round-tripping is needed.
export const deviceTypes = [
  { title: 'Access Point', value: 'access_point' },
  { title: 'Switch', value: 'switch' },
  { title: 'Gateway', value: 'gateway' },
  { title: 'Controller', value: 'controller' },
  { title: 'Other', value: 'other' }
]

// Form validation rules
export const deviceFormRules = {
  required: value => !!value || 'This field is required',
  ipAddress: value => {
    if (!value) return true
    const pattern = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/
    return pattern.test(value) || 'Invalid IP address format'
  },
  macAddress: value => {
    if (!value) return true
    // Same forms the API accepts; Mist reports bare hex
    const pattern = /^(?:[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}|[0-9a-f]{12})$/i
    return pattern.test(value) || 'Invalid MAC address format'
  }
}

export function useDeviceForm () {
  const settingsStore = useSettingsStore()

  // Configured cloud tenants; several may be active at once, including more than
  // one of the same platform, so devices are attributed to a specific one.
  const cloudIntegrationOptions = computed(() =>
    (settingsStore.cloudIntegrations || [])
      .filter(i => i.isActive)
      .map(i => ({
        title: `${i.name} (${cloudProviderLabel(i.provider)})`,
        value: i.id,
      }))
  )

  const availableCredentials = computed(() => settingsStore.apiCredentials || [])

  return { cloudIntegrationOptions, availableCredentials }
}
