<template>
  <div class="topo-node topo-subnet" :class="{ selected }">
    <div class="d-flex align-center ga-2">
      <v-icon size="20" class="topo-meta">mdi-ip-network-outline</v-icon>
      <div class="flex-grow-1 overflow-hidden">
        <div class="topo-title text-truncate">{{ data.name }}</div>
        <div class="topo-sub">
          {{ data.count }} unmanaged host{{ data.count === 1 ? '' : 's' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false }
})
</script>
