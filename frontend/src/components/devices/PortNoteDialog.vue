<template>
  <v-dialog
    :model-value="modelValue"
    max-width="960"
    scrollable
    :fullscreen="$vuetify.display.xs"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-card v-if="port">
      <v-card-title class="d-flex flex-wrap align-center ga-2">
        <v-icon>mdi-tag-outline</v-icon>
        <span>Port {{ port.label }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" aria-label="Close" @click="close" />
      </v-card-title>
      <v-card-subtitle class="wrap-subtitle">
        What you know about this port. It stays with the port whatever is plugged into it.
      </v-card-subtitle>

      <v-card-text>
        <v-row>
          <!-- The note -->
          <v-col cols="12" md="6">
            <v-text-field
              v-model="form.label"
              label="Label"
              hint="Short: room, desk, jack or device. Could become the port description later."
              persistent-hint
              :counter="LABEL_MAX"
              :maxlength="LABEL_MAX"
              :readonly="!canEdit"
              class="mb-3"
            />
            <v-text-field v-model="form.location" label="Location" :readonly="!canEdit" maxlength="255" class="mb-1" />
            <v-text-field v-model="form.owner" label="Owner or client" :readonly="!canEdit" maxlength="255" class="mb-1" />
            <v-select
              v-model="form.kind"
              :items="NOTE_KIND_ITEMS"
              label="Port kind"
              :readonly="!canEdit"
              class="mb-1"
            />
            <v-combobox
              v-model="form.expectedMac"
              :items="macItems"
              item-title="title"
              item-value="value"
              :return-object="false"
              label="Expected device (MAC)"
              hint="Pin the device that belongs here; the port shows when it is missing."
              persistent-hint
              clearable
              :readonly="!canEdit"
              :error-messages="macError"
              class="mb-3"
            />
            <v-textarea
              v-model="form.notes"
              label="Notes"
              auto-grow
              rows="3"
              maxlength="4000"
              :readonly="!canEdit"
            />
          </v-col>

          <!-- What NetHelper sees on the port -->
          <v-col cols="12" md="6">
            <div class="text-subtitle-2 mb-2">What the network shows</div>
            <v-progress-linear v-if="loading" indeterminate class="mb-2" />

            <div v-if="port.description" class="evidence-row">
              <div class="flex-grow-1">
                <div class="text-caption text-medium-emphasis">Description on the switch</div>
                <div>{{ port.description }}</div>
              </div>
              <v-btn v-if="canEdit" size="small" variant="text" @click="use('label', port.description)">Use</v-btn>
            </div>

            <div v-for="n in port.neighbors" :key="`n-${n.mac || n.sysName}`" class="evidence-row">
              <div class="flex-grow-1">
                <div class="text-caption text-medium-emphasis">Heard over LLDP</div>
                <div>{{ n.device?.name || n.sysName || n.mac }}<span v-if="n.capabilities?.length" class="text-medium-emphasis"> ({{ n.capabilities.join(', ') }})</span></div>
              </div>
              <v-btn v-if="canEdit && (n.device?.name || n.sysName)" size="small" variant="text" @click="use('label', n.device?.name || n.sysName)">Use</v-btn>
            </div>

            <div v-for="client in clients" :key="client.id" class="evidence-row" :class="{ 'text-medium-emphasis': client.state === 'gone' }">
              <div class="flex-grow-1 min-w-0">
                <PortClientLine :client="client" />
                <div v-if="profileText(client.profile)" class="text-caption">{{ profileText(client.profile) }}</div>
                <div class="text-caption">
                  {{ client.mac }}<span v-if="client.ip"> · {{ client.ip }}</span><span v-if="client.vlan"> · VLAN {{ client.vlan }}</span>
                  <span v-if="client.profile?.randomMac"> · private MAC</span><span v-else-if="client.vendor"> · {{ client.vendor }}</span>
                </div>
                <div v-if="client.username" class="text-caption">User {{ client.username }}</div>
                <div class="text-caption text-medium-emphasis">{{ freshnessText(client) }} · first seen {{ timeAgo(client.firstSeen) }}</div>
              </div>
              <div v-if="canEdit" class="d-flex flex-column align-end">
                <v-btn size="small" variant="text" @click="use('label', clientTitle(client))">Use</v-btn>
                <v-btn v-if="client.username" size="small" variant="text" @click="use('owner', client.username)">Owner</v-btn>
                <v-btn size="small" variant="text" :title="`Expect ${client.mac} on this port`" @click="form.expectedMac = client.mac">Pin</v-btn>
              </div>
            </div>
            <div v-if="!loading && !clients.length && !port.description && !port.neighbors.length" class="text-body-2 text-medium-emphasis">
              Nothing seen on this port yet.
            </div>
          </v-col>
        </v-row>

        <v-expansion-panels v-if="revisions.length" variant="accordion" class="mt-4">
          <v-expansion-panel>
            <v-expansion-panel-title>Note history ({{ revisions.length }})</v-expansion-panel-title>
            <v-expansion-panel-text>
              <div v-for="(r, i) in revisions" :key="i" class="text-body-2 mb-2">
                <span class="text-medium-emphasis">{{ new Date(r.createdAt).toLocaleString() }}<span v-if="r.user">, {{ r.user.name }}</span>:</span>
                <span v-if="r.action === 'clear'"> cleared the note</span>
                <span v-else> {{ revisionText(r.values) }}</span>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <v-card-actions class="flex-wrap">
        <v-btn v-if="canEdit && port.note" color="error" variant="text" :loading="clearing" @click="clear">Clear note</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="close">{{ canEdit ? 'Cancel' : 'Close' }}</v-btn>
        <v-btn v-if="canEdit" color="primary" variant="flat" :loading="saving" :disabled="Boolean(macError)" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import portsService from '@/services/ports.service'
import { useNotificationsStore } from '@/stores/notifications'
import { timeAgo } from '@/models/activity'
import {
  LABEL_MAX, NOTE_KIND_ITEMS, clientTitle, freshnessText, profileText
} from '@/models/port-clients'
import PortClientLine from '@/components/devices/PortClientLine.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  deviceId: { type: String, required: true },
  port: { type: Object, default: null },
  canEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'saved'])
const notifications = useNotificationsStore()

const form = reactive({ label: '', location: '', owner: '', notes: '', kind: 'auto', expectedMac: null })
const detail = ref(null)
const loading = ref(false)
const saving = ref(false)
const clearing = ref(false)

const clients = computed(() => detail.value?.port?.clients || props.port?.clients || [])
const revisions = computed(() => detail.value?.revisions || [])
const macItems = computed(() => {
  const seen = new Set()
  return clients.value.filter((c) => !seen.has(c.mac) && seen.add(c.mac))
    .map((c) => ({ value: c.mac, title: `${c.mac} (${clientTitle(c)})` }))
})
const MAC_RE = /^(?:[0-9a-f]{2}([:-])(?:[0-9a-f]{2}\1){4}[0-9a-f]{2}|[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}|[0-9a-f]{12})$/i
const macError = computed(() => (form.expectedMac && !MAC_RE.test(String(form.expectedMac).trim()) ? 'Not a MAC address' : ''))

function fill(note) {
  form.label = note?.label || ''
  form.location = note?.location || ''
  form.owner = note?.owner || ''
  form.notes = note?.notes || ''
  form.kind = note?.kind || 'auto'
  form.expectedMac = note?.expectedMac || null
}

function use(field, value) {
  form[field] = String(value || '').slice(0, field === 'label' ? LABEL_MAX : 255)
}

function revisionText(values = {}) {
  const parts = [
    values.label && `label "${values.label}"`,
    values.location && `location "${values.location}"`,
    values.owner && `owner "${values.owner}"`,
    values.kind && values.kind !== 'auto' && `kind ${values.kind}`,
    values.expectedMac && `expects ${values.expectedMac}`,
    values.notes && 'notes'
  ].filter(Boolean)
  return parts.length ? `set ${parts.join(', ')}` : 'saved'
}

async function loadDetail() {
  if (!props.port) return
  loading.value = true
  try {
    detail.value = await portsService.getPort(props.deviceId, props.port.port)
  } catch (error) {
    notifications.showError(error.userMessage || 'Failed to load the port')
  } finally {
    loading.value = false
  }
}

watch(() => [props.modelValue, props.port], ([open]) => {
  if (!open) return
  detail.value = null
  fill(props.port?.note)
  loadDetail()
})

function close() {
  emit('update:modelValue', false)
}

async function save() {
  saving.value = true
  try {
    const note = await portsService.setNote(props.deviceId, props.port.port, {
      label: form.label.trim(),
      location: form.location.trim(),
      owner: form.owner.trim(),
      notes: form.notes.trim(),
      kind: form.kind,
      expectedMac: form.expectedMac ? String(form.expectedMac).trim() : '',
      portLabel: props.port.label
    })
    notifications.showSuccess(note ? `Saved the note for port ${props.port.label}` : `Cleared the note for port ${props.port.label}`)
    emit('saved', note)
    close()
  } catch (error) {
    notifications.showError(error.userMessage || 'Failed to save the note')
  } finally {
    saving.value = false
  }
}

async function clear() {
  clearing.value = true
  try {
    await portsService.clearNote(props.deviceId, props.port.port)
    notifications.showSuccess(`Cleared the note for port ${props.port.label}`)
    emit('saved', null)
    close()
  } catch (error) {
    notifications.showError(error.userMessage || 'Failed to clear the note')
  } finally {
    clearing.value = false
  }
}
</script>

<style scoped>
.evidence-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.min-w-0 {
  min-width: 0;
}
</style>
