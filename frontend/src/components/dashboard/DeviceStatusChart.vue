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
import { useTheme } from 'vuetify'
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js'
import { Doughnut } from 'vue-chartjs'
import { useDevicesStore } from '@/stores/devices'

ChartJS.register(ArcElement, Tooltip, Legend)

const devicesStore = useDevicesStore()
const theme = useTheme()

// Chart.js paints a canvas, so it needs real colors, not CSS variables: read
// them from the current theme (the chart redraws when the theme changes).
const colors = computed(() => theme.current.value.colors)

function alpha(hex, opacity) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`
}

const hasDevices = computed(() => devicesStore.stats.total > 0)

const chartData = computed(() => {
  const { total, online, warning, offline } = devicesStore.stats
  const unknown = Math.max(0, total - online - warning - offline)

  const slices = [
    { label: 'Online', value: online, color: colors.value.success },
    { label: 'Warning', value: warning, color: colors.value.warning },
    { label: 'Offline', value: offline, color: colors.value.error },
    { label: 'Unknown', value: unknown, color: alpha(colors.value['on-surface'], 0.38) }
  ].filter((s) => s.value > 0)

  return {
    labels: slices.map((s) => s.label),
    datasets: [{
      data: slices.map((s) => s.value),
      backgroundColor: slices.map((s) => s.color),
      borderColor: colors.value.surface,
      borderWidth: 1
    }]
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right',
      labels: { color: alpha(colors.value['on-surface'], 0.87) }
    }
  }
}))
</script>

<style scoped>
.chart-box {
  height: 300px;
}
</style>
