<template>
  <v-dialog :model-value="modelValue" max-width="980" scrollable @update:model-value="close">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start icon="mdi-key-variant" />
        Device credential for {{ deviceIds.length }} device{{ deviceIds.length === 1 ? '' : 's' }}
      </v-card-title>

      <v-card-text>
        <p class="text-body-2 mb-4">
          NetHelper uses the device credential to reach a device directly: REST for AOS-CX (config
          backup, live state, network map, also when Central manages the switch), NETCONF for Junos
          (config backup and network map, also when Mist manages the switch), and SSH for the others.
          A cloud-managed switch is never reached over SSH. Devices that are reached only through
          their cloud platform are skipped.
        </p>

        <div class="d-flex flex-wrap align-center ga-4 mb-4">
          <v-btn-toggle v-model="mode" mandatory density="compact" variant="outlined" color="primary" :disabled="applied">
            <v-btn value="link" prepend-icon="mdi-link-variant">Link</v-btn>
            <v-btn value="unlink" prepend-icon="mdi-link-variant-off">Remove</v-btn>
          </v-btn-toggle>

          <v-select
            v-if="mode === 'link'"
            v-model="credentialId"
            :items="credentials"
            item-title="name"
            item-value="id"
            label="Credential"
            variant="outlined"
            density="compact"
            prepend-inner-icon="mdi-key-variant"
            hide-details
            :loading="loadingCredentials"
            :disabled="applied"
            :no-data-text="loadingCredentials ? 'Loading…' : 'No credentials yet. Add one under Settings → API Credentials.'"
            style="max-width: 360px; min-width: 260px;"
          >
            <template #item="{ props, item }">
              <v-list-item v-bind="props" :subtitle="`${item.raw.type} · ${item.raw.username || 'no username'}`" />
            </template>
          </v-select>

          <v-checkbox
            v-if="mode === 'link'"
            v-model="testAfter"
            label="Test the connection afterwards"
            density="compact"
            hide-details
            :disabled="applied"
          />
        </div>

        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-4">{{ error }}</v-alert>

        <div v-if="plan" class="d-flex flex-wrap ga-2 mb-3">
          <v-chip v-for="c in summaryChips" :key="c.outcome" :color="c.color" size="small" variant="tonal">
            {{ c.count }} {{ c.label }}
          </v-chip>
        </div>

        <v-progress-linear v-if="loadingPlan" indeterminate color="primary" class="mb-2" />

        <v-table v-if="plan" density="compact" class="credential-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>IP</th>
              <th>Platform</th>
              <th>Current credential</th>
              <th>{{ applied ? 'Result' : 'Change' }}</th>
              <th v-if="showTests">Connection test</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in plan.devices" :key="d.id">
              <td>
                {{ d.name || d.id }}
                <div v-if="d.managementMode === 'cloud'" class="text-caption text-medium-emphasis">Cloud-managed</div>
              </td>
              <td>{{ d.ipAddress || '—' }}</td>
              <td>{{ d.platformLabel || '—' }}</td>
              <td>{{ d.current?.name || '—' }}</td>
              <td>
                <v-chip :color="outcomeInfo[d.outcome].color" size="x-small" variant="flat">
                  {{ applied ? outcomeInfo[d.outcome].done : outcomeInfo[d.outcome].label }}
                </v-chip>
                <div v-if="d.reason || d.warning" class="text-caption" :class="d.warning ? 'text-warning' : 'text-medium-emphasis'">
                  {{ d.warning || d.reason }}
                </div>
              </td>
              <td v-if="showTests">
                <template v-if="tests[d.id]">
                  <v-progress-circular v-if="tests[d.id].state === 'running'" indeterminate size="16" width="2" />
                  <span v-else-if="tests[d.id].state === 'queued'" class="text-medium-emphasis">Queued</span>
                  <span v-else-if="tests[d.id].state === 'skipped'" class="text-medium-emphasis">{{ tests[d.id].message }}</span>
                  <template v-else>
                    <v-icon
                      :icon="tests[d.id].state === 'ok' ? 'mdi-check-circle' : 'mdi-alert-circle'"
                      :color="tests[d.id].state === 'ok' ? 'success' : 'error'"
                      size="small"
                    />
                    <span class="text-caption ml-1">{{ tests[d.id].message }}</span>
                  </template>
                </template>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving || testing" @click="close(false)">
          {{ applied ? 'Close' : 'Cancel' }}
        </v-btn>
        <v-btn
          v-if="!applied"
          color="primary"
          variant="flat"
          :loading="saving"
          :disabled="!changeCount || loadingPlan"
          @click="apply"
        >
          {{ applyLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import deviceService from '@/services/device.service'
import deviceApiService from '@/services/deviceApi.service'
import { useSettingsStore } from '@/stores/settings'
import { useNotificationsStore } from '@/stores/notifications'

const dialogProps = defineProps({
  modelValue: { type: Boolean, default: false },
  deviceIds: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'assigned'])

const settingsStore = useSettingsStore()
const notifications = useNotificationsStore()

// Connection tests log in to each device; a few at a time keeps a large
// selection from opening dozens of sessions at once.
const TEST_CONCURRENCY = 2

const outcomeInfo = {
  link: { label: 'Link', done: 'Linked', color: 'success', summary: 'to link' },
  replace: { label: 'Replace', done: 'Replaced', color: 'warning', summary: 'to replace' },
  unlink: { label: 'Remove', done: 'Removed', color: 'warning', summary: 'to remove' },
  unchanged: { label: 'No change', done: 'No change', color: 'grey', summary: 'unchanged' },
  skip: { label: 'Skip', done: 'Skipped', color: 'grey', summary: 'skipped' },
}

const mode = ref('link')
const credentialId = ref(null)
const testAfter = ref(true)
const loadingCredentials = ref(false)
const loadingPlan = ref(false)
const saving = ref(false)
const testing = ref(false)
const applied = ref(false)
const plan = ref(null)
const error = ref('')
const tests = ref({})

const credentials = computed(() => settingsStore.apiCredentials || [])
const targetCredential = computed(() => (mode.value === 'link' ? credentialId.value : null))
const ready = computed(() => mode.value === 'unlink' || !!credentialId.value)

const changeCount = computed(() => {
  const c = plan.value?.counts
  return c ? c.link + c.replace + c.unlink : 0
})

const summaryChips = computed(() =>
  Object.entries(plan.value?.counts || {})
    .filter(([, count]) => count > 0)
    .map(([outcome, count]) => ({
      outcome,
      count,
      color: outcomeInfo[outcome].color,
      label: applied.value ? outcomeInfo[outcome].done.toLowerCase() : outcomeInfo[outcome].summary,
    }))
)

const applyLabel = computed(() => {
  const n = changeCount.value
  const devices = `${n} device${n === 1 ? '' : 's'}`
  return mode.value === 'unlink' ? `Remove from ${devices}` : `Link to ${devices}`
})

const showTests = computed(() => Object.keys(tests.value).length > 0)

const loadCredentials = async () => {
  if (credentials.value.length) return
  loadingCredentials.value = true
  try {
    await settingsStore.fetchApiCredentials()
  } catch (err) {
    error.value = err.userMessage || err.message || 'Could not load credentials'
  } finally {
    loadingCredentials.value = false
  }
}

// Every change of action or credential re-asks the server what would happen,
// so the table always shows the outcome the Apply button will produce.
let planSeq = 0
const refreshPlan = async () => {
  if (!ready.value || !dialogProps.deviceIds.length) {
    plan.value = null
    return
  }
  const seq = ++planSeq
  loadingPlan.value = true
  error.value = ''
  try {
    const res = await deviceService.previewCredentialAssignment(dialogProps.deviceIds, targetCredential.value)
    if (seq === planSeq) plan.value = res.data
  } catch (err) {
    if (seq === planSeq) {
      plan.value = null
      error.value = err.userMessage || err.message
    }
  } finally {
    if (seq === planSeq) loadingPlan.value = false
  }
}

const reset = () => {
  mode.value = 'link'
  credentialId.value = null
  testAfter.value = true
  applied.value = false
  plan.value = null
  error.value = ''
  tests.value = {}
}

watch(() => dialogProps.modelValue, (open) => {
  if (!open) return
  reset()
  loadCredentials()
})

watch([mode, credentialId], () => {
  if (dialogProps.modelValue && !applied.value) refreshPlan()
})

const runTests = async (devices) => {
  const queue = []
  const next = {}
  for (const d of devices) {
    if (!d.ipAddress) {
      next[d.id] = { state: 'skipped', message: 'No IP address' }
    } else {
      next[d.id] = { state: 'queued' }
      queue.push(d)
    }
  }
  tests.value = next
  if (!queue.length) return

  testing.value = true
  let ok = 0
  let failed = 0
  const worker = async () => {
    while (queue.length) {
      const d = queue.shift()
      tests.value[d.id] = { state: 'running' }
      try {
        const result = await deviceApiService.testDeviceConnection(d.id)
        if (result.success) {
          ok += 1
          tests.value[d.id] = {
            state: 'ok',
            message: result.responseTime ? `Connected (${result.responseTime} ms)` : 'Connected',
          }
        } else {
          failed += 1
          tests.value[d.id] = { state: 'failed', message: result.message || result.error || 'Failed' }
        }
      } catch (err) {
        failed += 1
        tests.value[d.id] = { state: 'failed', message: err.userMessage || err.message || 'Failed' }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(TEST_CONCURRENCY, queue.length) }, worker))
  testing.value = false

  if (failed) notifications.showWarning(`${ok} connected, ${failed} failed. See the dialog for reasons.`, 'Connection tests')
  else notifications.showSuccess(`All ${ok} device(s) connected`)
}

const apply = async () => {
  saving.value = true
  error.value = ''
  try {
    const res = await deviceService.assignCredential(dialogProps.deviceIds, targetCredential.value)
    plan.value = res.data
    applied.value = true
    const n = res.data.updated
    const verb = mode.value === 'unlink' ? 'Credential removed from' : `${res.data.credential?.name || 'Credential'} linked to`
    notifications.showSuccess(`${verb} ${n} device${n === 1 ? '' : 's'}`)
    emit('assigned', res.data)

    if (mode.value === 'link' && testAfter.value) {
      const linked = res.data.devices.filter((d) => d.outcome === 'link' || d.outcome === 'replace' || d.outcome === 'unchanged')
      await runTests(linked)
    }
  } catch (err) {
    error.value = err.userMessage || err.message
  } finally {
    saving.value = false
  }
}

const close = (value = false) => {
  if (value) return
  emit('update:modelValue', false)
}
</script>

<style scoped>
.credential-table td {
  vertical-align: top;
  padding-top: 6px !important;
  padding-bottom: 6px !important;
}
</style>
