<template>
  <v-dialog v-model="show" max-width="1100" :fullscreen="$vuetify.display.xs" scrollable>
    <v-card>
      <v-card-title class="text-h5">Compare Backups</v-card-title>
      <v-card-text>
        <v-row>
          <v-col cols="12" md="6">
            <v-select
              v-model="fromId"
              :items="candidates"
              :loading="loadingRows"
              label="From (older)"
              density="compact"
              @update:model-value="loadDiff"
            />
          </v-col>
          <v-col cols="12" md="6">
            <v-select
              v-model="toId"
              :items="candidates"
              :loading="loadingRows"
              label="To (newer)"
              density="compact"
              @update:model-value="loadDiff"
            />
          </v-col>
        </v-row>

        <div v-if="diffResult?.kinds?.length > 1" class="d-flex align-center mb-3">
          <span class="text-body-2 text-medium-emphasis mr-3">Compare</span>
          <v-btn-toggle
            v-model="kind"
            density="compact"
            variant="outlined"
            mandatory
            @update:model-value="loadDiff"
          >
            <v-btn v-for="k in diffResult.kinds" :key="k" :value="k" size="small">
              {{ KIND_LABELS[k] || k }}
            </v-btn>
          </v-btn-toggle>
        </div>

        <v-progress-linear v-if="loadingDiff" indeterminate color="primary" class="mb-3" />
        <ConfigDiffViewer
          v-else-if="diffResult"
          :patch="diffResult.patch"
          :additions="diffResult.additions"
          :deletions="diffResult.deletions"
          :identical="diffResult.identical"
        />
        <div v-else class="text-medium-emphasis text-center pa-4">
          Select two backups to compare.
        </div>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="show = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
// The Compare dialog for device or cloud-scope backups, shared by the Config
// Backups page and the device page's History tab. Opened with `open()`.
import { ref, computed } from 'vue'
import { useBackupsStore } from '@/stores/backups'
import ConfigDiffViewer from '@/components/backups/ConfigDiffViewer.vue'

const emit = defineEmits(['error'])
const backupsStore = useBackupsStore()

const KIND_LABELS = { cli: 'CLI', structured: 'JSON' }

const show = ref(false)
const mode = ref('device')
const rows = ref([])
const loadingRows = ref(false)
const fromId = ref(null)
const toId = ref(null)
const kind = ref(null)
const diffResult = ref(null)
const loadingDiff = ref(false)

// Candidates are the device's (or scope's) whole history, loaded on open:
// callers hold only a page of it (or, on the History tab, just two ids).
const candidates = computed(() =>
  rows.value.map(b => ({ title: new Date(b.createdAt).toLocaleString(), value: b.id }))
)

const withRows = (list, ...seed) => {
  const out = [...list]
  for (const b of seed) if (b && !out.some(r => r.id === b.id)) out.push(b)
  return out.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

let openSeq = 0
let diffSeq = 0

/**
 * @param {object} opts
 * @param {{id, createdAt}} opts.to    the newer backup (preselected)
 * @param {{id, createdAt}} [opts.from] the older one; with it the diff loads at once
 * @param {'device'|'scope'} [opts.mode]
 * @param {() => Promise<Array>} opts.loadHistory the candidates' rows
 */
async function open({ to, from = null, mode: m = 'device', loadHistory }) {
  mode.value = m
  rows.value = withRows([], to, from)
  toId.value = to.id
  fromId.value = from?.id || null
  kind.value = null
  diffResult.value = null
  show.value = true
  if (from) loadDiff()

  const seq = ++openSeq
  loadingRows.value = true
  try {
    const list = await loadHistory()
    if (seq !== openSeq) return // another Compare was opened meanwhile
    rows.value = withRows(list, to, from)
  } catch (error) {
    if (seq === openSeq) emit('error', error.userMessage || error.message || 'Failed to load backup history')
  } finally {
    if (seq === openSeq) loadingRows.value = false
  }
}

async function loadDiff() {
  const seq = ++diffSeq
  if (!fromId.value || !toId.value || fromId.value === toId.value) {
    diffResult.value = null
    loadingDiff.value = false
    return
  }
  loadingDiff.value = true
  try {
    const result = mode.value === 'scope'
      ? await backupsStore.diffScopeBackups(fromId.value, toId.value)
      : await backupsStore.diffBackups(fromId.value, toId.value, kind.value || undefined)
    if (seq !== diffSeq) return
    diffResult.value = result
    if (result.kind) kind.value = result.kind
  } catch (error) {
    if (seq === diffSeq) emit('error', error.userMessage || error.message || 'Failed to compute diff')
  } finally {
    if (seq === diffSeq) loadingDiff.value = false
  }
}

defineExpose({ open })
</script>
