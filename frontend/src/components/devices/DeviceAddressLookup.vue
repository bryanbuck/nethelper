<template>
  <div class="mt-2">
    <v-btn
      v-if="!result"
      variant="outlined"
      size="small"
      prepend-icon="mdi-magnify"
      :loading="loading"
      @click="run"
    >
      Who has this address?
    </v-btn>

    <v-alert v-if="error" type="error" variant="text" density="compact" class="px-0">{{ error }}</v-alert>

    <div v-if="result" class="address-lookup">
      <div class="d-flex flex-wrap align-center ga-2 mb-1">
        <span class="font-weight-medium">{{ headline }}</span>
        <v-spacer />
        <v-btn variant="text" size="x-small" prepend-icon="mdi-refresh" :loading="loading" @click="run">Check again</v-btn>
      </div>
      <div v-for="source in result.sources" :key="source.key" class="mb-1">
        <div class="text-caption text-medium-emphasis">{{ source.label }}</div>
        <div v-for="(item, i) in source.items" :key="i" class="ml-3">
          <router-link v-if="item.deviceId" :to="`/devices/${item.deviceId}`" class="font-weight-medium">{{ item.title }}</router-link>
          <span v-else class="font-weight-medium">{{ item.title }}</span>
          <span class="text-medium-emphasis"> &middot; {{ item.detail }}</span>
          <span v-if="item.at" class="text-medium-emphasis"> &middot; seen {{ ago(item.at) }}</span>
        </div>
        <div v-if="!source.items.length || source.reason" class="ml-3 text-caption text-medium-emphasis">
          {{ source.status === 'none' && !source.reason ? 'Nothing found.' : source.reason }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { formatDistanceToNow } from 'date-fns'
import deviceService from '@/services/device.service'

const props = defineProps({
  deviceId: { type: String, required: true }
})

const result = ref(null)
const loading = ref(false)
const error = ref(null)

const run = async () => {
  const deviceId = props.deviceId
  loading.value = true
  error.value = null
  try {
    const reply = await deviceService.lookupAddress(deviceId)
    // Navigated to another device while it ran: the answer isn't about this one.
    if (deviceId === props.deviceId) result.value = reply
  } catch (err) {
    if (deviceId === props.deviceId) error.value = err.userMessage || err.message || 'The lookup failed'
  } finally {
    if (deviceId === props.deviceId) loading.value = false
  }
}

const ago = (at) => formatDistanceToNow(new Date(at), { addSuffix: true })

// A lookup belongs to one device.
watch(() => props.deviceId, () => {
  result.value = null
  error.value = null
  loading.value = false
})

// The MAC holding the address against the device's own is the strongest
// answer: from the host's neighbor table, else from a cloud's client record.
const headline = computed(() => {
  const from = result.value?.macFrom
  const which = from && from !== 'neighbor' ? `${from} sees this address on` : 'The MAC answering this address is'
  if (result.value?.sameMac === true) return `${which} this device's own MAC.`
  if (result.value?.sameMac === false) return `${which} a MAC that is not this device's (${result.value.mac}).`
  const found = result.value?.sources.some((s) => s.status === 'found')
  return found ? 'What NetHelper knows about this address' : 'NetHelper has nothing else on this address.'
})
</script>
