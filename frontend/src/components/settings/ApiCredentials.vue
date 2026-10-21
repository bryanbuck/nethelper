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
        v-if="canEdit"
        color="primary"
        prepend-icon="mdi-plus"
        @click="openCreateDialog"
      >
        Add Credential
      </v-btn>
    </div>

    <!-- Loading State -->
    <v-progress-linear
      v-if="settingsStore.credentialsLoading"
      indeterminate
      color="primary"
      class="mb-4"
    ></v-progress-linear>

    <!-- Error Alert -->
    <v-alert
      v-if="settingsStore.credentialsError"
      type="error"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="settingsStore.clearError('credentials')"
    >
      {{ settingsStore.credentialsError }}
    </v-alert>

    <!-- Empty State -->
    <v-card v-if="!settingsStore.credentialsLoading && settingsStore.credentialCount === 0" class="text-center pa-8">
      <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-key-variant</v-icon>
      <div class="text-h6 mb-2">No API Credentials</div>
      <p v-if="canEdit" class="text-body-2 text-medium-emphasis mb-4">
        Add your first API credential to enable direct device polling
      </p>
      <v-btn v-if="canEdit" color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
        Add Your First Credential
      </v-btn>
    </v-card>

    <!-- Credentials Table -->
    <v-card v-else>
      <v-data-table
        :headers="headers"
        :items="settingsStore.apiCredentials"
        :loading="settingsStore.credentialsLoading"
        item-value="id"
        class="elevation-0"
      >
        <!-- Name Column -->
        <template #item.name="{ item }">
          <div class="d-flex align-center">
            <v-icon :color="getTypeColor(item.type)" size="small" class="mr-2">
              {{ getTypeIcon(item.type) }}
            </v-icon>
            <span class="font-weight-medium">{{ item.name }}</span>
          </div>
        </template>

        <!-- Type Column -->
        <template #item.type="{ item }">
          <v-chip :color="getTypeColor(item.type)" size="small" variant="tonal">
            {{ formatType(item.type) }}
          </v-chip>
        </template>

        <!-- Username Column -->
        <template #item.username="{ item }">
          <span>{{ item.username || '-' }}</span>
        </template>

        <!-- Last Tested Column -->
        <template #item.lastTested="{ item }">
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
        <template #item.actions="{ item }">
          <div v-if="canEdit" class="d-flex gap-1">
            <v-tooltip text="Test Connection">
              <template #activator="{ props }">
                <v-btn
                  v-bind="props"
                  icon="mdi-test-tube"
                  size="small"
                  variant="text"
                  :loading="testingId === item.id"
                  @click="testCredential(item)"
                ></v-btn>
              </template>
            </v-tooltip>

            <v-tooltip text="Edit">
              <template #activator="{ props }">
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
              <template #activator="{ props }">
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
              class="mb-2"
              @click:append-inner="showPassword = !showPassword"
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
              class="mb-2"
              @click:append-inner="showSecret = !showSecret"
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
            :loading="settingsStore.credentialsLoading"
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
            :loading="settingsStore.credentialsLoading"
            @click="confirmDelete"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Test Credential Dialog -->
    <v-dialog v-model="showTestDialog" max-width="600px">
      <v-card>
        <v-card-title>
          <v-icon class="mr-2">mdi-test-tube</v-icon>
          Test API Credential - {{ itemToTest?.name }}
        </v-card-title>

        <v-card-text>
          <div class="mb-4">
            <p class="text-body-2 text-medium-emphasis">
              Select a device to test this credential with:
            </p>
          </div>

          <v-autocomplete
            v-model="selectedTestDevice"
            :items="devicesUsingCredential"
            item-title="name"
            item-value="id"
            label="Select Device"
            variant="outlined"
            prepend-inner-icon="mdi-router-wireless"
            :loading="loadingDevicesForTest"
            :disabled="loadingDevicesForTest"
            class="mb-4"
          >
            <template #item="{ props, item }">
              <v-list-item
                v-bind="props"
                :subtitle="`${item.raw.type} - ${item.raw.ipAddress}`"
              >
              </v-list-item>
            </template>

            <template #no-data>
              <v-list-item>
                <v-list-item-title>No devices using this credential</v-list-item-title>
                <v-list-item-subtitle>Assign this credential to a device first</v-list-item-subtitle>
              </v-list-item>
            </template>
          </v-autocomplete>

          <div class="d-flex justify-end mb-4">
            <v-btn
              color="primary"
              variant="flat"
              prepend-icon="mdi-connection"
              :disabled="!selectedTestDevice"
              :loading="testingCredential"
              @click="executeCredentialTest"
            >
              Test Connection
            </v-btn>
          </div>

          <!-- Test Results -->
          <v-alert
            v-if="testResult"
            :type="testResult.success ? 'success' : 'error'"
            :icon="testResult.success ? 'mdi-check-circle' : 'mdi-alert-circle'"
            variant="tonal"
            closable
            @click:close="clearTestResult"
          >
            <div class="text-subtitle-2 mb-2">
              {{ testResult.success ? 'Connection Successful' : 'Connection Failed' }}
            </div>

            <div v-if="testResult.success">
              <div v-if="testResult.responseTime" class="mb-1">
                <strong>Response Time:</strong> {{ testResult.responseTime }}ms
              </div>

              <div v-if="testResult.deviceInfo">
                <strong>Device:</strong> {{ testResult.deviceInfo.hostname || 'Unknown' }}
                <span v-if="testResult.deviceInfo.model">
                  ({{ testResult.deviceInfo.model }})
                </span>
              </div>

              <div v-if="testResult.deviceInfo?.version">
                <strong>Version:</strong> {{ testResult.deviceInfo.version }}
              </div>
            </div>

            <div v-else>
              <div class="mb-2">{{ testResult.message }}</div>
            </div>
          </v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn color="grey" variant="text" @click="closeTestDialog">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import { useDevicesStore } from '@/stores/devices'
import { useNotificationsStore } from '@/stores/notifications'
import { format } from 'date-fns'
import debugLog, { DebugCategory } from '@/utils/debug'
import deviceApiService from '@/services/deviceApi.service'

const settingsStore = useSettingsStore()
const authStore = useAuthStore()
// Adding, editing, deleting and testing credentials are operator+
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))
const devicesStore = useDevicesStore()
const notificationStore = useNotificationsStore()

// Table headers
const headers = [
  { title: 'Name', key: 'name', sortable: true },
  { title: 'Type', key: 'type', sortable: true },
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
const showTestDialog = ref(false)
const dialogMode = ref('create') // 'create' or 'edit'
const formRef = ref(null)
const formValid = ref(false)
const showPassword = ref(false)
const showSecret = ref(false)

// Form data
const formData = ref({
  name: '',
  type: '',
  username: '',
  password: '',
  apiKey: '',
  apiSecret: '',
  notes: '',
})

const itemToDelete = ref(null)
const itemToTest = ref(null)
const editingItem = ref(null)

// Test dialog state
const selectedTestDevice = ref(null)
const testingCredential = ref(false)
const loadingDevicesForTest = ref(false)
const testResult = ref(null)
const devicesUsingCredential = ref([])

// Validation rules
const rules = {
  required: (value) => !!value || 'This field is required',
}

// Computed
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

const formatDate = (date) => {
  return format(new Date(date), 'MMM dd, yyyy HH:mm')
}

const openCreateDialog = () => {
  dialogMode.value = 'create'
  formData.value = {
    name: '',
    type: '',
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
  itemToTest.value = item
  loadingDevicesForTest.value = true
  showTestDialog.value = true

  try {
    // Load devices that are using this credential
    const allDevices = devicesStore.devices
    devicesUsingCredential.value = allDevices.filter(d => d.apiCredentialId === item.id)
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to load devices for test:', error)
    notificationStore.showError('Failed to load devices')
  } finally {
    loadingDevicesForTest.value = false
  }
}

const closeTestDialog = () => {
  showTestDialog.value = false
  itemToTest.value = null
  selectedTestDevice.value = null
  testResult.value = null
  devicesUsingCredential.value = []
}

const executeCredentialTest = async () => {
  if (!selectedTestDevice.value || !itemToTest.value) return

  testingCredential.value = true
  testResult.value = null

  try {
    // Use the device API test endpoint which will fetch the stored credentials
    // and test against the selected device
    const result = await deviceApiService.testDeviceConnection(selectedTestDevice.value)

    testResult.value = result

    if (result.success) {
      notificationStore.showSuccess('Connection test successful')
    } else {
      notificationStore.showWarning('Connection test failed')
    }
    // The test records its outcome on the credential either way
    await settingsStore.fetchApiCredentials()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to test credential:', error)
    testResult.value = {
      success: false,
      message: error.userMessage || error.message || 'Connection test failed',
      testedAt: new Date().toISOString()
    }
    notificationStore.showError(error.userMessage || 'Failed to test connection')
  } finally {
    testingCredential.value = false
  }
}

const clearTestResult = () => {
  testResult.value = null
}

onMounted(async () => {
  debugLog.progress(DebugCategory.SETTINGS, 'Loading API credentials')

  try {
    // Load credentials
    await settingsStore.fetchApiCredentials()

    // The test dialog lists every device using a credential
    await devicesStore.ensureAllDevices()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to load settings data:', error)

    // User-friendly error message
    const errorMessage = error.response?.status === 404
      ? 'Settings endpoint not found. Please ensure the backend is configured correctly.'
      : 'Failed to load settings. Please try refreshing the page.'

    notificationStore.showError(errorMessage)
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
