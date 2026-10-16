<template>
  <div class="topo-node topo-ghost" :class="{ selected }">
    <Handle type="target" :position="Position.Top" class="topo-handle" />
    <div class="d-flex align-center ga-2">
      <v-icon size="20" class="topo-meta">{{ icon }}</v-icon>
      <div class="flex-grow-1 overflow-hidden">
        <div class="topo-title text-truncate" :title="data.name">{{ data.name }}</div>
        <div class="topo-sub text-truncate">{{ data.mgmtIp || data.macAddress || 'Not in inventory' }}</div>
      </div>
      <v-tooltip v-if="data.discovered" location="top" text="Seen by Discovery: can be imported">
        <template #activator="{ props: tip }">
          <v-icon v-bind="tip" color="primary" size="16">mdi-import</v-icon>
        </template>
      </v-tooltip>
    </div>
    <Handle type="source" :position="Position.Bottom" class="topo-handle" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false }
})

const ICONS = {
  access_point: 'mdi-access-point',
  switch: 'mdi-switch',
  gateway: 'mdi-router',
  phone: 'mdi-phone-voip',
  host: 'mdi-desktop-tower-monitor',
  unknown: 'mdi-help-network-outline'
}

const icon = computed(() => ICONS[props.data.guessedType] || ICONS.unknown)
</script>
