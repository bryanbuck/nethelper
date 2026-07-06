<template>
  <div class="aruba-central-credentials">
    <!-- Header with Add Button -->
    <div class="d-flex align-center justify-space-between mb-4">
      <div>
        <div class="text-h6 mb-1">Aruba Central API Credentials</div>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Configure your Aruba Central API credentials for network device management and automation.
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
    <v-card v-if="!settingsStore.loading && settingsStore.arubaCentralConfigs.length === 0" class="text-center pa-8">
      <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-cloud-lock</v-icon>
      <div class="text-h6 mb-2">No Aruba Central Configuration</div>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Add your Aruba Central API credentials to enable integration
      </p>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreateDialog">
        Add Configuration
      </v-btn>
    </v-card>

    <!-- Credentials Table -->
    <v-card v-else>
      <v-data-table
        :headers="headers"
        :items="settingsStore.arubaCentralConfigs"
        :loading="settingsStore.loading"
        item-value="id"
        class="elevation-0"
      >
        <!-- Base URL Column -->
        <template v-slot:item.baseUrl="{ item }">
          <div class="d-flex align-center">
            <v-icon color="primary" size="small" class="mr-2">
              mdi-cloud
            </v-icon>
            <span class="font-weight-medium">{{ item.baseUrl }}</span>
          </div>
        </template>

        <!-- Client ID Column -->
        <template v-slot:item.clientId="{ item }">
          <span class="text-caption font-mono">{{ item.clientId }}</span>
        </template>

        <!-- Customer ID Column -->
        <template v-slot:item.customerId="{ item }">
          <span class="text-caption font-mono">{{ item.customerId }}</span>
        </template>

        <!-- Status Column -->
        <template v-slot:item.status="{ item }">
          <v-chip
            :color="item.isActive ? 'success' : 'grey'"
            size="small"
            variant="tonal"
          >
            {{ item.isActive ? 'Active' : 'Inactive' }}
          </v-chip>
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
                  @click="testConnection(item)"
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
          <span class="text-h5">{{ dialogMode === 'create' ? 'Add' : 'Edit' }} Aruba Central Configuration</span>
        </v-card-title>

        <v-card-text>
          <v-form ref="formRef" v-model="formValid">
            <v-text-field
              v-model="formData.baseUrl"
              label="Base URL"
              :rules="[rules.required, rules.url]"
              variant="outlined"
              prepend-inner-icon="mdi-link"
              placeholder="https://apigw-prod2.central.arubanetworks.com"
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model="formData.clientId"
              label="Client ID"
              :rules="[rules.required]"
              variant="outlined"
              prepend-inner-icon="mdi-identifier"
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model="formData.clientSecret"
              label="Client Secret"
              :type="showSecret ? 'text' : 'password'"
              :rules="dialogMode === 'create' ? [rules.required] : []"
              variant="outlined"
              prepend-inner-icon="mdi-key-variant"
              :append-inner-icon="showSecret ? 'mdi-eye' : 'mdi-eye-off'"
              @click:append-inner="showSecret = !showSecret"
              :placeholder="dialogMode === 'edit' ? 'Leave empty to keep current secret' : ''"
              class="mb-2"
            ></v-text-field>

            <v-text-field
              v-model="formData.customerId"
              label="Customer ID"
              :rules="[rules.required]"
              variant="outlined"
              prepend-inner-icon="mdi-account-box"
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
            @click="saveConfiguration"
          >
            {{ dialogMode === 'create' ? 'Add' : 'Save' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="showDeleteDialog" max-width="400px">
      <v-card>
        <v-card-title class="text-h5">Delete Configuration?</v-card-title>
        <v-card-text>
          Are you sure you want to delete this Aruba Central API configuration? This action cannot be undone.
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

    <!-- Test Result Dialog -->
    <v-dialog v-model="showTestDialog" max-width="500px">
      <v-card>
        <v-card-title>
          <v-icon class="mr-2">mdi-test-tube</v-icon>
          Connection Test Result
        </v-card-title>

        <v-card-text>
          <v-alert
            v-if="testResult"
            :type="testResult.success ? 'success' : 'error'"
            :icon="testResult.success ? 'mdi-check-circle' : 'mdi-alert-circle'"
            variant="tonal"
          >
            <div class="text-subtitle-2 mb-2">
              {{ testResult.success ? 'Connection Successful' : 'Connection Failed' }}
            </div>

            <div v-if="testResult.success">
              <div v-if="testResult.responseTime" class="mb-1">
                <strong>Response Time:</strong> {{ testResult.responseTime }}ms
              </div>
              <div v-if="testResult.message">
                {{ testResult.message }}
              </div>
            </div>

            <div v-else>
              <div class="mb-2">{{ testResult.message || 'Failed to connect to Aruba Central API' }}</div>
              <div v-if="testResult.details" class="text-caption">
                {{ testResult.details }}
              </div>
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
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useNotificationsStore } from '@/stores/notifications'
import { format } from 'date-fns'
import debugLog, { DebugCategory } from '@/utils/debug'

const settingsStore = useSettingsStore()
const notificationStore = useNotificationsStore()

// Table headers
const headers = [
  { title: 'Base URL', key: 'baseUrl', sortable: true },
  { title: 'Client ID', key: 'clientId', sortable: false },
  { title: 'Customer ID', key: 'customerId', sortable: false },
  { title: 'Status', key: 'status', sortable: true },
  { title: 'Last Tested', key: 'lastTested', sortable: true },
  { title: 'Actions', key: 'actions', sortable: false, align: 'end' },
]

// Dialog state
const showDialog = ref(false)
const showDeleteDialog = ref(false)
const showTestDialog = ref(false)
const dialogMode = ref('create') // 'create' or 'edit'
const formRef = ref(null)
const formValid = ref(false)
const showSecret = ref(false)

// Form data
const formData = ref({
  baseUrl: '',
  clientId: '',
  clientSecret: '',
  customerId: '',
  notes: '',
})

const itemToDelete = ref(null)
const editingItem = ref(null)
const testingId = ref(null)
const testResult = ref(null)

// Validation rules
const rules = {
  required: (value) => !!value || 'This field is required',
  url: (value) => {
    if (!value) return true
    try {
      new URL(value)
      return true
    } catch {
      return 'Please enter a valid URL'
    }
  },
}

// Methods
const formatDate = (date) => {
  return format(new Date(date), 'MMM dd, yyyy HH:mm')
}

const openCreateDialog = () => {
  dialogMode.value = 'create'
  formData.value = {
    baseUrl: 'https://apigw-prod2.central.arubanetworks.com',
    clientId: '',
    clientSecret: '',
    customerId: '',
    notes: '',
  }
  showDialog.value = true
}

const openEditDialog = (item) => {
  dialogMode.value = 'edit'
  editingItem.value = item
  formData.value = {
    baseUrl: item.baseUrl,
    clientId: item.clientId,
    clientSecret: '', // Don't populate secret for security
    customerId: item.customerId,
    notes: item.notes || '',
  }
  showDialog.value = true
}

const closeDialog = () => {
  showDialog.value = false
  formData.value = {
    baseUrl: '',
    clientId: '',
    clientSecret: '',
    customerId: '',
    notes: '',
  }
  editingItem.value = null
  showSecret.value = false
}

const saveConfiguration = async () => {
  if (!formValid.value) return

  try {
    // Prepare data - only include secret if provided
    const data = {
      baseUrl: formData.value.baseUrl,
      clientId: formData.value.clientId,
      customerId: formData.value.customerId,
      notes: formData.value.notes,
    }

    // Only include secret if provided (for edit mode, it's optional)
    if (formData.value.clientSecret) {
      data.clientSecret = formData.value.clientSecret
    }

    await settingsStore.saveArubaCentralConfig(data)

    notificationStore.showSuccess(
      dialogMode.value === 'create'
        ? 'Aruba Central configuration created successfully'
        : 'Aruba Central configuration updated successfully'
    )

    closeDialog()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to save Aruba Central config:', error)
    notificationStore.showError(error.response?.data?.message || 'Failed to save configuration')
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
    await settingsStore.deleteArubaCentralConfig(itemToDelete.value.id)
    notificationStore.showSuccess('Aruba Central configuration deleted successfully')
    closeDeleteDialog()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to delete Aruba Central config:', error)
    notificationStore.showError(error.response?.data?.message || 'Failed to delete configuration')
  }
}

const testConnection = async (item) => {
  testingId.value = item.id
  testResult.value = null

  try {
    const result = await settingsStore.testArubaCentralConnection(item.id)
    testResult.value = result

    showTestDialog.value = true

    if (result.success) {
      notificationStore.showSuccess('Connection test successful')
      // Refresh configs to update last tested status
      await settingsStore.fetchArubaCentralConfigs()
    } else {
      notificationStore.showWarning('Connection test failed')
    }
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to test Aruba Central connection:', error)
    testResult.value = {
      success: false,
      message: error.response?.data?.message || error.message || 'Connection test failed',
      details: error.response?.data?.details || ''
    }
    showTestDialog.value = true
    notificationStore.showError('Failed to test connection')
  } finally {
    testingId.value = null
  }
}

const closeTestDialog = () => {
  showTestDialog.value = false
  testResult.value = null
}

onMounted(async () => {
  debugLog.progress(DebugCategory.SETTINGS, 'Loading Aruba Central configurations')

  try {
    await settingsStore.fetchArubaCentralConfigs()
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to load Aruba Central configs:', error)

    // User-friendly error message
    const errorMessage = error.response?.status === 404
      ? 'Aruba Central API endpoint not found. Please ensure the backend is configured correctly.'
      : 'Failed to load Aruba Central configuration. Please try refreshing the page.'

    notificationStore.showError(errorMessage)
  }
})
</script>

<style scoped>
.aruba-central-credentials {
  max-width: 100%;
}

.gap-1 {
  gap: 0.25rem;
}

.font-mono {
  font-family: 'Courier New', monospace;
}
</style>
