<template>
  <v-dialog
    :model-value="modelValue"
    max-width="600px"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h5">
        Import Discovered Device
      </v-card-title>

      <v-card-text>
        <v-container>
          <v-row>
            <v-col cols="12">
              <v-alert
                v-if="target?.conflictType"
                type="warning"
                variant="tonal"
                density="compact"
              >
                This device conflicts with an existing inventory device
                ({{ formatConflict(target.conflictType) }}).
                Enable "Update existing device" below to merge the scanned
                IP/MAC into the existing record instead of creating a new one.
              </v-alert>

              <v-alert
                v-if="conflictMessage"
                type="warning"
                variant="tonal"
                density="compact"
                class="mt-2"
              >
                {{ conflictMessage }}
              </v-alert>
            </v-col>

            <v-col v-if="target?.conflictType || conflictMessage" cols="12">
              <v-checkbox
                v-model="form.updateExisting"
                label="Update existing device (merge scan data)"
                color="warning"
                hide-details
              />
            </v-col>

            <template v-if="!form.updateExisting">
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="form.name"
                  label="Device Name"
                  variant="outlined"
                  :hint="nameHint"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-select
                  v-model="form.type"
                  label="Device Type"
                  :items="deviceTypeItems"
                  item-title="title"
                  item-value="value"
                  variant="outlined"
                  :rules="form.type ? [] : [rules.required]"
                  :hint="typeHint"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="form.serial"
                  label="Serial Number"
                  variant="outlined"
                  :hint="serialHint"
                  persistent-hint
                />
              </v-col>

              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="form.model"
                  label="Model"
                  variant="outlined"
                />
              </v-col>

              <v-col cols="12">
                <v-text-field
                  v-model="form.location"
                  label="Location"
                  variant="outlined"
                />
              </v-col>
            </template>

            <v-col cols="12">
              <v-list density="compact" class="bg-transparent">
                <v-list-item prepend-icon="mdi-ip-network" :title="target?.ipAddress || '—'" subtitle="IP Address" />
                <v-list-item prepend-icon="mdi-lan" :title="target?.macAddress || 'Not detected'" subtitle="MAC Address" />
                <v-list-item
                  v-if="target?.centralMatch"
                  prepend-icon="mdi-cloud-check"
                  :title="`${target.centralMatch.deviceName || target.centralMatch.serial} (${target.centralMatch.model || 'Unknown model'})`"
                  :subtitle="`Matched in ${target.centralMatch.integrationName || cloudProviderLabel(target.centralMatch.provider, { short: false })}`"
                />
              </v-list>
            </v-col>
          </v-row>
        </v-container>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn
          variant="text"
          @click="close"
        >
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="importing"
          @click="submit"
        >
          {{ form.updateExisting ? 'Merge Into Existing' : 'Import Device' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
/**
 * Import one DiscoveredDevice into the inventory (or merge it into the device
 * it conflicts with). Shared by the Discovery page and the Network Map, which
 * passes `defaults` from the neighbor's LLDP data (name, type, location).
 */
import { ref, computed, watch } from 'vue'
import { useDiscoveryStore } from '@/stores/discovery'
import { cloudProviderLabel } from '@/models/vendors'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // DiscoveredDevice row (id, ipAddress, macAddress, suggestedName/Type, centralMatch, conflictType, ...)
  target: { type: Object, default: null },
  // Overrides for the form's initial values: { name, type, model, location }
  defaults: { type: Object, default: () => ({}) }
})

const emit = defineEmits(['update:modelValue', 'imported', 'error'])

const discoveryStore = useDiscoveryStore()

const importing = ref(false)
const conflictMessage = ref('')
const form = ref(emptyForm())

const rules = {
  required: value => !!value || 'This field is required'
}

const deviceTypeItems = [
  { title: 'Access Point', value: 'access_point' },
  { title: 'Switch', value: 'switch' },
  { title: 'Gateway', value: 'gateway' }
]

function emptyForm() {
  return { name: '', type: null, serial: '', model: '', location: '', updateExisting: false }
}

const IMPORTABLE_TYPES = deviceTypeItems.map(t => t.value)

// Fill the form each time the dialog opens for a target.
watch(() => [props.modelValue, props.target], ([open, target]) => {
  if (!open || !target) return
  conflictMessage.value = ''
  const d = props.defaults || {}
  const type = d.type || target.suggestedType || null
  form.value = {
    name: d.name || target.suggestedName || target.hostname || target.ipAddress || '',
    type: IMPORTABLE_TYPES.includes(type) ? type : null,
    serial: target.centralSerial || '',
    model: d.model || target.centralMatch?.model || '',
    location: d.location || '',
    updateExisting: false
  }
}, { immediate: true })

const nameHint = computed(() => {
  if (props.defaults?.name) return 'Advertised by the device (LLDP/CDP)'
  return props.target?.suggestedName ? 'Suggested from scan' : ''
})

const typeHint = computed(() => {
  if (props.defaults?.type && form.value.type === props.defaults.type) return 'Guessed from its LLDP/CDP capabilities'
  if (props.target?.suggestedType) return 'Detected from scan'
  return 'Required (not auto-detected)'
})

const serialHint = computed(() => {
  if (props.target?.centralSerial) return `Detected from ${cloudProviderLabel(props.target.centralMatch?.provider, { short: false })}`
  if (props.target?.macAddress) return 'Defaults to MAC address if left blank'
  return 'Required (not auto-detected)'
})

const formatConflict = (conflictType) => {
  const labels = {
    ip_conflict: 'IP Conflict',
    mac_conflict: 'MAC Conflict',
    serial_conflict: 'Serial Conflict',
    central_managed: 'Cloud Managed'
  }
  return labels[conflictType] || conflictType
}

function close() {
  conflictMessage.value = ''
  form.value = emptyForm()
  emit('update:modelValue', false)
}

async function submit() {
  if (!props.target) return

  importing.value = true
  try {
    const payload = {}
    if (form.value.updateExisting) {
      payload.updateExisting = true
    } else {
      if (form.value.name) payload.name = form.value.name
      if (form.value.type) payload.type = form.value.type
      if (form.value.serial) payload.serial = form.value.serial
      if (form.value.model) payload.model = form.value.model
      if (form.value.location) payload.location = form.value.location
    }

    const response = await discoveryStore.importDevice(props.target.id, payload)
    emit('imported', response)
    close()
  } catch (error) {
    if (error.statusCode === 409) {
      // Conflict - surface the message and offer the merge option
      conflictMessage.value = error.userMessage || 'This device conflicts with an existing device.'
    } else {
      emit('error', error.userMessage || 'Failed to import device')
    }
  } finally {
    importing.value = false
  }
}
</script>
