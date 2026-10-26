<template>
  <v-dialog
    v-model="open"
    max-width="600px"
    :fullscreen="$vuetify.display.xs"
    persistent
  >
    <v-card>
      <v-card-title class="text-h5">
        Edit Device
      </v-card-title>

      <v-card-text>
        <v-container>
          <v-row>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.name"
                label="Device Name"
                variant="outlined"
                required
                :rules="[deviceFormRules.required]"
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-select
                v-model="form.type"
                label="Device Type"
                :items="deviceTypes"
                variant="outlined"
                required
                :rules="[deviceFormRules.required]"
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.ipAddress"
                label="IP Address"
                variant="outlined"
                :required="ipRequired"
                :rules="ipRequired ? [deviceFormRules.required, deviceFormRules.ipAddress] : [deviceFormRules.ipAddress]"
                :hint="ipRequired ? 'Required for a directly managed device' : 'Optional; its cloud fills it in on sync'"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.macAddress"
                label="MAC Address"
                variant="outlined"
                :rules="[deviceFormRules.macAddress]"
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.location"
                label="Location"
                variant="outlined"
                hint="Optional"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.serialNumber"
                label="Serial Number"
                variant="outlined"
                hint="Optional"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-text-field
                v-model="form.model"
                label="Model"
                variant="outlined"
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-select
                v-model="form.vendor"
                label="Vendor"
                :items="vendorOptions"
                variant="outlined"
                prepend-inner-icon="mdi-factory"
                @update:model-value="form.platform = null"
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-select
                v-model="form.platform"
                label="Platform"
                :items="platformOptions(form.vendor)"
                variant="outlined"
                clearable
                hint="OS family; leave blank to detect from the model"
                persistent-hint
              />
            </v-col>

            <v-col cols="12">
              <v-divider class="my-2"></v-divider>
              <h3 class="text-subtitle-1 mb-3">API Configuration</h3>
            </v-col>

            <v-col cols="12" sm="6">
              <v-select
                v-model="form.managementMode"
                :items="managementModeOptions"
                label="Management Mode"
                variant="outlined"
                prepend-inner-icon="mdi-server-network"
                hint="Cloud pulls config from the platform below; Direct uses REST/SSH"
                persistent-hint
              />
            </v-col>

            <v-col v-if="form.managementMode === 'cloud'" cols="12" sm="6">
              <v-select
                v-model="form.cloudIntegrationId"
                :items="cloudIntegrationOptions"
                label="Cloud Integration"
                variant="outlined"
                prepend-inner-icon="mdi-cloud"
                clearable
                hint="Which cloud platform manages this device"
                persistent-hint
              />
            </v-col>

            <v-col cols="12" sm="6">
              <v-select
                v-model="form.apiCredentialId"
                :items="availableCredentials"
                item-title="name"
                item-value="id"
                label="API Credential"
                variant="outlined"
                prepend-inner-icon="mdi-key-variant"
                clearable
                :loading="loadingCredentials"
                :hint="form.managementMode === 'cloud'
                  ? 'Optional: enables read-only local access (AOS-CX REST, Junos NETCONF: config backup, network map)'
                  : 'Select the API credentials to use for this device'"
                persistent-hint
              >
                <template #item="{ props: itemProps, item }">
                  <v-list-item
                    v-bind="itemProps"
                    :subtitle="`${item.raw.type} - ${item.raw.username || 'No username'}`"
                  >
                    <template v-if="item.raw.lastTestStatus" #append>
                      <v-chip
                        :color="item.raw.lastTestStatus === 'success' ? 'success' : 'error'"
                        size="x-small"
                        variant="flat"
                      >
                        {{ item.raw.lastTestStatus }}
                      </v-chip>
                    </template>
                  </v-list-item>
                </template>

                <template #selection="{ item }">
                  <div class="d-flex align-center">
                    <span>{{ item.title }}</span>
                    <v-chip
                      v-if="item.raw.lastTestStatus === 'success'"
                      color="success"
                      size="x-small"
                      variant="flat"
                      class="ml-2"
                    >
                      Tested
                    </v-chip>
                  </div>
                </template>

                <template #prepend-item>
                  <v-list-item
                    title="Manage Credentials"
                    prepend-icon="mdi-cog"
                    :to="{ path: '/settings', query: { tab: 'credentials' } }"
                    target="_blank"
                  >
                  </v-list-item>
                  <v-divider class="mb-2"></v-divider>
                </template>
              </v-select>

              <v-alert
                v-if="!form.apiCredentialId"
                type="info"
                variant="tonal"
                density="compact"
                class="mt-2"
              >
                {{ form.managementMode === 'cloud'
                  ? 'No credential assigned. Local config backup and live state will not be available.'
                  : 'No credential assigned. Direct device polling will not be available.' }}
              </v-alert>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          variant="text"
          @click="close"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="saving"
          @click="save"
        >
          Save Changes
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useDevicesStore } from '@/stores/devices'
import { useSettingsStore } from '@/stores/settings'
import { useNotificationsStore } from '@/stores/notifications'
import { vendorOptions, platformOptions } from '@/models/vendors'
import { useDeviceForm, deviceTypes, managementModeOptions, deviceFormRules } from '@/composables/useDeviceForm'

// Edit Device dialog, used by the Devices table and the device page.
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  device: { type: Object, default: null }
})
const emit = defineEmits(['update:modelValue', 'saved'])

const devicesStore = useDevicesStore()
const settingsStore = useSettingsStore()
const notifications = useNotificationsStore()
const { cloudIntegrationOptions, availableCredentials } = useDeviceForm()

const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const form = ref({})
const saving = ref(false)
const loadingCredentials = ref(false)

const fromDevice = (device) => ({
  id: device.id,
  name: device.name || '',
  type: device.type || '',
  vendor: device.vendor || 'aruba',
  platform: device.platform || null,
  ipAddress: device.ipAddress || '',
  macAddress: device.macAddress || '',
  location: device.location || '',
  serialNumber: device.serialNumber || device.serial || '',
  model: device.model || '',
  managementMode: device.managementMode || 'direct',
  cloudIntegrationId: device.cloudIntegrationId || null,
  apiCredentialId: device.apiCredentialId || null
})

// Fill the form each time the dialog opens, and load the selectors' options
// if no other view has yet.
watch(() => props.modelValue, async (isOpen) => {
  if (!isOpen || !props.device) return
  form.value = fromDevice(props.device)
  if (!settingsStore.cloudIntegrations?.length) {
    settingsStore.fetchCloudIntegrations().catch((error) => {
      console.error('Failed to load cloud integrations:', error)
    })
  }
  if (settingsStore.apiCredentials.length === 0) {
    loadingCredentials.value = true
    try {
      await settingsStore.fetchApiCredentials()
    } catch (error) {
      console.error('Failed to load API credentials:', error)
    } finally {
      loadingCredentials.value = false
    }
  }
}, { immediate: true })

const close = () => {
  open.value = false
}

// A directly managed device is reached at its IP; a cloud device may have
// none (an offline AP, or one its cloud reports without an address).
const ipRequired = computed(() => form.value.managementMode !== 'cloud')

const save = async () => {
  const f = form.value
  if (!f.name || !f.type || (ipRequired.value && !f.ipAddress)) {
    notifications.showError('Please fill in all required fields', 'Edit Device')
    return
  }

  saving.value = true
  try {
    const isCloud = f.managementMode === 'cloud'
    const updated = await devicesStore.updateDevice(f.id, {
      name: f.name,
      type: f.type,
      vendor: f.vendor || 'aruba',
      platform: f.platform || null,
      ipAddress: f.ipAddress || null,
      macAddress: f.macAddress || null,
      location: f.location || null,
      serial: f.serialNumber?.trim() || null,
      model: f.model || '',
      managementMode: f.managementMode || 'direct',
      cloudIntegrationId: isCloud ? (f.cloudIntegrationId || null) : null,
      // Kept for cloud devices too: read-only local access (AOS-CX config
      // backup, live state) uses it. Writes still go through the provider.
      apiCredentialId: f.apiCredentialId || null
    })
    notifications.showSuccess(`${f.name} updated`, 'Edit Device')
    emit('saved', updated)
    close()
  } catch (error) {
    console.error('Failed to update device:', error)
    notifications.showError(error.userMessage || error.message || 'Failed to update device', 'Edit Device')
  } finally {
    saving.value = false
  }
}
</script>
