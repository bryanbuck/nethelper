<template>
  <v-card elevation="2" class="network-health-chart">
    <v-card-title class="d-flex align-center justify-space-between">
      <div class="d-flex align-center">
        <v-icon class="mr-2" color="primary">mdi-chart-line</v-icon>
        Network Health Trend
      </div>
      <v-menu>
        <template v-slot:activator="{ props }">
          <v-btn 
            variant="text" 
            size="small" 
            v-bind="props"
            append-icon="mdi-chevron-down"
          >
            {{ selectedPeriod.label }}
          </v-btn>
        </template>
        <v-list>
          <v-list-item 
            v-for="period in periods" 
            :key="period.value"
            @click="selectedPeriod = period"
          >
            <v-list-item-title>{{ period.label }}</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-menu>
    </v-card-title>
    
    <v-divider></v-divider>
    
    <v-card-text>
      <div v-if="loading" class="text-center pa-8">
        <v-progress-circular indeterminate color="primary"></v-progress-circular>
        <div class="text-body-2 text-medium-emphasis mt-2">
          Loading chart data...
        </div>
      </div>
      
      <div v-else class="chart-container">
        <Line 
          :data="chartData" 
          :options="chartOptions" 
          :height="200"
        />
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js'
import { Line } from 'vue-chartjs'
import { useDevicesStore } from '@/stores/devices'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

const devicesStore = useDevicesStore()
const loading = ref(false)

const periods = [
  { value: '1h', label: 'Last Hour' },
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d', label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' }
]

const selectedPeriod = ref(periods[1])

const generateMockData = (period) => {
  const now = new Date()
  const labels = []
  const onlineData = []
  const offlineData = []
  const warningData = []
  
  let points = 24
  let interval = 60 * 60 * 1000
  
  switch (period) {
    case '1h':
      points = 12
      interval = 5 * 60 * 1000
      break
    case '24h':
      points = 24
      interval = 60 * 60 * 1000
      break
    case '7d':
      points = 7
      interval = 24 * 60 * 60 * 1000
      break
    case '30d':
      points = 30
      interval = 24 * 60 * 60 * 1000
      break
  }
  
  for (let i = points - 1; i >= 0; i--) {
    const time = new Date(now.getTime() - i * interval)
    
    if (period === '1h') {
      labels.push(time.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }))
    } else if (period === '24h') {
      labels.push(time.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }))
    } else {
      labels.push(time.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      }))
    }
    
    const baseOnline = 4 + Math.sin(i * 0.1) * 1
    const baseOffline = 1 + Math.random() * 0.5
    const baseWarning = 1 + Math.random() * 0.3
    
    onlineData.push(Math.max(0, Math.round(baseOnline + Math.random() * 2)))
    offlineData.push(Math.max(0, Math.round(baseOffline + Math.random())))
    warningData.push(Math.max(0, Math.round(baseWarning + Math.random())))
  }
  
  return { labels, onlineData, offlineData, warningData }
}

const chartData = computed(() => {
  const data = generateMockData(selectedPeriod.value.value)
  
  return {
    labels: data.labels,
    datasets: [
      {
        label: 'Online',
        data: data.onlineData,
        borderColor: '#4CAF50',
        backgroundColor: 'rgba(76, 175, 80, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5
      },
      {
        label: 'Warning',
        data: data.warningData,
        borderColor: '#FF9800',
        backgroundColor: 'rgba(255, 152, 0, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5
      },
      {
        label: 'Offline',
        data: data.offlineData,
        borderColor: '#F44336',
        backgroundColor: 'rgba(244, 67, 54, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 3,
        pointHoverRadius: 5
      }
    ]
  }
})

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom',
      labels: {
        padding: 20,
        usePointStyle: true,
        pointStyle: 'circle'
      }
    },
    tooltip: {
      mode: 'index',
      intersect: false,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      titleColor: '#fff',
      bodyColor: '#fff',
      borderColor: 'rgba(255, 255, 255, 0.1)',
      borderWidth: 1
    }
  },
  scales: {
    x: {
      grid: {
        color: 'rgba(0, 0, 0, 0.05)'
      },
      ticks: {
        maxTicksLimit: 8
      }
    },
    y: {
      beginAtZero: true,
      grid: {
        color: 'rgba(0, 0, 0, 0.05)'
      },
      ticks: {
        stepSize: 1,
        callback: function(value) {
          return Math.floor(value) === value ? value : ''
        }
      }
    }
  },
  interaction: {
    mode: 'nearest',
    axis: 'x',
    intersect: false
  },
  elements: {
    point: {
      hoverBackgroundColor: '#fff',
      hoverBorderWidth: 2
    }
  }
}))

watch(selectedPeriod, () => {
  loading.value = true
  setTimeout(() => {
    loading.value = false
  }, 500)
}, { deep: true })

onMounted(() => {
  loading.value = true
  setTimeout(() => {
    loading.value = false
  }, 1000)
})
</script>

<style scoped>
.network-health-chart {
  height: 100%;
}

.chart-container {
  height: 300px;
  position: relative;
}
</style>