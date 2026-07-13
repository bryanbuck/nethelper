<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div>
        <h3 class="text-h6">Cloud Integrations</h3>
        <div class="text-caption text-medium-emphasis">
          Connect the cloud platforms that manage your devices. You can configure several at
          once — including more than one tenant of the same platform.
        </div>
      </div>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">
        Add Integration
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="settingsStore.clearError()">
      {{ error }}
    </v-alert>

    <v-card v-if="!loading && integrations.length === 0" variant="outlined" class="pa-6 text-center">
      <v-icon size="48" color="grey">mdi-cloud-off-outline</v-icon>
      <div class="text-subtitle-1 mt-2">No cloud integrations configured</div>
      <div class="text-caption text-medium-emphasis">
        Devices can still be managed directly over REST/SSH. Add an integration to sync
        inventory from a cloud platform.
      </div>
    </v-card>

    <v-row v-else>
      <v-col v-for="integration in integrations" :key="integration.id" cols="12" md="6">
        <v-card variant="outlined">
          <v-card-title class="d-flex align-center">
            <v-chip :color="providerColor(integration.provider)" size="small" class="mr-2">
              {{ providerLabel(integration.provider) }}
            </v-chip>
            <span class="text-subtitle-1">{{ integration.name }}</span>
            <v-spacer />
            <v-chip v-if="!integration.isActive" size="x-small" color="grey">Inactive</v-chip>
          </v-card-title>

          <v-card-text>
            <div class="text-caption text-medium-emphasis mb-2">{{ integration.baseUrl }}</div>

            <div class="d-flex align-center mb-1">
              <v-icon size="small" class="mr-1">mdi-devices</v-icon>
              <span class="text-body-2">{{ integration._count?.devices ?? 0 }} device(s) attributed</span>
            </div>

            <div class="d-flex align-center">
              <v-icon
                size="small"
                class="mr-1"
                :color="integration.lastTestStatus === 'success' ? 'success' : integration.lastTestStatus === 'failed' ? 'error' : 'grey'"
              >
                {{ integration.lastTestStatus === 'success' ? 'mdi-check-circle' : integration.lastTestStatus === 'failed' ? 'mdi-alert-circle' : 'mdi-help-circle' }}
              </v-icon>
              <span class="text-body-2">
                {{ integration.lastTested ? `Last tested ${formatDate(integration.lastTested)}` : 'Never tested' }}
              </span>
            </div>
          </v-card-text>

          <v-card-actions>
            <v-btn size="small" variant="text" :loading="testingId === integration.id" @click="testIntegration(integration)">
              Test
            </v-btn>
            <v-btn size="small" variant="text" :loading="syncingId === integration.id" @click="syncIntegration(integration)">
              Sync devices
            </v-btn>
            <v-spacer />
            <v-btn size="small" variant="text" icon="mdi-pencil" @click="openEdit(integration)" />
            <v-btn size="small" variant="text" icon="mdi-delete" color="error" @click="confirmDelete(integration)" />
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>

    <!-- Create / Edit dialog -->
    <v-dialog v-model="dialog" max-width="600" persistent>
      <v-card>
        <v-card-title>{{ editing ? 'Edit Cloud Integration' : 'Add Cloud Integration' }}</v-card-title>
        <v-card-text>
          <v-form ref="formRef">
            <v-select
              v-model="form.provider"
              :items="providerItems"
              item-title="title"
              item-value="value"
              label="Platform"
              :disabled="editing"
              :hint="editing ? 'The platform cannot be changed after creation' : 'Which cloud platform manages these devices?'"
              persistent-hint
              class="mb-3"
              @update:model-value="onProviderChange"
            />

            <v-text-field
              v-model="form.name"
              label="Name"
              hint="A label for this tenant, e.g. &quot;Prod Central&quot; or &quot;EU Mist Org&quot;"
              persistent-hint
              class="mb-3"
              :rules="[v => !!v || 'A name is required']"
            />

            <!-- Providers whose orgs live in a specific regional cloud (Mist)
                 get a picker; everyone else types a base URL. -->
            <v-select
              v-if="regions.length"
              v-model="form.baseUrl"
              :items="regions"
              item-title="label"
              item-value="baseUrl"
              label="Regional Cloud"
              hint="Your org lives in exactly one region — using the wrong one fails to authenticate. Check the address bar of your Mist portal."
              persistent-hint
              class="mb-3"
            />
            <v-text-field
              v-else
              v-model="form.baseUrl"
              label="API Base URL"
              :hint="`Default: ${selectedProvider?.defaultBaseUrl || ''}`"
              persistent-hint
              class="mb-3"
            />

            <!-- Credential fields are driven by the provider catalog from the API,
                 so a new provider needs no changes here. -->
            <v-text-field
              v-for="field in credentialFields"
              :key="field.key"
              v-model="form.credentials[field.key]"
              :label="field.label"
              :type="field.secret && !revealed[field.key] ? 'password' : 'text'"
              :append-inner-icon="field.secret ? (revealed[field.key] ? 'mdi-eye-off' : 'mdi-eye') : undefined"
              :hint="field.secret && editing ? 'Leave blank to keep the stored value' : undefined"
              :persistent-hint="field.secret && editing"
              :rules="field.secret && editing ? [] : [v => !!v || `${field.label} is required`]"
              class="mb-3"
              @click:append-inner="revealed[field.key] = !revealed[field.key]"
            />

            <v-switch v-model="form.isActive" label="Active" color="primary" density="compact" hide-details />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirmation -->
    <v-dialog v-model="deleteDialog" max-width="480">
      <v-card>
        <v-card-title>Delete integration?</v-card-title>
        <v-card-text>
          <p>
            <strong>{{ pendingDelete?.name }}</strong> will be removed. Devices synced from it are
            kept, but lose their cloud attribution and will no longer sync.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="5000">
      {{ snackbar.message }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, reactive, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { useDevicesStore } from '@/stores/devices'
import { CloudProviderInfo } from '@/models/vendors'

const settingsStore = useSettingsStore()
const devicesStore = useDevicesStore()
const { cloudIntegrations: integrations, cloudProviders, loading, error } = storeToRefs(settingsStore)

const dialog = ref(false)
const deleteDialog = ref(false)
const editing = ref(null)
const pendingDelete = ref(null)
const saving = ref(false)
const deleting = ref(false)
const testingId = ref(null)
const syncingId = ref(null)
const revealed = reactive({})
const snackbar = reactive({ show: false, message: '', color: 'success' })

const form = reactive({
  provider: null,
  name: '',
  baseUrl: '',
  credentials: {},
  isActive: true,
})

// Only providers the backend has actually implemented can be added.
const providerItems = computed(() =>
  cloudProviders.value.map(p => ({
    value: p.id,
    title: p.implemented ? p.label : `${p.label} (coming soon)`,
    props: { disabled: !p.implemented },
  }))
)

const selectedProvider = computed(() =>
  cloudProviders.value.find(p => p.id === form.provider)
)

const credentialFields = computed(() => selectedProvider.value?.credentialFields || [])

const regions = computed(() => selectedProvider.value?.regions || [])

const providerLabel = (id) =>
  cloudProviders.value.find(p => p.id === id)?.label || CloudProviderInfo[id]?.label || id

const providerColor = (id) => CloudProviderInfo[id]?.color || 'grey'

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '')

const resetForm = (provider = null) => {
  form.provider = provider
  form.name = ''
  form.baseUrl = cloudProviders.value.find(p => p.id === provider)?.defaultBaseUrl || ''
  form.credentials = {}
  form.isActive = true
  Object.keys(revealed).forEach(k => delete revealed[k])
}

const onProviderChange = (provider) => {
  form.baseUrl = cloudProviders.value.find(p => p.id === provider)?.defaultBaseUrl || ''
  form.credentials = {}
}

const openCreate = () => {
  editing.value = null
  const firstImplemented = cloudProviders.value.find(p => p.implemented)
  resetForm(firstImplemented?.id || null)
  dialog.value = true
}

const openEdit = (integration) => {
  editing.value = integration
  form.provider = integration.provider
  form.name = integration.name
  form.baseUrl = integration.baseUrl
  // Non-secret credential values come back from the API; secrets are masked
  // and left blank so a blank submit means "unchanged".
  form.credentials = {}
  for (const field of cloudProviders.value.find(p => p.id === integration.provider)?.credentialFields || []) {
    form.credentials[field.key] = field.secret ? '' : (integration.credentials?.[field.key] || '')
  }
  form.isActive = integration.isActive
  dialog.value = true
}

const notify = (message, color = 'success') => {
  snackbar.message = message
  snackbar.color = color
  snackbar.show = true
}

const save = async () => {
  saving.value = true
  try {
    if (editing.value) {
      // Drop blank secrets so the backend keeps the stored value.
      const credentials = {}
      for (const field of credentialFields.value) {
        const value = form.credentials[field.key]
        if (value !== '' && value !== null && value !== undefined) credentials[field.key] = value
      }
      await settingsStore.updateCloudIntegration(editing.value.id, {
        name: form.name,
        baseUrl: form.baseUrl,
        credentials,
        isActive: form.isActive,
      })
      notify('Integration updated')
    } else {
      await settingsStore.createCloudIntegration({
        provider: form.provider,
        name: form.name,
        baseUrl: form.baseUrl,
        credentials: { ...form.credentials },
        isActive: form.isActive,
      })
      notify('Integration created')
    }
    dialog.value = false
  } catch (err) {
    notify(err.message || 'Save failed', 'error')
  } finally {
    saving.value = false
  }
}

const testIntegration = async (integration) => {
  testingId.value = integration.id
  try {
    const result = await settingsStore.testCloudIntegration(integration.id)
    notify(result.message, result.success ? 'success' : 'error')
  } catch (err) {
    notify(err.message || 'Test failed', 'error')
  } finally {
    testingId.value = null
  }
}

const syncIntegration = async (integration) => {
  syncingId.value = integration.id
  try {
    await devicesStore.syncDevices(integration.id)
    notify(`Device sync started for ${integration.name}`)
  } catch (err) {
    notify(err.message || 'Sync failed', 'error')
  } finally {
    syncingId.value = null
  }
}

const confirmDelete = (integration) => {
  pendingDelete.value = integration
  deleteDialog.value = true
}

const doDelete = async () => {
  deleting.value = true
  try {
    await settingsStore.deleteCloudIntegration(pendingDelete.value.id)
    notify('Integration deleted')
    deleteDialog.value = false
  } catch (err) {
    notify(err.message || 'Delete failed', 'error')
  } finally {
    deleting.value = false
  }
}

onMounted(() => settingsStore.fetchCloudIntegrations())
</script>
