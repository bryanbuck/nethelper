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
              Run now works either way. A failed run raises the "Application backup failed" alert, and
              a schedule with no success for two scheduled runs raises "Application backup overdue".
            </div>
          </v-col>
          <v-col cols="12" md="6" class="text-body-2">
            <div><span class="text-medium-emphasis">Saved to</span> <code>{{ overview?.path || '…' }}</code></div>
            <div v-if="tools?.pgDump" class="text-medium-emphasis">
              pg_dump {{ tools.pgDump.version }}<template v-if="tools.serverVersion">, PostgreSQL {{ tools.serverVersion.major }} server</template>
            </div>
            <div v-if="schedule">
              <span class="text-medium-emphasis">Last success</span>
              {{ schedule.lastSuccessAt ? timeAgo(schedule.lastSuccessAt) : 'never' }}
            </div>
            <div v-if="schedule?.nextRunAt">
              <span class="text-medium-emphasis">Next scheduled run</span>
              <span :title="new Date(schedule.nextRunAt).toLocaleString()">{{ formatWhen(schedule.nextRunAt) }}</span>
            </div>
          </v-col>
          <v-col v-if="schedule?.overdueSince" cols="12" class="pt-0">
            <v-alert type="warning" variant="tonal" density="compact">
              Overdue: the schedule expected a backup by {{ new Date(schedule.overdueSince).toLocaleString() }}
              and none has succeeded since. Check the recent runs below and the backend log.
            </v-alert>
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

          <v-col cols="12">
            <v-divider class="mb-4" />
            <div class="text-subtitle-2 mb-1">Off-host copy</div>
            <div class="text-caption text-medium-emphasis mb-3">
              After each run, every archive kept here that the other server lacks is copied there
              over SFTP, and the same retention applies there. Archives must be encrypted. A failed
              copy raises "Application backup not copied off-host"; the next run tries again.
            </div>
            <v-btn-toggle
              v-model="form.remoteType"
              mandatory
              density="comfortable"
              variant="outlined"
              divided
              class="mb-4"
            >
              <v-btn value="none">None</v-btn>
              <v-btn value="sftp">SFTP server</v-btn>
            </v-btn-toggle>
          </v-col>
          <template v-if="form.remoteType === 'sftp'">
            <v-col cols="12" sm="8" md="4">
              <v-text-field v-model="form.sftpHost" label="Host" placeholder="nas.example.lan" density="comfortable" />
            </v-col>
            <v-col cols="4" md="2">
              <v-text-field v-model.number="form.sftpPort" type="number" min="1" max="65535" label="Port" density="comfortable" />
            </v-col>
            <v-col cols="8" md="3">
              <v-text-field v-model="form.sftpUsername" label="User" autocomplete="off" density="comfortable" />
            </v-col>
            <v-col cols="12" md="3">
              <v-text-field
                v-model="form.sftpPath"
                label="Folder"
                placeholder="nethelper-backups"
                hint="Must exist. Relative: from the user's home"
                persistent-hint
                density="comfortable"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-radio-group v-model="form.sftpAuth" inline hide-details density="compact" label="Sign in with">
                <v-radio value="password" label="Password" />
                <v-radio value="key" label="Private key" />
              </v-radio-group>
            </v-col>
            <v-col v-if="form.sftpAuth === 'password'" cols="12" md="8">
              <v-text-field
                v-model="form.sftpPassword"
                label="SFTP password"
                type="password"
                :hint="config?.sftpAuth === 'password' ? 'Stored. Leave blank to keep it.' : ''"
                persistent-hint
                autocomplete="new-password"
                density="comfortable"
              />
            </v-col>
            <template v-else>
              <v-col cols="12" md="8">
                <v-textarea
                  v-model="form.sftpPrivateKey"
                  label="Private key (OpenSSH or PEM)"
                  :placeholder="config?.sftpAuth === 'key' ? 'Stored. Leave blank to keep it.' : '-----BEGIN OPENSSH PRIVATE KEY-----'"
                  rows="3"
                  auto-grow
                  class="key-input"
                  autocomplete="off"
                  spellcheck="false"
                  density="comfortable"
                />
              </v-col>
              <v-col cols="12" md="4" offset-md="4">
                <v-text-field
                  v-model="form.sftpKeyPassphrase"
                  label="Key passphrase"
                  type="password"
                  :hint="config?.sftpKeyPassphrase ? 'Stored. Leave blank to keep it.' : 'Only for a protected key'"
                  persistent-hint
                  autocomplete="new-password"
                  density="comfortable"
                />
              </v-col>
            </template>
            <v-col cols="12" class="text-body-2">
              <div v-if="config?.sftpHostKey && sameHost">
                <span class="text-medium-emphasis">Pinned host key</span> <code>{{ config.sftpHostKey }}</code>
                <v-btn variant="text" size="small" class="ml-1" :loading="forgetting" @click="forgetHostKey">Forget</v-btn>
              </div>
              <div v-else class="text-medium-emphasis">
                The server's host key is pinned on the first connection; a later change is refused.
              </div>
              <div v-if="overview?.remote" class="mt-1">
                <span class="text-medium-emphasis">Last copy</span>
                {{ timeAgo(overview.remote.startedAt) }}:
                <v-chip size="x-small" :color="overview.remote.remoteStatus === 'uploaded' ? 'success' : 'error'" variant="tonal">
                  {{ overview.remote.remoteStatus }}
                </v-chip>
                <span v-if="overview.remote.remoteError" class="text-caption ml-1">{{ overview.remote.remoteError }}</span>
              </div>
              <v-alert
                v-if="testResult"
                :type="testResult.ok ? 'success' : 'error'"
                variant="tonal"
                density="compact"
                class="mt-2"
                closable
                @click:close="testResult = null"
              >
                <template v-if="testResult.ok">
                  Connected and wrote a test file. {{ testResult.archives }} archive(s) there now.
                  <template v-if="testResult.newlyPinned">Host key pinned: <code>{{ testResult.hostKey }}</code></template>
                </template>
                <template v-else>
                  {{ testResult.error }}
                  <div v-if="testResult.hostKey && !testResult.hostKeyMismatch" class="text-caption">
                    Server host key: <code>{{ testResult.hostKey }}</code>
                  </div>
                </template>
              </v-alert>
            </v-col>
          </template>
        </v-row>
      </v-card-text>
      <v-card-actions class="flex-wrap">
        <v-spacer />
        <v-btn
          v-if="form.remoteType === 'sftp'"
          variant="text"
          :loading="testing"
          :disabled="saving"
          @click="saveAndTest"
        >
          Save and test connection
        </v-btn>
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
        <tr><th>Started</th><th>Trigger</th><th>Result</th><th>Off-host</th><th>Duration</th></tr>
      </thead>
      <tbody>
        <tr v-for="run in overview.runs" :key="run.id">
          <td data-label="Started" class="text-no-wrap">{{ timeAgo(run.startedAt) }}</td>
          <td data-label="Trigger">{{ run.trigger }}</td>
          <td data-label="Result">
            <v-chip size="x-small" :color="runColor(run.status)" variant="tonal">{{ run.status }}</v-chip>
            <span v-if="run.error" class="text-caption ml-2">{{ run.error }}</span>
          </td>
          <td data-label="Off-host">
            <template v-if="run.remoteStatus">
              <v-chip size="x-small" :color="run.remoteStatus === 'uploaded' ? 'success' : 'error'" variant="tonal">{{ run.remoteStatus }}</v-chip>
              <span v-if="run.remoteError" class="text-caption ml-2">{{ run.remoteError }}</span>
            </template>
            <span v-else class="text-medium-emphasis">—</span>
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
const testing = ref(false)
const testResult = ref(null)
const forgetting = ref(false)

const config = computed(() => overview.value?.config || null)
const tools = computed(() => overview.value?.tools || null)
const schedule = computed(() => overview.value?.schedule || null)
// The pinned key belongs to the saved host and port, not to what's being typed.
const sameHost = computed(() => config.value
  && form.sftpHost === (config.value.sftpHost || '')
  && Number(form.sftpPort) === config.value.sftpPort)

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
  includeKey: false,
  remoteType: 'none',
  sftpHost: '',
  sftpPort: 22,
  sftpUsername: '',
  sftpPath: '',
  sftpAuth: 'password',
  sftpPassword: '',
  sftpPrivateKey: '',
  sftpKeyPassphrase: ''
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
    includeKey: c.includeKey,
    remoteType: c.remoteType || 'none',
    sftpHost: c.sftpHost || '',
    sftpPort: c.sftpPort || 22,
    sftpUsername: c.sftpUsername || '',
    sftpPath: c.sftpPath || '',
    sftpAuth: c.sftpAuth || 'password',
    sftpPassword: '',
    sftpPrivateKey: '',
    sftpKeyPassphrase: ''
  })
}

function formatWhen(iso) {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
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

function payload() {
  return {
    ...form,
    retainDays: form.retainDays === '' || form.retainDays == null ? null : Number(form.retainDays),
    // Blank secrets keep the stored ones.
    passphrase: form.passphrase || undefined,
    sftpPassword: form.sftpPassword || undefined,
    sftpPrivateKey: form.sftpPrivateKey || undefined,
    sftpKeyPassphrase: form.sftpKeyPassphrase || undefined
  }
}

async function save({ quiet = false, extra = {} } = {}) {
  saving.value = true
  try {
    const saved = await appBackupService.saveConfig({ ...payload(), ...extra })
    overview.value = { ...overview.value, config: saved }
    fillForm(saved)
    if (!quiet) notifications.showSuccess('Application backup settings saved')
    // Next run and overdue state follow the schedule just saved.
    load({ keepForm: true })
    return true
  } catch (error) {
    notifications.showError(error.userMessage || error.message)
    return false
  } finally {
    saving.value = false
  }
}

async function saveAndTest() {
  testResult.value = null
  if (!(await save({ quiet: true }))) return
  testing.value = true
  try {
    testResult.value = await appBackupService.testRemote()
    if (testResult.value.newlyPinned) await load({ keepForm: true })
  } catch (error) {
    testResult.value = { ok: false, error: error.userMessage || error.message }
  } finally {
    testing.value = false
  }
}

async function forgetHostKey() {
  forgetting.value = true
  try {
    await save({ quiet: true, extra: { forgetHostKey: true } })
    notifications.showSuccess('Pinned host key forgotten: the next connection pins a new one')
  } finally {
    forgetting.value = false
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
.key-input :deep(textarea) {
  font-family: monospace;
  font-size: 0.75rem;
}
.restore-cmd {
  white-space: pre-wrap;
  word-break: break-all;
  padding: 8px 12px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  font-size: 0.8125rem;
}
</style>
