<template>
  <!-- One sighting on one line: how fresh it is, and its best name; the rest in the tooltip. -->
  <span class="d-inline-flex align-center ga-1" :title="tooltip">
    <v-icon size="16" :icon="info.icon" :color="info.color" :aria-label="info.label" />
    <span>{{ clientTitle(client) }}</span>
  </span>
</template>

<script setup>
import { computed } from 'vue'
import { FRESHNESS, clientTitle, freshnessText } from '@/models/port-clients'

const props = defineProps({
  client: { type: Object, required: true }
})

const info = computed(() => FRESHNESS[props.client.freshness] || FRESHNESS.confirmed)
const tooltip = computed(() => {
  const extra = [props.client.ip, props.client.mac].filter(Boolean).join(' · ')
  return `${freshnessText(props.client)}${extra ? `\n${extra}` : ''}`
})
</script>
