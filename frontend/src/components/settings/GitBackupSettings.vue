<template>
  <div>
    <div class="d-flex align-center mb-4">
      <div>
        <h2 class="text-h6">Configuration Backup Git Mirror</h2>
        <div class="text-body-2 text-medium-emphasis">
          Commit every captured device configuration into a Git repository. The local
          backup files stay authoritative &mdash; the mirror adds full history that
          survives retention pruning, plus optional off-box replication.
        </div>
      </div>
      <v-spacer />
      <v-btn
        v-if="config"
        size="small"
        variant="text"
        color="error"
        :loading="deleting"
        @click="deleteDialog = true"
      >
        Remove
      </v-btn>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" class="mb-4" closable @click:close="settingsStore.clearError('gitBackup')">
      {{ error }}
    </v-alert>

    <v-card variant="outlined">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-switch
              v-model="form.isActive"
              color="primary"
              density="compact"
              hide-details
              :label="form.isActive ? 'Mirror enabled' : 'Mirror disabled'"
            />
            <div class="text-caption text-medium-emphasis mb-4">
              While disabled, backups behave exactly as before &mdash; nothing is committed.
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <div v-if="config" class="d-flex align-center justify-md-end">
              <v-icon size="small" class="mr-1" :color="testColor">{{ testIcon }}</v-icon>
              <span class="text-body-2">
                {{ config.lastTested ? `Last tested ${formatDate(config.lastTested)}` : 'Never tested' }}
              </span>
            </div>
            <div v-if="config?.lastPush" class="d-flex align-center justify-md-end mt-1">
              <v-icon size="small" class="mr-1" :color="config.lastPushError ? 'error' : 'success'">
                {{ config.lastPushError ? 'mdi-cloud-alert' : 'mdi-cloud-check' }}
              </v-icon>
              <span class="text-body-2">Last push {{ formatDate(config.lastPush) }}</span>
            </div>
          </v-col>
        </v-row>

        <v-alert
          v-if="config?.lastPushError"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
        >
          Last push failed: {{ config.lastPushError }}
          <div class="text-caption mt-1">
            Commits are safe locally and will be pushed on the next successful run.
          </div>
        </v-alert>

        <v-row>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.repoPath"
              label="Repository path"
              :placeholder="defaults.repoPath"
              :hint="`Local directory on the backend host. Defaults to ${defaults.repoPath || './storage/config-repo'}`"
              persistent-hint
              density="comfortable"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.branch"
              label="Branch"
              placeholder="main"
              density="comfortable"
            />
          </v-col>
          <v-col cols="12">
            <v-text-field
              v-model="form.remoteUrl"
              label="Remote URL (optional)"
              placeholder="git@github.com:org/network-configs.git"
              hint="Leave blank to keep history local only. Pushed once per backup run; a failed push never fails a backup."
              persistent-hint
              density="comfortable"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.authorName" label="Commit author name" density="comfortable" />
          </v-col>
          <v-col cols="12" md="6">
            <v-text-field v-model="form.authorEmail" label="Commit author email" density="comfortable" />
          </v-col>

          <!-- Credential fields come from the backend catalog, so adding an auth
               method needs no change here. -->
          <v-col v-for="field in credentialFields" :key="field.key" cols="12" md="6">
            <v-text-field
              v-model="form.credentials[field.key]"
              :label="field.label"
              :type="field.secret && !revealed[field.key] ? 'password' : 'text'"
              :append-inner-icon="field.secret ? (revealed[field.key] ? 'mdi-eye-off' : 'mdi-eye') : undefined"
              :hint="field.secret && hasStoredSecret(field.key) ? 'Stored. Leave blank to keep it unchanged.' : undefined"
              persistent-hint
              autocomplete="off"
              density="comfortable"
              @click:append-inner="revealed[field.key] = !revealed[field.key]"
            />
          </v-col>
        </v-row>
      </v-card-text>

      <v-card-actions>
        <v-btn variant="text" :loading="testing" :disabled="!config" @click="test">Test</v-btn>
        <v-spacer />
        <v-btn color="primary" variant="flat" :loading="saving" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog v-model="deleteDialog" max-width="480">
      <v-card>
        <v-card-title>Remove Git backup configuration?</v-card-title>
        <v-card-text>
          Backups will stop being committed. The repository at
          <code>{{ config?.repoPath }}</code> is left on disk &mdash; no history is deleted.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="remove">Remove</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="6000">
      {{ snackbar.message }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore } from '@/stores/settings'

const settingsStore = useSettingsStore()
const {
  gitBackupConfig: config,
  gitBackupDefaults: defaults,
  gitBackupFields: credentialFields,
  gitBackupError: error,
} = storeToRefs(settingsStore)

const saving = ref(false)
const testing = ref(false)
const deleting = ref(false)
const deleteDialog = ref(false)
const revealed = reactive({})
const snackbar = reactive({ show: false, message: '', color: 'success' })

const form = reactive({
  repoPath: '',
  remoteUrl: '',
  branch: 'main',
  authorName: 'NetHelper',
  authorEmail: 'nethelper@localhost',
  isActive: false,
  credentials: {},
})

const formatDate = (value) => (value ? new Date(value).toLocaleString() : '')

const testColor = computed(() => {
  if (config.value?.lastTestStatus === 'success') return 'success'
  if (config.value?.lastTestStatus === 'failed') return 'error'
  return 'grey'
})

const testIcon = computed(() => {
  if (config.value?.lastTestStatus === 'success') return 'mdi-check-circle'
  if (config.value?.lastTestStatus === 'failed') return 'mdi-alert-circle'
  return 'mdi-help-circle'
})

// A masked value means the backend holds a secret we must not overwrite blindly.
const hasStoredSecret = (key) => config.value?.credentials?.[key] === '********'

const notify = (message, color = 'success') => {
  snackbar.message = message
  snackbar.color = color
  snackbar.show = true
}

/** Load the stored config into the form. Secrets stay blank = unchanged. */
const syncForm = () => {
  form.repoPath = config.value?.repoPath || defaults.value?.repoPath || ''
  form.remoteUrl = config.value?.remoteUrl || ''
  form.branch = config.value?.branch || 'main'
  form.authorName = config.value?.authorName || 'NetHelper'
  form.authorEmail = config.value?.authorEmail || 'nethelper@localhost'
  form.isActive = config.value?.isActive ?? false

  form.credentials = {}
  for (const field of credentialFields.value) {
    form.credentials[field.key] = field.secret ? '' : (config.value?.credentials?.[field.key] || '')
  }
}

watch(config, syncForm)

const save = async () => {
  saving.value = true
  try {
    // Drop blank secrets so the backend keeps what it already has.
    const credentials = {}
    for (const field of credentialFields.value) {
      const value = form.credentials[field.key]
      if (field.secret && !value) continue
      if (value !== undefined && value !== null) credentials[field.key] = value
    }

    await settingsStore.saveGitBackupConfig({
      repoPath: form.repoPath || defaults.value?.repoPath,
      remoteUrl: form.remoteUrl,
      branch: form.branch,
      authorName: form.authorName,
      authorEmail: form.authorEmail,
      isActive: form.isActive,
      credentials,
    })
    notify('Git backup configuration saved')
  } catch (err) {
    notify(err.message || 'Failed to save', 'error')
  } finally {
    saving.value = false
  }
}

const test = async () => {
  testing.value = true
  try {
    const result = await settingsStore.testGitBackupConfig()
    notify(result.message, result.success ? 'success' : 'error')
  } catch (err) {
    notify(err.message || 'Test failed', 'error')
  } finally {
    testing.value = false
  }
}

const remove = async () => {
  deleting.value = true
  try {
    await settingsStore.deleteGitBackupConfig()
    deleteDialog.value = false
    syncForm()
    notify('Git backup configuration removed. The repository was left on disk.')
  } catch (err) {
    notify(err.message || 'Failed to remove', 'error')
  } finally {
    deleting.value = false
  }
}

onMounted(async () => {
  await settingsStore.fetchGitBackupConfig().catch(() => {})
  syncForm()
})
</script>
