<template>
  <v-dialog :model-value="modelValue" max-width="960" @update:model-value="emit('update:modelValue', $event)">
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
          :disabled="!target || Boolean(conflict) || devices.length < 2"
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
const merging = ref(false)

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
  if (props.modelValue) targetId.value = defaultTarget()
}, { immediate: true })

const target = computed(() => props.devices.find((d) => d.id === targetId.value) || null)
const sources = computed(() => props.devices.filter((d) => d.id !== targetId.value))

const conflict = computed(() => {
  const serials = new Set(props.devices.map((d) => d.serial).filter(Boolean))
  if (serials.size > 1) return 'These devices have different serial numbers, so they are different hardware and cannot be merged.'
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
  const pick = (field) => t[field] || sources.value.find((s) => s[field])?.[field]
  const cloudRow = all.find((d) => d.managementMode === 'cloud')
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
    const merged = await devicesStore.mergeDevices(targetId.value, sources.value.map((d) => d.id))
    notifications.showSuccess(`Merged ${props.devices.length} devices into ${merged.name}`)
    emit('merged', merged)
  } catch (err) {
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
