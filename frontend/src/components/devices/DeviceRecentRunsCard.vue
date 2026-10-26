<template>
  <!-- The newest automation runs that targeted this device; nothing until one has -->
  <v-row v-if="runs.length" class="mt-4">
    <v-col cols="12">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon start>mdi-robot-outline</v-icon>
          Recent Automation Runs
          <v-spacer />
          <v-btn
            variant="text"
            size="small"
            :to="{ path: '/automations/executions', query: { deviceId } }"
          >
            {{ total > runs.length ? `All ${total} runs` : 'Run history' }}
          </v-btn>
        </v-card-title>
        <v-divider />
        <v-list density="compact">
          <v-list-item v-for="run in runs" :key="run.id">
            <template #prepend>
              <v-icon :color="executionStatusMeta(run.status).color" :icon="executionStatusMeta(run.status).icon" />
            </template>
            <v-list-item-title>
              <router-link
                v-if="run.automation"
                :to="`/automations/builder/${run.automation.id}`"
                class="text-primary text-decoration-none"
              >
                {{ run.automation.name }}
              </router-link>
              <span v-else>Deleted automation</span>
            </v-list-item-title>
            <v-list-item-subtitle>
              {{ executionStatusMeta(run.status).title }}
              &middot; {{ triggerMeta(run.trigger).title }}
              <template v-if="run.duration != null">&middot; {{ formatDuration(run.duration) }}</template>
            </v-list-item-subtitle>
            <div v-if="run.status === 'failed' && run.error" class="text-caption text-error">{{ run.error }}</div>
            <template #append>
              <span class="text-caption text-medium-emphasis" :title="new Date(run.createdAt).toLocaleString()">
                {{ formatDistanceToNow(new Date(run.createdAt), { addSuffix: true }) }}
              </span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </v-col>
  </v-row>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import { formatDistanceToNow } from 'date-fns'
import executionsService from '@/services/executions.service'
import { useWebSocket } from '@/composables/useWebSocket'
import { executionStatusMeta, triggerMeta, formatDuration } from '@/models/executions'

const props = defineProps({
  deviceId: { type: String, required: true }
})

const LIMIT = 5
const runs = ref([])
const total = ref(0)

let loadSeq = 0
async function load() {
  const seq = ++loadSeq
  try {
    const data = await executionsService.list({ deviceId: props.deviceId, limit: LIMIT })
    if (seq !== loadSeq) return
    runs.value = data.executions || []
    total.value = data.pagination?.total ?? runs.value.length
  } catch {
    // A convenience on the device page; Run History reports its own errors.
  }
}

// Runs start and finish over the socket; reload when one is for this device.
const { on: onSocket, off: offSocket } = useWebSocket()
let reloadTimer = null
const onRun = (e) => {
  if (e?.deviceId !== props.deviceId) return
  clearTimeout(reloadTimer)
  reloadTimer = setTimeout(load, 1000)
}
onSocket('automation:started', onRun)
onSocket('automation:completed', onRun)
onUnmounted(() => {
  clearTimeout(reloadTimer)
  offSocket('automation:started', onRun)
  offSocket('automation:completed', onRun)
})

watch(() => props.deviceId, () => {
  runs.value = []
  total.value = 0
  load()
}, { immediate: true })
</script>
