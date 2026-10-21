<template>
  <div class="device-api-testing">
    <!-- Page Header -->
    <div class="mb-6">
      <div class="d-flex align-center mb-2">
        <v-icon icon="mdi-test-tube" size="x-large" color="primary" class="mr-3" />
        <div>
          <h1 class="text-h4">Device API Testing</h1>
          <v-chip color="info" size="small" class="ml-2">Admin Only</v-chip>
        </div>
      </div>
      <p class="text-body-1 text-medium-emphasis">
        Test device API connectivity without requiring devices to be in the database.
        This diagnostic tool helps validate credentials and troubleshoot connection issues.
      </p>
    </div>

    <v-row>
      <!-- Quick Connection Test Card -->
      <v-col cols="12" lg="8">
        <v-card>
          <v-card-title class="bg-primary text-white">
            <v-icon icon="mdi-flash" class="mr-2" />
            Quick Connection Test
          </v-card-title>

          <v-card-text class="pt-4">
            <DeviceConnectionTest
              mode="manual"
              :show-title="false"
              @test-complete="handleTestComplete"
            />
          </v-card-text>
        </v-card>

        <!-- Recent Tests -->
        <v-card class="mt-4">
          <v-card-title>
            <v-icon icon="mdi-history" class="mr-2" />
            Recent Tests
            <v-spacer />
            <v-btn
              v-if="recentTests.length > 0"
              size="small"
              variant="text"
              color="error"
              @click="clearRecentTests"
            >
              Clear All
            </v-btn>
          </v-card-title>

          <v-card-text>
            <!-- Empty State -->
            <v-alert
              v-if="recentTests.length === 0"
              type="info"
              variant="tonal"
              class="mb-0"
            >
              No tests performed yet. Run a test to see results here.
            </v-alert>

            <!-- Tests Table -->
            <v-table v-else density="compact">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Device IP</th>
                  <th>Username</th>
                  <th>Status</th>
                  <th>Response Time</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(test, index) in recentTests" :key="index">
                  <td class="text-caption">{{ formatTestTime(test.timestamp) }}</td>
                  <td>{{ test.deviceIp }}</td>
                  <td>{{ test.username }}</td>
                  <td>
                    <v-chip
                      :color="test.success ? 'success' : 'error'"
                      size="x-small"
                      variant="flat"
                    >
                      <v-icon
                        :icon="test.success ? 'mdi-check' : 'mdi-close'"
                        size="x-small"
                        start
                      />
                      {{ test.success ? 'Success' : 'Failed' }}
                    </v-chip>
                  </td>
                  <td>{{ test.responseTime ? test.responseTime + 'ms' : '-' }}</td>
                  <td>
                    <v-btn
                      size="x-small"
                      variant="text"
                      icon="mdi-eye"
                      @click="viewTestDetails(test)"
                    />
                  </td>
                </tr>
              </tbody>
            </v-table>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Sidebar -->
      <v-col cols="12" lg="4">
        <!-- Supported Device Types -->
        <v-card>
          <v-card-title class="bg-secondary text-white">
            <v-icon icon="mdi-devices" class="mr-2" />
            Supported Platforms
          </v-card-title>

          <v-card-text>
            <v-list v-if="!loadingSupportedTypes" density="compact">
              <v-list-item
                v-for="type in supportedTypes"
                :key="type.platform"
                :prepend-icon="type.testable ? 'mdi-check-circle' : 'mdi-close-circle'"
                :class="type.testable ? 'text-success' : 'text-medium-emphasis'"
              >
                <v-list-item-title>{{ type.name }}</v-list-item-title>
                <v-list-item-subtitle>
                  {{ type.testable ? `Tested over ${type.transports.join(', then ')}` : 'Reached only through its cloud; nothing to test directly' }}
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
            <v-skeleton-loader v-else type="list-item@4" />
          </v-card-text>
        </v-card>

        <!-- Test Statistics -->
        <v-card class="mt-4">
          <v-card-title>
            <v-icon icon="mdi-chart-bar" class="mr-2" />
            Session Statistics
          </v-card-title>

          <v-card-text>
            <v-list density="compact">
              <v-list-item>
                <v-list-item-title>Total Tests</v-list-item-title>
                <template #append>
                  <v-chip size="small">{{ stats.total }}</v-chip>
                </template>
              </v-list-item>

              <v-list-item>
                <v-list-item-title>Successful</v-list-item-title>
                <template #append>
                  <v-chip size="small" color="success">{{ stats.successful }}</v-chip>
                </template>
              </v-list-item>

              <v-list-item>
                <v-list-item-title>Failed</v-list-item-title>
                <template #append>
                  <v-chip size="small" color="error">{{ stats.failed }}</v-chip>
                </template>
              </v-list-item>

              <v-list-item v-if="stats.avgResponseTime">
                <v-list-item-title>Avg Response Time</v-list-item-title>
                <template #append>
                  <v-chip size="small" color="info">{{ stats.avgResponseTime }}ms</v-chip>
                </template>
              </v-list-item>

              <v-list-item v-if="stats.successRate !== null">
                <v-list-item-title>Success Rate</v-list-item-title>
                <template #append>
                  <v-chip
                    size="small"
                    :color="stats.successRate >= 80 ? 'success' : stats.successRate >= 50 ? 'warning' : 'error'"
                  >
                    {{ stats.successRate }}%
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>

        <!-- Help Card -->
        <v-card class="mt-4">
          <v-card-title>
            <v-icon icon="mdi-help-circle" class="mr-2" />
            Testing Tips
          </v-card-title>

          <v-card-text>
            <v-list density="compact">
              <v-list-item prepend-icon="mdi-check">
                <v-list-item-subtitle>
                  AOS-CX needs its REST API enabled (HTTPS); Junos is tried over NETCONF, then SSH
                </v-list-item-subtitle>
              </v-list-item>

              <v-list-item prepend-icon="mdi-check">
                <v-list-item-subtitle>
                  Verify the backend server can reach the device network
                </v-list-item-subtitle>
              </v-list-item>

              <v-list-item prepend-icon="mdi-check">
                <v-list-item-subtitle>
                  Config backups need an account that can read the running config
                </v-list-item-subtitle>
              </v-list-item>

              <v-list-item prepend-icon="mdi-check">
                <v-list-item-subtitle>
                  Check firewall rules allow HTTPS (REST) or SSH (port 22) from NetHelper
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Test Details Dialog -->
    <v-dialog v-model="showDetailsDialog" max-width="700px">
      <v-card v-if="selectedTest">
        <v-card-title>
          <v-icon
            :icon="selectedTest.success ? 'mdi-check-circle' : 'mdi-alert-circle'"
            :color="selectedTest.success ? 'success' : 'error'"
            class="mr-2"
          />
          Test Details - {{ selectedTest.deviceIp }}
        </v-card-title>

        <v-card-text>
          <v-list density="compact">
            <v-list-item>
              <v-list-item-title>Device IP</v-list-item-title>
              <v-list-item-subtitle>{{ selectedTest.deviceIp }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <v-list-item-title>Username</v-list-item-title>
              <v-list-item-subtitle>{{ selectedTest.username }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <v-list-item-title>Platform</v-list-item-title>
              <v-list-item-subtitle>
                {{ platformName(selectedTest.platform) }}
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <v-list-item-title>Status</v-list-item-title>
              <v-list-item-subtitle>
                <v-chip
                  :color="selectedTest.success ? 'success' : 'error'"
                  size="small"
                >
                  {{ selectedTest.success ? 'Success' : 'Failed' }}
                </v-chip>
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="selectedTest.responseTime">
              <v-list-item-title>Response Time</v-list-item-title>
              <v-list-item-subtitle>{{ selectedTest.responseTime }}ms</v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <v-list-item-title>Timestamp</v-list-item-title>
              <v-list-item-subtitle>{{ formatDetailedTime(selectedTest.timestamp) }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="selectedTest.message">
              <v-list-item-title>Message</v-list-item-title>
              <v-list-item-subtitle>{{ selectedTest.message }}</v-list-item-subtitle>
            </v-list-item>

            <v-list-item v-if="selectedTest.deviceInfo">
              <v-list-item-title>Device Info</v-list-item-title>
              <v-list-item-subtitle>
                <pre class="text-caption">{{ JSON.stringify(selectedTest.deviceInfo, null, 2) }}</pre>
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="text" @click="closeDetailsDialog">
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { formatDistanceToNow, format } from 'date-fns'
import DeviceConnectionTest from '@/components/devices/DeviceConnectionTest.vue'
import deviceApiService from '@/services/deviceApi.service'
import { useNotificationsStore } from '@/stores/notifications'

const notificationStore = useNotificationsStore()

// State
const recentTests = ref([])
const supportedTypes = ref([])
const loadingSupportedTypes = ref(false)
const showDetailsDialog = ref(false)
const selectedTest = ref(null)

// Computed stats
const stats = computed(() => {
  const total = recentTests.value.length
  const successful = recentTests.value.filter(t => t.success).length
  const failed = total - successful

  let avgResponseTime = null
  const testsWithTime = recentTests.value.filter(t => t.responseTime)
  if (testsWithTime.length > 0) {
    const sum = testsWithTime.reduce((acc, t) => acc + t.responseTime, 0)
    avgResponseTime = Math.round(sum / testsWithTime.length)
  }

  let successRate = null
  if (total > 0) {
    successRate = Math.round((successful / total) * 100)
  }

  return {
    total,
    successful,
    failed,
    avgResponseTime,
    successRate
  }
})

// Methods
const handleTestComplete = (result) => {
  // Add to recent tests
  const test = {
    timestamp: new Date(),
    deviceIp: result.deviceIp || 'Unknown',
    username: result.username || 'Unknown',
    platform: result.platform,
    success: result.success,
    responseTime: result.responseTime,
    message: result.message,
    deviceInfo: result.deviceInfo
  }

  recentTests.value.unshift(test)

  // Keep only last 20 tests
  if (recentTests.value.length > 20) {
    recentTests.value = recentTests.value.slice(0, 20)
  }

  // Store in localStorage
  saveTestsToStorage()
}

const viewTestDetails = (test) => {
  selectedTest.value = test
  showDetailsDialog.value = true
}

const closeDetailsDialog = () => {
  showDetailsDialog.value = false
  selectedTest.value = null
}

const clearRecentTests = () => {
  recentTests.value = []
  localStorage.removeItem('deviceApiTests')
  notificationStore.showSuccess('Test history cleared')
}

const platformName = (platform) =>
  supportedTypes.value.find(t => t.platform === platform)?.name || platform || 'N/A'

const formatTestTime = (timestamp) => {
  return formatDistanceToNow(new Date(timestamp), { addSuffix: true })
}

const formatDetailedTime = (timestamp) => {
  return format(new Date(timestamp), 'PPpp')
}

const loadSupportedTypes = async () => {
  loadingSupportedTypes.value = true
  try {
    const types = await deviceApiService.getSupportedTypes()
    supportedTypes.value = types
  } catch (error) {
    console.error('Error loading supported types:', error)
    supportedTypes.value = []
  } finally {
    loadingSupportedTypes.value = false
  }
}

const loadTestsFromStorage = () => {
  try {
    const stored = localStorage.getItem('deviceApiTests')
    if (stored) {
      recentTests.value = JSON.parse(stored)
    }
  } catch (error) {
    console.error('Error loading tests from storage:', error)
  }
}

const saveTestsToStorage = () => {
  try {
    localStorage.setItem('deviceApiTests', JSON.stringify(recentTests.value))
  } catch (error) {
    console.error('Error saving tests to storage:', error)
  }
}

// Lifecycle
onMounted(() => {
  loadSupportedTypes()
  loadTestsFromStorage()
})
</script>

<style scoped>
.device-api-testing {
  max-width: 100%;
}

pre {
  background-color: #f5f5f5;
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
}

.v-theme--dark pre {
  background-color: #1e1e1e;
}
</style>
