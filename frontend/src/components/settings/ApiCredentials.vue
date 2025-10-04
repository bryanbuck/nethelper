<template>
  <div class="api-credentials">
    <!-- Header with Add Button -->
    <div class="d-flex align-center justify-space-between mb-4">
      <div>
        <div class="text-h6 mb-1">API Credentials</div>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Manage API credentials for accessing individual device APIs. These credentials are used when polling devices directly for device-specific information.
        </p>
      </div>
      <v-btn
        color="primary"
        prepend-icon="mdi-plus"
        @click="openCreateDialog"
      >
        Add Credential
      </v-btn>
    </div>

    <!-- Loading State -->
    <v-progress-linear
      v-if="settingsStore.loading"
      indeterminate
      color="primary"
      class="mb-4"
    ></v-progress-linear>

    <!-- Error Alert -->
    <v-alert
      v-if="settingsStore.error"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="settingsStore.clearError()"
    >
      {{ settingsStore.error }}
    </v-alert>

    <!-- Empty State -->
    <v-card v-if="!settingsStore.loading && settingsStore.credentialCount === 0" class="text-center pa-8">
      <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-key-variant</v-icon>
      <div class="text-h6 mb-2">No API Credentials</div>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Add your first API credential to enable direct device polling
      </p>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
        Add Your First Credential
      </v-btn>
    </v-card>

    <!-- Credentials Table -->
    <v-card v-else>
      <v-data-table
        :headers="headers"
        :items="settingsStore.apiCredentials"
        :loading="settingsStore.loading"
        item-value="id"
        class="elevation-0"
      >
        <!-- Name Column -->
        <template v-slot:item.name="{ item }">
          <div class="d-flex align-center">
            <v-icon :color="getTypeColor(item.type)" size="small" class="mr-2">
              {{ getTypeIcon(item.type) }}
            </v-icon>
            <span class="font-weight-medium">{{ item.name }}</span>
          </div>
        </template>

        <!-- Type Column -->
        <template v-slot:item.type="{ item }">
          <v-chip :color="getTypeColor(item.type)" size="small" variant="tonal">
            {{ formatType(item.type) }}
          </v-chip>
        </template>

        <!-- Device Column -->
        <template v-slot:item.deviceId="{ item }">
          <span v-if="item.deviceId">
            {{ getDeviceName(item.deviceId) }}
          </span>
          <span v-else class="text-medium-emphasis">
            <v-icon size="small">mdi-minus</v-icon>
            Not assigned
          </span>
        </template>

        <!-- Username Column -->
        <template v-slot:item.username="{ item }">
          <span>{{ item.username || '-' }}</span>
        </template>

        <!-- Last Tested Column -->
        <template v-slot:item.lastTested="{ item }">
          <div v-if="item.lastTested">
            <div class="text-caption">{{ formatDate(item.lastTested) }}</div>
            <v-chip
              v-if="item.lastTestStatus"
              :color="item.lastTestStatus === 'success' ? 'success' : 'error'"
              size="x-small"
              variant="flat"
            >
              {{ item.lastTestStatus }}
            </v-chip>
          </div>
          <span v-else class="text-medium-emphasis">Never tested</span>
        </template>

        <!-- Actions Column -->
        <template v-slot:item.actions="{ item }">
          <div class="d-flex gap-1">
            <v-tooltip text="Test Connection">
              <template v-slot:activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-test-tube"
                  size="small"
                  variant="text"
                  @click="testCredential(item)"
                  :loading="testingId === item.id"
                ></v-btn>
              </template>
            </v-tooltip>

            <v-tooltip text="Edit">
              <template v-slot:activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-pencil"
                  size="small"
                  variant="text"
                  @click="openEditDialog(item)"
                ></v-btn>
              </template>
            </v-tooltip>

            <v-tooltip text="Delete">
              <template v-slot:activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-delete"
                  size="small"
                  variant="text"
                  color="error"
                  @click="openDeleteDialog(item)"
                ></v-btn>
              </template>
            </v-tooltip>
          </div>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/Edit Dialog -->
    <v-dialog v-model="showDialog" max-width="600px" persistent>
      <v-card>
        <v-card-title>
          <span class="text-h5">{{ dialogMode === 'create' ? 'Add' : 'Edit' }} API Credential</span>
        </v-card-title>

        <v-card-text>
          <v-form ref="formRef" v-model="formValid">
            <v-text-field
              v-model="formData.name"
              label="Credential Name"
              :rules="[rules.required]"
              variant="outlined"
              prepend-inner-icon="mdi-text"
              class="mb-2"
            ></v-text-field>

            <v-select
              v-model="formData.type"
              :items="credentialTypes"
              label="Credential Type"
              :rules="[rules.required]"
              variant="outlined"
              prepend-inner-icon="mdi-shape"
              class="mb-2"
            ></v-select>

            <v-autocomplete
              v-model="formData.deviceId"
              :items="devicesList"
              item-title="name"
              item-value="id"
              label="Associated Device (Optional)"
              variant="outlined"
              prepend-inner-icon="mdi-router-wireless"
              clearable
              class="mb-2"
            ></v-autocomplete>

            <v-text-field
              v-model="formData.username"
              label="Username"
              variant="outlined"
              prepend-inner-icon="mdi-account"
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model="formData.password"
              label="Password"
              :type="showPassword ? 'text' : 'password'"
              variant="outlined"
              prepend-inner-icon="mdi-lock"
              :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
              @click:append-inner="showPassword = !showPassword"
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model="formData.apiKey"
              label="API Key (Optional)"
              variant="outlined"
              prepend-inner-icon="mdi-key"
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model="formData.apiSecret"
              label="API Secret (Optional)"
              :type="showSecret ? 'text' : 'password'"
              variant="outlined"
              prepend-inner-icon="mdi-key-variant"
              :append-inner-icon="showSecret ? 'mdi-eye' : 'mdi-eye-off'"
              @click:append-inner="showSecret = !showSecret"
              class="mb-2"
            ></v-text-field>

            <v-textarea
              v-model="formData.notes"
              label="Notes (Optional)"
              variant="outlined"
              prepend-inner-icon="mdi-note-text"
              rows="3"
            ></v-textarea>
          </v-form>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            color="grey"
            variant="text"
            @click="closeDialog"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :disabled="!formValid"
            :loading="settingsStore.loading"
            @click="saveCredential"
          >
            {{ dialogMode === 'create' ? 'Add' : 'Save' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="400px">
      <v-card>
        <v-card-title class="text-h5">Delete Credential?</v-card-title>
        <v-card-text>
          Are you sure you want to delete the credential "{{ itemToDelete?.name }}"? This action cannot be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="grey" variant="text" @click="closeDeleteDialog">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="settingsStore.loading"
            @click="confirmDelete"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useDevicesStore } from '@/stores/devices'
import { useNotificationStore } from '@/stores/notifications'
import { format } from 'date-fns'
import debugLog, { DebugCategory } from '@/utils/debug'

const settingsStore = useSettingsStore()
const devicesStore = useDevicesStore()
const notificationStore = useNotificationStore()

// Table headers
const headers = [
  { title: 'Name', key: 'name', sortable: true },
  { title: 'Type', key: 'type', sortable: true },
  { title: 'Device', key: 'deviceId', sortable: false },
  { title: 'Username', key: 'username', sortable: false },
  { title: 'Last Tested', key: 'lastTested', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' },
]

// Credential types
const credentialTypes = [
  { title: 'Switch', value: 'switch' },
  { title: 'Access Point', value: 'ap' },
  { title: 'Gateway', value: 'gateway' },
  { title: 'Controller', value: 'controller' },
  { title: 'Other', value: 'other' },
]

// Dialog state
const showDialog = ref(false)
const showDeleteDialog = ref(false)
const dialogMode = ref('create') // 'create' or 'edit'
const formRef = ref(null)
const formValid = ref(false)
const showPassword = ref(false)
const showSecret = ref(false)
const testingId = ref(null)

// Form data
const formData = ref({
  name: '',
  type: '',
  deviceId: null,
  username: '',
  password: '',
  apiKey: '',
  apiSecret: '',
  notes: '',
})

const itemToDelete = ref(null)
const editingItem = ref(null)

// Validation rules
const rules = {
  required: (value) => !!value || 'This field is required',
}

// Computed
const devicesList = computed(() => devicesStore.devices || [])

// Methods
const getTypeColor = (type) => {
  const colors = {
    switch: 'blue',
    ap: 'green',
    gateway: 'orange',
    controller: 'purple',
    other: 'grey',
  }
  return colors[type] || 'grey'
}

const getTypeIcon = (type) => {
  const icons = {
    switch: 'mdi-lan',
    ap: 'mdi-wifi',
    gateway: 'mdi-router',
    controller: 'mdi-server',
    other: 'mdi-devices',
  }
  return icons[type] || 'mdi-help-circle'
}

const formatType = (type) => {
  return type.charAt(0).toUpperCase() + type.slice(1)
}

const getDeviceName = (deviceId) => {
  const device = devicesStore.devices.find(d => d.id === deviceId)
  return device ? device.name : 'Unknown Device'
}

const formatDate = (date) => {
  return format(new Date(date), 'MMM dd, yyyy HH:mm')
}

const openCreateDialog = () => {
  dialogMode.value = 'create'
  formData.value = {
    name: '',
    type: '',
    deviceId: null,
    username: '',
    password: '',
    apiKey: '',
    apiSecret: '',
    notes: '',
  }
  showDialog.value = true
}

const openEditDialog = (item) => {
  dialogMode.value = 'edit'
  editingItem.value = item
  formData.value = {
    name: item.name,
    type: item.type,
    deviceId: item.deviceId,
    username: item.username || '',
    password: '', // Don't populate password for security
    apiKey: item.apiKey || '',
    apiSecret: '', // Don't populate secret for security
    notes: item.notes || '',
  }
  showDialog.value = true
}

const closeDialog = () => {
  showDialog.value = false
  formData.value = {
    name: '',
    type: '',
    deviceId: null,
    username: '',
    password: '',
    apiKey: '',
    apiSecret: '',
    notes: '',
  }
  editingItem.value = null
  showPassword.value = false
  showSecret.value = false
}

const saveCredential = async () => {
  if (!formValid.value) return

  try {
    // Prepare data - only include password/secret if they were provided
    const data = {
      name: formData.value.name,
      type: formData.value.type,
      deviceId: formData.value.deviceId,
      username: formData.value.username,
      apiKey: formData.value.apiKey,
      notes: formData.value.notes,
    }

    // Only include password if provided
    if (formData.value.password) {
      data.password = formData.value.password
    }

    // Only include secret if provided
    if (formData.value.apiSecret) {
      data.apiSecret = formData.value.apiSecret
    }

    if (dialogMode.value === 'create') {
      await settingsStore.createApiCredential(data)
      notificationStore.showSuccess('API credential created successfully')
    } else {
      await settingsStore.updateApiCredential(editingItem.value.id, data)
      notificationStore.showSuccess('API credential updated successfully')
    }

    closeDialog()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to save credential:', error)
    notificationStore.showError(error.response?.data?.message || 'Failed to save credential')
  }
}

const openDeleteDialog = (item) => {
  itemToDelete.value = item
  showDeleteDialog.value = true
}

const closeDeleteDialog = () => {
  showDeleteDialog.value = false
  itemToDelete.value = null
}

const confirmDelete = async () => {
  try {
    await settingsStore.deleteApiCredential(itemToDelete.value.id)
    notificationStore.showSuccess('API credential deleted successfully')
    closeDeleteDialog()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to delete credential:', error)
    notificationStore.showError(error.response?.data?.message || 'Failed to delete credential')
  }
}

const testCredential = async (item) => {
  testingId.value = item.id
  try {
    const result = await settingsStore.testApiCredential(item.id)
    if (result.success) {
      notificationStore.showSuccess(`Credential test successful for "${item.name}"`)
    } else {
      notificationStore.showWarning(`Credential test failed: ${result.message}`)
    }
    // Refresh credentials to get updated test status
    await settingsStore.fetchApiCredentials()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to test credential:', error)
    notificationStore.showError(error.response?.data?.message || 'Failed to test credential')
  } finally {
    testingId.value = null
  }
}

onMounted(async () => {
  debugLog.progress(DebugCategory.SETTINGS, 'Loading API credentials')

  // Load credentials
  await settingsStore.fetchApiCredentials()

  // Load devices if not already loaded
  if (devicesStore.devices.length === 0) {
    await devicesStore.fetchDevices()
  }
})
</script>

<style scoped>
.api-credentials {
  max-width: 100%;
}

.gap-1 {
  gap: 0.25rem;
}
</style>
