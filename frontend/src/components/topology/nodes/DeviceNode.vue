<template>
  <div
    class="topo-node topo-device"
    :class="{ selected, 'out-of-scope': data.outOfScope, 'no-data': !hasNeighborData }"
  >
    <Handle type="target" :position="Position.Top" class="topo-handle" />
    <div class="d-flex align-center ga-2">
      <v-icon :color="typeInfo.color" size="22">{{ typeInfo.icon }}</v-icon>
      <div class="flex-grow-1 overflow-hidden">
        <div class="topo-title text-truncate" :title="data.name">{{ data.name }}</div>
        <div class="topo-sub text-truncate">{{ data.ipAddress || 'No IP' }}</div>
      </div>
      <v-tooltip location="top" :text="statusInfo.label">
        <template #activator="{ props: tip }">
          <v-icon v-bind="tip" :color="statusInfo.color" size="12">mdi-circle</v-icon>
        </template>
      </v-tooltip>
    </div>
    <div class="d-flex align-center ga-1 mt-1">
      <v-icon :color="vendorInfo.color" size="14">{{ vendorInfo.icon }}</v-icon>
      <span class="topo-meta text-truncate">{{ data.model || vendorInfo.label }}</span>
      <v-spacer />
      <v-tooltip v-if="!hasNeighborData" location="bottom" :text="neighborHint">
        <template #activator="{ props: tip }">
          <v-icon v-bind="tip" size="14" class="topo-meta">mdi-lan-pending</v-icon>
        </template>
      </v-tooltip>
      <v-chip v-if="data.outOfScope" size="x-small" variant="tonal">{{ data.location || 'other site' }}</v-chip>
    </div>
    <Handle type="source" :position="Position.Bottom" class="topo-handle" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { DeviceTypeInfo, DeviceStatusInfo, effectiveStatus } from '@/models/Device'
import { VendorInfo } from '@/models/vendors'

const props = defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false }
})

const typeInfo = computed(() => DeviceTypeInfo[props.data.type] || { icon: 'mdi-help-network', color: 'grey' })
const vendorInfo = computed(() => VendorInfo[props.data.vendor] || VendorInfo.other)

// Ping status first (reachability), then the cloud plane's view.
const statusInfo = computed(() => {
  const known = props.data.pingStatus || (props.data.managementMode === 'cloud' && props.data.cloudStatus)
  return (known && DeviceStatusInfo[effectiveStatus(props.data)]) || { label: 'Status unknown', color: 'grey' }
})

const hasNeighborData = computed(() => props.data.topology?.status === 'ok')

const neighborHint = computed(() => {
  const t = props.data.topology
  if (!t) return 'Neighbors not collected yet'
  return `No neighbor data: ${t.reason || t.status}`
})
</script>
