<template>
  <v-card elevation="2" class="device-status-chart">
    <v-card-title class="d-flex align-center">
      <v-icon class="mr-2" color="primary">mdi-chart-donut</v-icon>
      Current Device Status
    </v-card-title>

    <v-divider />

    <v-card-text>
      <div v-if="devicesStore.loading && !hasDevices" class="d-flex justify-center align-center chart-box">
        <v-progress-circular indeterminate color="primary" />
      </div>

      <div v-else-if="!hasDevices" class="d-flex flex-column justify-center align-center chart-box text-medium-emphasis">
        <v-icon size="48" class="mb-2">mdi-devices</v-icon>
        No devices in inventory yet
      </div>

      <div v-else class="chart-box">
        <Doughnut :data="chartData" :options="chartOptions" />
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
// Snapshot of the inventory's status right now, from the same stats the
// dashboard cards use. NetHelper keeps no status history yet, so this is
// deliberately not a time series.
import { computed } from 'vue'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'vue-chartjs'
import { useDevicesStore } from '@/stores/devices'

ChartJS.register(ArcElement, Tooltip, Legend)

const devicesStore = useDevicesStore()

const hasDevices = computed(() => devicesStore.stats.total > 0)

const chartData = computed(() => {
  const { total, online, warning, offline } = devicesStore.stats
  const unknown = Math.max(0, total - online - warning - offline)

  const slices = [
    { label: 'Online', value: online, color: '#4CAF50' },
    { label: 'Warning', value: warning, color: '#FF9800' },
    { label: 'Offline', value: offline, color: '#F44336' },
    { label: 'Unknown', value: unknown, color: '#9E9E9E' }
  ].filter((s) => s.value > 0)

  return {
    labels: slices.map((s) => s.label),
    datasets: [{
      data: slices.map((s) => s.value),
      backgroundColor: slices.map((s) => s.color),
      borderWidth: 1
    }]
  }
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right' }
  }
}
</script>

<style scoped>
.chart-box {
  height: 300px;
}
</style>
