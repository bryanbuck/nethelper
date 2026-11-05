<template>
  <!-- Boot images (primary/secondary, booted, default) as the last poll read
       them (Device.firmwareImages). Hidden for platforms that don't report
       partitions, unless a row already holds images. -->
  <v-card v-if="shown" class="fill-height">
    <v-card-title class="d-flex flex-wrap align-center justify-space-between column-gap-4">
      <div>
        <v-icon start>mdi-chip</v-icon>
        Image Information
      </div>
      <div class="d-flex align-center ga-2">
        <span v-if="images?.checkedAt" class="text-caption text-medium-emphasis">
          Read {{ timeAgo(images.checkedAt) }}
        </span>
        <ActionButton
          v-if="canRefresh"
          icon="mdi-refresh"
          label="Refresh"
          variant="text"
          size="small"
          :loading="loading"
          @click="refresh"
        />
      </div>
    </v-card-title>
    <v-divider />
    <v-card-text>
      <v-alert
        v-if="error"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-2"
        closable
        @click:close="error = null"
      >
        {{ error }}
      </v-alert>

      <v-list v-if="rows.length" density="compact" class="wrap-lines">
        <v-list-item v-for="row in rows" :key="row.slot" :data-slot="row.slot">
          <v-list-item-title>{{ row.label }}</v-list-item-title>
          <v-list-item-subtitle class="text-body-2 font-weight-medium">
            {{ row.version || 'Empty' }}
          </v-list-item-subtitle>
          <template #append>
            <div class="d-flex flex-wrap ga-1 justify-end">
              <v-chip v-if="row.booted" size="small" color="success" variant="tonal" prepend-icon="mdi-power">
                Booted
              </v-chip>
              <v-chip v-if="row.isDefault" size="small" color="primary" variant="outlined" prepend-icon="mdi-star-outline">
                Default
              </v-chip>
            </div>
          </template>
        </v-list-item>
      </v-list>

      <v-alert
        v-if="nextBoot"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-2"
        data-test="next-boot"
      >
        The next reboot loads {{ nextBoot.version }} from the {{ nextBoot.slotLabel.toLowerCase() }} image
        (running {{ nextBoot.running }}).
      </v-alert>

      <div v-if="!rows.length" class="text-body-2 text-medium-emphasis">
        <template v-if="canRefresh">Not read yet. Refresh reads the images from the switch.</template>
        <template v-else-if="imagePoll?.reason === 'no-credential'">Link a device credential to read the images from the switch.</template>
        <template v-else-if="imagePoll?.reason === 'no-ip'">The device has no IP address to read the images from.</template>
        <template v-else>Not read yet. An operator can read the images from the switch.</template>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref, computed } from 'vue'
import ActionButton from '@/components/common/ActionButton.vue'
import deviceService from '@/services/device.service'
import { imageRows, nextBootChange, imagesCardShown } from '@/models/firmware-images'
import { timeAgo } from '@/models/activity'

const props = defineProps({
  device: { type: Object, required: true },
  // GET /devices/:id imagePoll: { available, reason }
  imagePoll: { type: Object, default: null },
  canEdit: { type: Boolean, default: false }
})
const emit = defineEmits(['patch'])

const loading = ref(false)
const error = ref(null)

const images = computed(() => props.device.firmwareImages || null)
const rows = computed(() => imageRows(images.value))
const nextBoot = computed(() => nextBootChange(images.value))
const shown = computed(() => imagesCardShown(props.device, props.imagePoll))
const canRefresh = computed(() => props.canEdit && !!props.imagePoll?.available)

// One firmware poll of this device (POST /devices/poll, operator+); the
// backend stores what it read, and the page gets the same patch.
async function refresh() {
  const id = props.device.id
  loading.value = true
  error.value = null
  try {
    const response = await deviceService.pollDeviceFirmware([id])
    const result = response?.results?.[0]
    if (!result?.success) {
      error.value = result?.error || 'Could not read the images'
      return
    }
    const patch = {}
    if (result.data?.images) patch.firmwareImages = result.data.images
    if (result.data?.firmwareVersion) patch.firmwareVersion = result.data.firmwareVersion
    if (Object.keys(patch).length) emit('patch', patch)
  } catch (err) {
    error.value = err.userMessage || err.message || 'Could not read the images'
  } finally {
    loading.value = false
  }
}
</script>
