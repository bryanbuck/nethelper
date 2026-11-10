<template>
  <v-dialog
    :model-value="modelValue"
    max-width="720"
    scrollable
    :fullscreen="$vuetify.display.xs"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon>mdi-map-search-outline</v-icon>
        <span>Where is it?</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" aria-label="Close" @click="$emit('update:modelValue', false)" />
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="query"
          autofocus
          clearable
          variant="outlined"
          density="comfortable"
          prepend-inner-icon="mdi-magnify"
          label="MAC (or part), IP, hostname, user, vendor or port label"
          :loading="loading"
          hide-details="auto"
          :error-messages="error"
        />
        <p class="text-caption text-medium-emphasis mt-2 mb-3">
          Searches the wired devices seen on switch ports and your port notes.
        </p>

        <template v-if="results">
          <div v-if="!results.clients.length && !results.notes.length" class="text-body-2 text-medium-emphasis">
            Nothing found for "{{ searched }}".
          </div>

          <div v-if="results.clients.length" class="text-subtitle-2 mb-1">Seen on a port</div>
          <v-list v-if="results.clients.length" density="compact" class="wrap-lines mb-3">
            <v-list-item
              v-for="(c, i) in results.clients"
              :key="`c-${i}`"
              :to="portLink(c)"
              @click="$emit('update:modelValue', false)"
            >
              <v-list-item-title>
                {{ c.hostname || c.profile?.os || c.vendor || c.mac }}
                <v-chip size="x-small" variant="tonal" :color="c.state === 'gone' ? 'grey' : 'success'" class="ml-1">
                  {{ c.state === 'gone' ? 'gone' : 'here' }}
                </v-chip>
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ c.device.name }} port {{ c.portLabel }} · {{ c.mac }}<span v-if="c.ip"> · {{ c.ip }}</span>
                · {{ c.state === 'gone' ? `left ${timeAgo(c.goneAt)}` : `seen ${timeAgo(c.lastSeen)}` }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <div v-if="results.notes.length" class="text-subtitle-2 mb-1">Port notes</div>
          <v-list v-if="results.notes.length" density="compact" class="wrap-lines">
            <v-list-item
              v-for="(n, i) in results.notes"
              :key="`n-${i}`"
              :to="portLink(n)"
              @click="$emit('update:modelValue', false)"
            >
              <v-list-item-title>{{ n.label || '(no label)' }}</v-list-item-title>
              <v-list-item-subtitle>
                {{ n.device.name }} port {{ n.portLabel }}<span v-if="n.location"> · {{ n.location }}</span><span v-if="n.owner"> · {{ n.owner }}</span>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </template>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, watch, onUnmounted } from 'vue'
import portsService from '@/services/ports.service'
import { timeAgo } from '@/models/activity'

const props = defineProps({
  modelValue: { type: Boolean, default: false }
})
defineEmits(['update:modelValue'])

const query = ref('')
const searched = ref('')
const results = ref(null)
const loading = ref(false)
const error = ref('')
let timer = null
let seq = 0

function portLink(row) {
  return { path: `/devices/${row.device.id}`, query: { tab: 'ports', port: row.portLabel || row.port } }
}

async function run(q) {
  const mine = ++seq
  loading.value = true
  try {
    const data = await portsService.search(q)
    if (mine !== seq) return // a newer search is on its way
    results.value = data
    searched.value = q
    error.value = ''
  } catch (e) {
    if (mine === seq) error.value = e.userMessage || 'Search failed'
  } finally {
    if (mine === seq) loading.value = false
  }
}

watch(query, (value) => {
  clearTimeout(timer)
  const q = (value || '').trim()
  if (q.length < 2) {
    results.value = null
    error.value = ''
    return
  }
  timer = setTimeout(() => run(q), 350)
})

watch(() => props.modelValue, (open) => {
  if (!open) clearTimeout(timer)
})
onUnmounted(() => clearTimeout(timer))
</script>
