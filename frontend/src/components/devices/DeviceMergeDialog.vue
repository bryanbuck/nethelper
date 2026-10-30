<template>
  <v-dialog :model-value="modelValue" max-width="960" :fullscreen="$vuetify.display.xs" @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start icon="mdi-call-merge" />
        Merge devices
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 mb-4">
          These rows become one device. Choose the one to keep. The others are deleted after their
          events, config backups, groups, and backup schedules move to it. The kept row fills its
          missing details (serial, MAC, credential) from the others. If one of them came from a cloud
          sync, the kept row takes over that cloud link, so the next sync updates it instead of
          adding the device again.
        </p>

        <v-alert v-if="conflict" type="error" variant="tonal" density="compact" class="mb-4">
          {{ conflict }}
        </v-alert>

        <!-- Serial/MAC: established by the cloud or the device; a person picks only as a last resort -->
        <v-alert v-else-if="checking" type="info" variant="tonal" density="compact" class="mb-4" icon="mdi-progress-clock">
          Checking the real serial number and MAC with the cloud and the device…
        </v-alert>
        <v-alert v-else-if="identity" type="success" variant="tonal" density="compact" class="mb-4" icon="mdi-check-decagram">
          Serial <strong>{{ identity.serial }}</strong><template v-if="identity.macAddress"> and MAC <strong>{{ identity.macAddress }}</strong></template>
          confirmed by {{ identity.label }}. The merged device uses them.
        </v-alert>
        <v-alert v-else-if="needsChoice" type="warning" variant="tonal" density="compact" class="mb-4">
          <div class="mb-2">
            These rows have different serial numbers, and neither the cloud nor the device could
            confirm the real one{{ checkError ? ` (${checkError})` : '' }}. Choose it: the merged
            device gets that row's serial and MAC.
          </div>
          <v-radio-group v-model="identityId" hide-details density="compact">
            <v-radio
              v-for="d in serialRows"
              :key="d.id"
              :value="d.id"
              :label="`${d.serial}${d.macAddress ? ` / ${d.macAddress}` : ''} (from ${d.name}, ${managedLabel(d)}, added ${formatDate(d.createdAt)})`"
            />
          </v-radio-group>
        </v-alert>

        <v-radio-group v-model="targetId" hide-details>
          <v-table density="compact" class="merge-table">
            <thead>
              <tr>
                <th>Keep</th>
                <th>Name</th>
                <th>IP</th>
                <th>MAC</th>
                <th>Serial</th>
                <th>Managed</th>
                <th>Credential</th>
                <th>Live</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="d in devices" :key="d.id" :class="{ 'merge-target': d.id === targetId }">
                <td><v-radio :value="d.id" density="compact" hide-details /></td>
                <td class="font-weight-medium">{{ d.name }}</td>
                <td>{{ d.ipAddress || '—' }}</td>
                <td class="text-no-wrap">{{ d.macAddress || '—' }}</td>
                <td>{{ d.serial || '—' }}</td>
                <td>{{ managedLabel(d) }}</td>
                <td>{{ d.apiCredentialId ? 'Linked' : '—' }}</td>
                <td>{{ d.liveMonitoring ? 'On' : 'Off' }}</td>
                <td class="text-no-wrap">{{ formatDate(d.createdAt) }}</td>
              </tr>
            </tbody>
          </v-table>
        </v-radio-group>

        <div v-if="target && !conflict" class="text-body-2 mt-4">
          <strong>Result:</strong> {{ preview }}
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="merging" @click="emit('update:modelValue', false)">Cancel</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="merging"
          :disabled="!target || Boolean(conflict) || devices.length < 2 || checking || (needsChoice && !identityId)"
          @click="merge"
        >
          Merge {{ devices.length }} devices
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { format } from 'date-fns'
import { useDevicesStore } from '@/stores/devices'
import { useNotificationsStore } from '@/stores/notifications'
import { cloudProviderLabel } from '@/models/vendors'
import deviceService from '@/services/device.service'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  devices: { type: Array, default: () => [] },
  // Row to keep by default (e.g. the device page it was opened from).
  preferredId: { type: String, default: null },
})
const emit = defineEmits(['update:modelValue', 'merged'])

const devicesStore = useDevicesStore()
const notifications = useNotificationsStore()

const targetId = ref(null)
const identityId = ref(null)
const merging = ref(false)

const serialRows = computed(() => props.devices.filter((d) => d.serial))
const serialConflict = computed(() => new Set(serialRows.value.map((d) => d.serial)).size > 1)

// What the cloud/device say the serial and MAC are (POST /devices/merge/preview).
const checking = ref(false)
const identity = ref(null)
const checkError = ref(null)
const unresolved = ref(false) // the server could not establish the identity
const needsChoice = computed(() => !checking.value && !identity.value && (unresolved.value || serialConflict.value))

async function checkIdentity() {
  const ids = props.devices.map((d) => d.id)
  identity.value = null
  checkError.value = null
  unresolved.value = false
  if (ids.length < 2) return
  checking.value = true
  try {
    const result = await deviceService.previewMerge(ids[0], ids.slice(1))
    if (props.devices[0]?.id !== ids[0]) return // dialog reopened with other devices
    identity.value = result.data?.identity || null
    unresolved.value = Boolean(result.data?.needsChoice)
  } catch (err) {
    checkError.value = err.userMessage || err.message
  } finally {
    checking.value = false
  }
}

// Fallback default when a person must choose: the row the cloud inventory
// filled in (cloud-managed, with provider metadata), newest first.
function defaultIdentity() {
  const score = (d) => (d.managementMode === 'cloud' ? 2 : 0) + (Object.keys(d.metadata || {}).length ? 1 : 0)
  const ranked = [...serialRows.value].sort((a, b) =>
    score(b) - score(a) || new Date(b.createdAt) - new Date(a.createdAt))
  return ranked[0]?.id || null
}

// Default: the requested row, else the cloud row (it's what sync matches on),
// else the oldest.
function defaultTarget() {
  const list = props.devices
  if (props.preferredId && list.some((d) => d.id === props.preferredId)) return props.preferredId
  const cloudRow = list.find((d) => d.managementMode === 'cloud')
  if (cloudRow) return cloudRow.id
  const oldest = [...list].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))[0]
  return oldest?.id || null
}

watch(() => [props.modelValue, props.devices], () => {
  if (!props.modelValue) return
  targetId.value = defaultTarget()
  identityId.value = defaultIdentity()
  checkIdentity()
}, { immediate: true })

const target = computed(() => props.devices.find((d) => d.id === targetId.value) || null)
const sources = computed(() => props.devices.filter((d) => d.id !== targetId.value))

// Blocking problems only; a serial conflict is resolved by choosing identityId.
const conflict = computed(() => {
  const integrations = new Set(props.devices
    .filter((d) => d.managementMode === 'cloud' && d.cloudIntegrationId)
    .map((d) => d.cloudIntegrationId))
  if (integrations.size > 1) return 'These devices belong to different cloud integrations and cannot be merged.'
  return null
})

function managedLabel(d) {
  if (d.managementMode !== 'cloud') return 'Direct'
  return d.cloudIntegration?.name || cloudProviderLabel(d.cloudIntegration?.provider) || 'Cloud'
}

function formatDate(value) {
  try {
    return value ? format(new Date(value), 'MMM d, yyyy') : '—'
  } catch {
    return '—'
  }
}

// Mirrors mergedFields() in backend/src/services/device-merge.service.js.
const preview = computed(() => {
  const t = target.value
  if (!t) return ''
  const all = [t, ...sources.value]
  const chosen = needsChoice.value ? props.devices.find((d) => d.id === identityId.value) : null
  const real = identity.value || chosen
  const realRow = identity.value ? props.devices.find((d) => d.serial === identity.value.serial) : chosen
  const pick = (field) => (real && ['serial', 'macAddress'].includes(field) && real[field])
    || t[field] || sources.value.find((s) => s[field])?.[field]
  const cloudRow = realRow?.managementMode === 'cloud' ? realRow : all.find((d) => d.managementMode === 'cloud')
  const parts = [
    `"${t.name}"`,
    pick('ipAddress') || 'no IP',
    pick('serial') ? `serial ${pick('serial')}` : 'no serial',
    cloudRow ? `managed by ${managedLabel(cloudRow)}` : 'managed directly',
    pick('apiCredentialId') ? 'credential linked' : 'no credential',
    all.some((d) => d.liveMonitoring) ? 'always monitored' : 'not always monitored',
  ]
  return parts.join(', ')
})

async function merge() {
  merging.value = true
  try {
    const merged = await devicesStore.mergeDevices(
      targetId.value,
      sources.value.map((d) => d.id),
      needsChoice.value ? identityId.value : null,
    )
    notifications.showSuccess(`Merged ${props.devices.length} devices into ${merged.name}`)
    emit('merged', merged)
  } catch (err) {
    // The cloud/device answered at preview time but not now: let a person choose.
    if (err.response?.data?.code === 'identity_unresolved') {
      identity.value = null
      unresolved.value = true
    }
    notifications.showError(err.userMessage || err.message || 'Could not merge the devices')
  } finally {
    merging.value = false
  }
}
</script>

<style scoped>
.merge-table tr.merge-target td {
  background: rgba(var(--v-theme-primary), 0.08);
}
</style>
