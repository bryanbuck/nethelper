<template>
  <div class="devices-view">
    <v-container fluid class="pa-4">
      <!-- Header Section -->
      <div class="d-flex align-center justify-space-between mb-6">
        <div>
          <h1 class="text-h4 font-weight-bold mb-1">Device Management</h1>
          <p class="text-subtitle-1 text-medium-emphasis mb-0">
            Monitor and manage your network infrastructure devices
          </p>
        </div>
        
        <div class="d-flex align-center ga-2">
          <v-btn
            v-if="canEdit"
            color="secondary"
            prepend-icon="mdi-plus"
            @click="addDevice"
          >
            Add Device
          </v-btn>
        </div>
      </div>
      
      <!-- Quick Stats Cards: fleet-wide counts; a click filters the table by that status -->
      <v-row class="mb-6">
        <v-col v-for="card in statCards" :key="card.key" cols="12" sm="6" md="3">
          <v-card
            :variant="isActiveCard(card) ? 'flat' : 'tonal'"
            :color="card.color"
            class="stats-card"
            link
            :aria-pressed="isActiveCard(card)"
            @click="selectStatus(card.status)"
          >
            <v-card-text class="d-flex align-center">
              <div class="flex-grow-1">
                <div class="text-h5 font-weight-bold">{{ devicesStore.stats[card.key] }}</div>
                <div class="text-body-2">{{ card.label }}</div>
              </div>
              <v-icon size="32">{{ isActiveCard(card) && card.status ? 'mdi-filter' : card.icon }}</v-icon>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
      
      <!-- Likely duplicates (e.g. a device added by hand, then synced from the cloud) -->
      <v-alert
        v-if="currentDuplicate"
        type="warning"
        variant="tonal"
        icon="mdi-content-duplicate"
        class="mb-4"
      >
        <div class="font-weight-medium">
          {{ visibleDuplicates.length === 1 ? 'Possible duplicate device' : `${visibleDuplicates.length} possible duplicate devices` }}
        </div>
        <div class="text-body-2">
          {{ currentDuplicate.devices.map((d) => `"${d.name}"`).join(' and ') }} share
          {{ currentDuplicate.reason === 'mac' ? 'a MAC address' : `${currentDuplicate.reason === 'name-ip' ? 'a name and ' : ''}IP ${currentDuplicate.devices[0].ipAddress}` }}
          and are probably the same device.
        </div>
        <template #append>
          <div class="d-flex flex-wrap ga-2">
            <v-btn v-if="canEdit" variant="tonal" color="warning" size="small" @click="showMergeDialog = true">
              Review and merge
            </v-btn>
            <v-btn variant="text" size="small" @click="dismissDuplicate(currentDuplicate)">Not duplicates</v-btn>
          </div>
        </template>
      </v-alert>

      <!-- Device Table -->
      <DeviceTable
        ref="deviceTable"
        v-model:status-filter="statusFilter"
        @edit-device="handleEditDevice"
      />

      <DeviceMergeDialog
        v-if="currentDuplicate"
        v-model="showMergeDialog"
        :devices="currentDuplicate.devices"
        @merged="onDuplicateMerged"
      />
    </v-container>
    
    <!-- Add Device Dialog -->
    <v-dialog 
      v-model="showAddDialog" 
      max-width="600px"
      persistent
    >
      <v-card>
        <v-card-title class="text-h5">
          Add New Device
        </v-card-title>
        
        <v-card-text>
          <v-container>
            <v-row>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.name"
                  label="Device Name"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>
              
              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.type"
                  label="Device Type"
                  :items="deviceTypes"
                  variant="outlined"
                  required
                  :rules="[rules.required]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.vendor"
                  label="Vendor"
                  :items="vendorOptions"
                  variant="outlined"
                  @update:model-value="newDevice.platform = null"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.platform"
                  label="Platform"
                  :items="platformOptions(newDevice.vendor)"
                  variant="outlined"
                  clearable
                  hint="OS family; leave blank to detect from the model"
                  persistent-hint
                />
              </v-col>
              
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.ipAddress"
                  label="IP Address"
                  variant="outlined"
                  required
                  :rules="[rules.required, rules.ipAddress]"
                  hint="Required for device API queries"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.macAddress"
                  label="MAC Address"
                  variant="outlined"
                  :rules="[rules.macAddress]"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.location"
                  label="Location"
                  variant="outlined"
                  hint="Optional"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.serialNumber"
                  label="Serial Number"
                  variant="outlined"
                  hint="Optional"
                  persistent-hint
                />
              </v-col>
              
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="newDevice.model"
                  label="Model"
                  variant="outlined"
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.managementMode"
                  :items="managementModeOptions"
                  label="Management Mode"
                  variant="outlined"
                  hint="How NetHelper reaches this device"
                  persistent-hint
                />
              </v-col>

              <v-col v-if="newDevice.managementMode === 'cloud'" cols="12" sm="6">
                <v-select
                  v-model="newDevice.cloudIntegrationId"
                  :items="cloudIntegrationOptions"
                  label="Cloud Integration"
                  variant="outlined"
                  clearable
                  hint="Which cloud platform manages this device"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="newDevice.apiCredentialId"
                  :items="availableCredentials"
                  item-title="name"
                  item-value="id"
                  label="Device Credential"
                  variant="outlined"
                  clearable
                  :hint="newDevice.managementMode === 'cloud'
                    ? 'Optional: enables read-only local access (AOS-CX REST, Junos NETCONF: config backup, network map)'
                    : 'Required for direct (REST/SSH) access'"
                  persistent-hint
                />
              </v-col>
            </v-row>
          </v-container>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            variant="text"
            @click="closeAddDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="saving"
            @click="saveDevice"
          >
            Add Device
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <DeviceEditDialog
      v-model="showEditDialog"
      :device="editingDevice"
    />

    <!-- Snackbar for notifications -->
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="snackbar.timeout"
      location="bottom right"
    >
      {{ snackbar.message }}
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="snackbar.show = false"
        >
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useAuthStore } from '@/stores/auth'
import DeviceMergeDialog from '@/components/devices/DeviceMergeDialog.vue'
import { useRoute, useRouter } from 'vue-router'
import { useDevicesStore } from '@/stores/devices'
import { useSettingsStore } from '@/stores/settings'
import { useWebSocket } from '@/composables/useWebSocket'
import DeviceTable from '@/components/devices/DeviceTable.vue'
import DeviceEditDialog from '@/components/devices/DeviceEditDialog.vue'
import { vendorOptions, platformOptions } from '@/models/vendors'
import { useDeviceForm, deviceTypes, managementModeOptions, deviceFormRules as rules } from '@/composables/useDeviceForm'

const route = useRoute()
const router = useRouter()
const devicesStore = useDevicesStore()
const settingsStore = useSettingsStore()
// Keeps the shared socket open while this page is mounted
useWebSocket()
const authStore = useAuthStore()
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))

// Possible duplicates, one group at a time. "Not duplicates" is remembered per
// browser (a convenience; the server re-reports the group elsewhere).
const DISMISSED_KEY = 'nethelper.dismissedDuplicates'
const readDismissed = () => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]')
  } catch {
    return []
  }
}
const dismissedDuplicates = ref(readDismissed())
const visibleDuplicates = computed(() =>
  (devicesStore.duplicateGroups || []).filter((g) => !dismissedDuplicates.value.includes(g.key))
)
const currentDuplicate = computed(() => visibleDuplicates.value[0] || null)
const showMergeDialog = ref(false)
const deviceTable = ref(null)

const dismissDuplicate = (group) => {
  dismissedDuplicates.value = [...dismissedDuplicates.value, group.key]
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissedDuplicates.value))
  } catch {
    // Storage unavailable: dismissed for this visit only.
  }
}

const onDuplicateMerged = () => {
  showMergeDialog.value = false
  deviceTable.value?.refreshTable?.()
}

// Credentials state
const loadingCredentials = ref(false)

// Component state
const showAddDialog = ref(false)
const showEditDialog = ref(false)
const saving = ref(false)
const { cloudIntegrationOptions, availableCredentials } = useDeviceForm()
const newDevice = ref({
  name: '',
  type: '',
  vendor: 'aruba',
  platform: null,
  ipAddress: '',
  macAddress: '',
  location: '',
  serialNumber: '',
  model: '',
  managementMode: 'direct',
  cloudIntegrationId: null,
  apiCredentialId: null
})
const editingDevice = ref(null)

const snackbar = ref({
  show: false,
  message: '',
  color: 'success',
  timeout: 4000
})

// Methods
const addDevice = async () => {
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
  showAddDialog.value = true
}

const closeAddDialog = () => {
  showAddDialog.value = false
  newDevice.value = {
    name: '',
    type: '',
    vendor: 'aruba',
    platform: null,
    ipAddress: '',
    macAddress: '',
    location: '',
    serialNumber: '',
    model: '',
    managementMode: 'direct',
    cloudIntegrationId: null,
    apiCredentialId: null
  }
}

const saveDevice = async () => {
  // Validate required fields
  if (!newDevice.value.name || !newDevice.value.type || !newDevice.value.ipAddress) {
    showSnackbar('Please fill in all required fields', 'error')
    return
  }

  saving.value = true

  try {
    const isCloud = newDevice.value.managementMode === 'cloud'

    // Prepare device data for backend
    const deviceData = {
      name: newDevice.value.name,
      type: newDevice.value.type,
      vendor: newDevice.value.vendor || 'aruba',
      platform: newDevice.value.platform || null,
      ipAddress: newDevice.value.ipAddress, // Required
      macAddress: newDevice.value.macAddress || undefined, // optional; never invent one
      location: newDevice.value.location || null,
      serial: newDevice.value.serialNumber?.trim() || null, // optional; blank is stored as no serial
      model: newDevice.value.model || '',
      managementMode: newDevice.value.managementMode || 'direct',
      cloudIntegrationId: isCloud ? (newDevice.value.cloudIntegrationId || null) : null,
      // Kept for cloud devices too: read-only local access (AOS-CX config
      // backup, live state) uses it. Writes still go through the provider.
      apiCredentialId: newDevice.value.apiCredentialId || null
    }

    // Create device via API
    await devicesStore.createDevice(deviceData)

    showSnackbar('Device added successfully', 'success')
    closeAddDialog()

  } catch (error) {
    console.error('Failed to add device:', error)
    const errorMessage = error.userMessage || error.message || 'Failed to add device'
    showSnackbar(errorMessage, 'error')
  } finally {
    saving.value = false
  }
}

const showSnackbar = (message, color = 'success') => {
  snackbar.value = {
    show: true,
    message,
    color,
    timeout: 4000
  }
}

// Handle edit device event from DeviceTable
const handleEditDevice = (device) => {
  editingDevice.value = device
  showEditDialog.value = true
}

// Status filter shared with the table. ?status= (the Dashboard's cards)
// seeds it; on this page the cards change it in place.
const STATUSES = ['online', 'offline', 'warning', 'maintenance']
const statusFilter = ref(STATUSES.includes(route.query.status) ? route.query.status : null)

const statCards = [
  { key: 'online', status: 'online', label: 'Online Devices', color: 'success', icon: 'mdi-check-circle' },
  { key: 'offline', status: 'offline', label: 'Offline Devices', color: 'error', icon: 'mdi-close-circle' },
  { key: 'warning', status: 'warning', label: 'Warning Devices', color: 'warning', icon: 'mdi-alert-circle' },
  { key: 'total', status: null, label: 'Total Devices', color: 'primary', icon: 'mdi-devices' }
]

const isActiveCard = (card) => card.status !== null && statusFilter.value === card.status

// Clicking the active card again (or Total) clears the status filter
const selectStatus = (status) => {
  statusFilter.value = status && statusFilter.value !== status ? status : null
}

// Keep the URL in step, so a reload or a shared link shows the same list
watch(statusFilter, (status) => {
  if ((route.query.status || null) === status) return
  router.replace({ query: { ...route.query, status: status || undefined } })
})
// ...and follow it when it changes under us (e.g. the Devices nav item drops ?status=)
watch(() => route.query.status, (status) => {
  const next = STATUSES.includes(status) ? status : null
  if (next !== statusFilter.value) statusFilter.value = next
})

// Initialize
onMounted(() => {
  devicesStore.fetchDuplicates().catch(() => {})
  // Needed by the cloud-integration selector in the add/edit dialogs.
  settingsStore.fetchCloudIntegrations().catch((error) => {
    console.error('Failed to load cloud integrations:', error)
  })
})
</script>

<style scoped>
.devices-view {
  background-color: rgb(var(--v-theme-background));
  min-height: 100vh;
}

.stats-card {
  transition: all 0.3s ease;
}

.stats-card:hover {
  transform: translateY(-1px);
}

/* Style the snackbar action button to be bold and match notification text color */
.snackbar-action-btn {
  font-weight: bold !important;
  opacity: 1 !important;
}
</style>