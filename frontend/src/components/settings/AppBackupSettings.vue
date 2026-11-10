<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-2 mb-4">
      <div>
        <h2 class="text-h6">Application Backup</h2>
        <div class="text-body-2 text-medium-emphasis">
          Archives of NetHelper itself: the database (inventory, users, credentials, settings,
          history) and the config-backup files. Restore runs from the command line with
          NetHelper stopped.
        </div>
      </div>
      <v-spacer />
      <ActionButton
        icon="mdi-backup-restore"
        label="Run now"
        keep-label
        color="primary"
        variant="flat"
        :loading="running"
        :disabled="loading || !tools?.ok"
        @click="runNow"
      />
    </div>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">{{ loadError }}</v-alert>
    <v-alert v-else-if="tools && !tools.ok" type="warning" variant="tonal" class="mb-4">
      Backups can't run on this host: {{ tools.error }}
    </v-alert>

    <v-card variant="outlined" class="mb-6">
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-switch
              v-model="form.enabled"
              color="primary"
              density="compact"
              hide-details
              :label="form.enabled ? 'Scheduled backups on' : 'Scheduled backups off'"
            />
            <div class="text-caption text-medium-emphasis">
              Run now works either way. A failed run raises the "Application backup failed" alert.
            </div>
          </v-col>
          <v-col cols="12" md="6" class="text-body-2">
            <div><span class="text-medium-emphasis">Saved to</span> <code>{{ overview?.path || '…' }}</code></div>
            <div v-if="tools?.pgDump" class="text-medium-emphasis">
              pg_dump {{ tools.pgDump.version }}<template v-if="tools.serverVersion">, PostgreSQL {{ tools.serverVersion.major }} server</template>
            </div>
          </v-col>

          <v-col cols="12" sm="6" md="3">
            <v-text-field
              v-model="form.cronExpression"
              label="Schedule (cron)"
              hint="Default 0 2 * * * (daily, 02:00)"
              persistent-hint
              density="comfortable"
            />
          </v-col>
          <v-col cols="12" sm="6" md="3">
            <v-text-field v-model="form.timezone" label="Time zone" placeholder="UTC" density="comfortable" />
          </v-col>
          <v-col cols="6" md="3">
            <v-text-field
              v-model.number="form.retainCount"
              type="number"
              min="1"
              label="Archives to keep"
              density="comfortable"
            />
          </v-col>
          <v-col cols="6" md="3">
            <v-text-field
              v-model="form.retainDays"
              type="number"
              min="1"
              label="Max age (days)"
              hint="Blank: no age limit"
              persistent-hint
              density="comfortable"
            />
          </v-col>

          <v-col cols="12" md="6">
            <v-checkbox
              v-model="form.includeHistory"
              density="compact"
              hide-details
              label="Include history (device events, cloud alarms, run history)"
            />
            <v-checkbox
              v-model="form.includeGitRepo"
              density="compact"
              hide-details
              label="Include the config Git mirror repository"
            />
            <div class="text-caption text-medium-emphasis ml-10">
              Not needed when the mirror pushes to a remote: the remote is its backup.
            </div>
          </v-col>
          <v-col cols="12" md="6">
            <v-checkbox
              v-model="form.encrypt"
              density="compact"
              hide-details
              label="Encrypt archives with a passphrase"
            />
            <template v-if="form.encrypt">
              <v-text-field
                v-model="form.passphrase"
                class="mt-2"
                label="Passphrase"
                :type="reveal ? 'text' : 'password'"
                :append-inner-icon="reveal ? 'mdi-eye-off' : 'mdi-eye'"
                :hint="config?.hasPassphrase ? 'Stored. Leave blank to keep it.' : 'At least 12 characters'"
                persistent-hint
                autocomplete="new-password"
                density="comfortable"
                @click:append-inner="reveal = !reveal"
              />
              <v-checkbox
                v-model="form.includeKey"
                density="compact"
                hide-details
                label="Include ENCRYPTION_KEY in the archive"
              />
              <div class="text-caption text-medium-emphasis ml-10">
                Lets a restore on a new host decrypt stored credentials. Keep the passphrase
                somewhere other than this server: without it the archive can't be opened.
              </div>
            </template>
            <div v-else class="text-caption text-medium-emphasis">
              Archives hold device configs with their secrets. Unencrypted ones are readable only by
              the NetHelper service account (mode 0600). ENCRYPTION_KEY is never stored in an
              unencrypted archive: keep a copy of it apart from the backups.
            </div>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="primary" variant="flat" :loading="saving" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>

    <h3 class="text-subtitle-1 font-weight-medium mb-2">Archives</h3>
    <v-data-table
      :headers="headers"
      :items="overview?.archives || []"
      :loading="loading"
      item-value="name"
      :items-per-page="10"
      no-data-text="No application backups yet"
      class="mb-6"
    >
      <template #item.name="{ item }">
        <span class="text-body-2">{{ item.name }}</span>
        <div v-if="item.keyMatches === false" class="text-caption text-warning">
          Made with a different ENCRYPTION_KEY
        </div>
      </template>
      <template #item.createdAt="{ item }">
        <span :title="new Date(item.createdAt).toLocaleString()">{{ timeAgo(item.createdAt) }}</span>
      </template>
      <template #item.sizeBytes="{ item }">{{ formatBytes(item.sizeBytes) }}</template>
      <template #item.contents="{ item }">
        <div class="d-flex flex-wrap ga-1">
          <v-chip v-if="item.encrypted" size="x-small" prepend-icon="mdi-lock">Encrypted</v-chip>
          <v-chip v-if="item.includesKey" size="x-small" prepend-icon="mdi-key">Key</v-chip>
          <v-chip v-if="item.includeHistory === false" size="x-small">No history</v-chip>
          <v-chip v-if="item.includeGitRepo" size="x-small" prepend-icon="mdi-git">Git repo</v-chip>
        </div>
      </template>
      <template #item.actions="{ item }">
        <div class="d-flex justify-end ga-1">
          <v-btn
            icon="mdi-download"
            size="small"
            variant="text"
            :title="`Download ${item.name}`"
            :aria-label="`Download ${item.name}`"
            :loading="downloading === item.name"
            @click="download(item)"
          />
          <v-btn
            icon="mdi-delete"
            size="small"
            variant="text"
            color="error"
            :title="`Delete ${item.name}`"
            :aria-label="`Delete ${item.name}`"
            @click="toDelete = item"
          />
        </div>
      </template>
    </v-data-table>

    <h3 class="text-subtitle-1 font-weight-medium mb-2">Recent runs</h3>
    <v-table v-if="overview?.runs?.length" density="compact" class="table-stack mb-4">
      <thead>
        <tr><th>Started</th><th>Trigger</th><th>Result</th><th>Duration</th></tr>
      </thead>
      <tbody>
        <tr v-for="run in overview.runs" :key="run.id">
          <td data-label="Started" class="text-no-wrap">{{ timeAgo(run.startedAt) }}</td>
          <td data-label="Trigger">{{ run.trigger }}</td>
          <td data-label="Result">
            <v-chip size="x-small" :color="runColor(run.status)" variant="tonal">{{ run.status }}</v-chip>
            <span v-if="run.error" class="text-caption ml-2">{{ run.error }}</span>
          </td>
          <td data-label="Duration" class="text-no-wrap">{{ run.durationMs != null ? `${(run.durationMs / 1000).toFixed(1)} s` : '—' }}</td>
        </tr>
      </tbody>
    </v-table>
    <div v-else class="text-body-2 text-medium-emphasis mb-4">No runs yet.</div>

    <v-expansion-panels variant="accordion">
      <v-expansion-panel title="How to restore">
        <v-expansion-panel-text class="text-body-2">
          <p class="mb-2">
            Stop NetHelper, then run the restore from the backend. It checks the archive (checksums,
            versions, the ENCRYPTION_KEY) first, replaces the database in a single transaction, and puts
            the config-backup files in place. <code>--dry-run</code> checks without changing anything.
          </p>
          <pre class="restore-cmd mb-2">docker compose stop backend
docker compose run --rm backend node scripts/app-restore.js --file /data/app-backups/&lt;archive&gt;
docker compose up -d</pre>
          <pre class="restore-cmd">sudo nethelper-admin restore /var/lib/nethelper/app-backups/&lt;archive&gt;</pre>
          <p class="mt-2 mb-0">Details: <code>deploy/README.md</code>, "Backup and restore".</p>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-dialog :model-value="Boolean(toDelete)" max-width="480" @update:model-value="(v) => { if (!v) toDelete = null }">
      <v-card>
        <v-card-title>Delete this backup?</v-card-title>
        <v-card-text>
          <code>{{ toDelete?.name }}</code> is removed from the server. This can't be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="toDelete = null">Cancel</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="confirmDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import ActionButton from '@/components/common/ActionButton.vue'
import appBackupService from '@/services/appBackup.service'
import { useNotificationsStore } from '@/stores/notifications'
import { useWebSocket } from '@/composables/useWebSocket'
import { usePhoneColumns } from '@/composables/usePhoneColumns'
import { formatBytes } from '@/models/system'
import { timeAgo } from '@/models/activity'

const notifications = useNotificationsStore()
const overview = ref(null)
const loading = ref(false)
const loadError = ref(null)
const saving = ref(false)
const running = ref(false)
const downloading = ref(null)
const deleting = ref(false)
const toDelete = ref(null)
const reveal = ref(false)

const config = computed(() => overview.value?.config || null)
const tools = computed(() => overview.value?.tools || null)

const form = reactive({
  enabled: false,
  cronExpression: '0 2 * * *',
  timezone: 'UTC',
  retainCount: 14,
  retainDays: '',
  includeHistory: true,
  includeGitRepo: false,
  encrypt: false,
  passphrase: '',
  includeKey: false
})

const allHeaders = [
  { title: 'Archive', key: 'name' },
  { title: 'Created', key: 'createdAt', cellProps: { class: 'text-no-wrap' } },
  { title: 'Size', key: 'sizeBytes', cellProps: { class: 'text-no-wrap' } },
  { title: 'Contents', key: 'contents', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end' }
]
const headers = usePhoneColumns(allHeaders, ['name', 'createdAt', 'actions'])

function fillForm(c) {
  Object.assign(form, {
    enabled: c.enabled,
    cronExpression: c.cronExpression,
    timezone: c.timezone,
    retainCount: c.retainCount,
    retainDays: c.retainDays ?? '',
    includeHistory: c.includeHistory,
    includeGitRepo: c.includeGitRepo,
    encrypt: c.encrypt,
    passphrase: '',
    includeKey: c.includeKey
  })
}

async function load({ keepForm = false } = {}) {
  loading.value = true
  try {
    overview.value = await appBackupService.overview()
    loadError.value = null
    running.value = overview.value.running
    if (!keepForm) fillForm(overview.value.config)
  } catch (error) {
    loadError.value = error.userMessage || error.message
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    const saved = await appBackupService.saveConfig({
      ...form,
      retainDays: form.retainDays === '' || form.retainDays == null ? null : Number(form.retainDays),
      passphrase: form.passphrase || undefined
    })
    overview.value = { ...overview.value, config: saved }
    fillForm(saved)
    notifications.showSuccess('Application backup settings saved')
  } catch (error) {
    notifications.showError(error.userMessage || error.message)
  } finally {
    saving.value = false
  }
}

async function runNow() {
  running.value = true
  try {
    await appBackupService.runNow()
    // A flash: the result is what stays in the history.
    notifications.showInfo('Application backup started', 'App Backup')
  } catch (error) {
    running.value = false
    notifications.showError(error.userMessage || error.message)
  }
}

async function download(item) {
  downloading.value = item.name
  try {
    const { blob, filename } = await appBackupService.download(item.name)
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  } catch (error) {
    notifications.showError(error.userMessage || error.message)
  } finally {
    downloading.value = null
  }
}

async function confirmDelete() {
  deleting.value = true
  try {
    await appBackupService.remove(toDelete.value.name)
    toDelete.value = null
    await load({ keepForm: true })
  } catch (error) {
    notifications.showError(error.userMessage || error.message)
  } finally {
    deleting.value = false
  }
}

function runColor(status) {
  return status === 'success' ? 'success' : status === 'failed' ? 'error' : 'info'
}

// Runs finish over the socket (manual and scheduled alike).
const { on: onSocket, off: offSocket } = useWebSocket()
const onCompleted = (e) => {
  running.value = false
  if (e?.run?.trigger === 'manual') notifications.showSuccess(`Application backup written: ${e.archive?.name}`, 'App Backup', { history: true })
  load({ keepForm: true })
}
const onFailed = (e) => {
  running.value = false
  if (e?.run?.trigger === 'manual') notifications.showError(`Application backup failed: ${e.error}`)
  load({ keepForm: true })
}
onSocket('app-backup:completed', onCompleted)
onSocket('app-backup:failed', onFailed)
onUnmounted(() => {
  offSocket('app-backup:completed', onCompleted)
  offSocket('app-backup:failed', onFailed)
})

onMounted(() => load())
</script>

<style scoped>
.restore-cmd {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 8px 12px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: 0.8125rem;
}
</style>
