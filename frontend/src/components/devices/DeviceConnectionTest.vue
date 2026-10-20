<template>
  <v-card>
    <v-card-title v-if="showTitle">
      {{ title }}
    </v-card-title>

    <v-card-text>
      <!-- Manual Mode Form -->
      <v-form v-if="mode === 'manual'" ref="formRef" v-model="formValid">
        <v-text-field
          v-model="formData.deviceIp"
          label="Device IP Address"
          :rules="[rules.required, rules.ip]"
          outlined
          dense
          class="mb-2"
          prepend-icon="mdi-ip-network"
        />

        <v-text-field
          v-model="formData.username"
          label="Username"
          :rules="[rules.required]"
          outlined
          dense
          class="mb-2"
          prepend-icon="mdi-account"
        />

        <v-text-field
          v-model="formData.password"
          label="Password"
          :rules="[rules.required]"
          :type="showPassword ? 'text' : 'password'"
          outlined
          dense
          class="mb-2"
          prepend-icon="mdi-lock"
          :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append="showPassword = !showPassword"
        />

        <v-select
          v-model="formData.deviceType"
          label="Device Type"
          :items="deviceTypes"
          item-title="name"
          item-value="type"
          :rules="[rules.required]"
          outlined
          dense
          prepend-icon="mdi-router-network"
        />
      </v-form>

      <!-- Test Results -->
      <v-alert
        v-if="testResult"
        :type="testResult.success ? 'success' : 'error'"
        :icon="testResult.success ? 'mdi-check-circle' : 'mdi-alert-circle'"
        class="mt-4"
        closable
        @click:close="clearResults"
      >
        <div class="text-h6 mb-2">
          {{ testResult.success ? 'Connection Successful' : errorInfo.title }}
        </div>

        <div v-if="testResult.success">
          <div v-if="testResult.responseTime" class="mb-1">
            <strong>Response Time:</strong> {{ testResult.responseTime }}ms
          </div>

          <div v-if="testResult.deviceInfo">
            <strong>Device:</strong> {{ testResult.deviceInfo.hostname || 'Unknown' }}
            <span v-if="testResult.deviceInfo.model">
              ({{ testResult.deviceInfo.model }})
            </span>
          </div>

          <div v-if="testResult.deviceInfo?.version">
            <strong>Version:</strong> {{ testResult.deviceInfo.version }}
          </div>

          <div v-if="testResult.testedAt" class="mt-2 text-caption">
            Last Tested: {{ formatDate(testResult.testedAt) }}
          </div>
        </div>

        <div v-else>
          <div class="mb-2">{{ errorInfo.message }}</div>

          <div v-if="errorInfo.actions.length" class="mt-3">
            <div class="font-weight-bold mb-1">Troubleshooting:</div>
            <ul class="ml-4">
              <li v-for="(action, index) in errorInfo.actions" :key="index">
                {{ action }}
              </li>
            </ul>
          </div>

          <div v-if="testResult.details" class="mt-2 text-caption">
            {{ testResult.details }}
          </div>
        </div>
      </v-alert>

      <!-- Device Info Display -->
      <DeviceInfoDisplay
        v-if="showDeviceInfo && deviceInfo"
        :device-info="deviceInfo"
        :firmware-info="firmwareInfo"
        :loading="loadingInfo"
        class="mt-4"
      />

      <!-- Loading Indicator -->
      <v-progress-linear
        v-if="testing"
        indeterminate
        color="primary"
        class="mt-4"
      />
    </v-card-text>

    <v-card-actions>
      <v-spacer />
      <v-btn
        v-if="mode === 'manual'"
        color="primary"
        :loading="testing"
        :disabled="!canTest"
        @click="testConnection"
      >
        <v-icon left>mdi-connection</v-icon>
        Test Connection
      </v-btn>
      <v-btn
        v-else
        color="primary"
        :loading="testing"
        @click="testConnection"
      >
        <v-icon left>mdi-connection</v-icon>
        Test Connection
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import deviceApiService from '@/services/deviceApi.service'
import DeviceInfoDisplay from './DeviceInfoDisplay.vue'
import { formatDistanceToNow } from 'date-fns'

const props = defineProps({
  mode: {
    type: String,
    default: 'manual', // 'manual' or 'stored'
    validator: (value) => ['manual', 'stored'].includes(value)
  },
  deviceId: {
    type: String,
    default: null
  },
  autoTest: {
    type: Boolean,
    default: false
  },
  showDeviceInfo: {
    type: Boolean,
    default: false
  },
  showFirmwareInfo: {
    type: Boolean,
    default: false
  },
  showTitle: {
    type: Boolean,
    default: true
  },
  title: {
    type: String,
    default: 'Test Device Connection'
  }
})

const emit = defineEmits(['test-start', 'test-complete', 'test-error'])

// Form data
const formRef = ref(null)
const formValid = ref(false)
const showPassword = ref(false)

const formData = ref({
  deviceIp: '',
  username: '',
  password: '',
  deviceType: 'cx_switch'
})

// Device types
const deviceTypes = ref([
  { type: 'cx_switch', name: 'CX Switch (Aruba AOS-CX)' },
  { type: 'aos_switch', name: 'AOS Switch (Legacy Aruba)' },
  { type: 'instant_ap', name: 'Instant AP (Aruba IAP)' },
  { type: 'aruba_controller', name: 'Aruba Controller' }
])

// Validation rules
const rules = {
  required: (v) => !!v || 'This field is required',
  ip: (v) => {
    if (!v) return true
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/
    return ipPattern.test(v) || 'Invalid IP address format'
  }
}

// Test state
const testing = ref(false)
const testResult = ref(null)
const deviceInfo = ref(null)
const firmwareInfo = ref(null)
const loadingInfo = ref(false)

// Computed
const canTest = computed(() => {
  if (props.mode === 'stored') {
    return !!props.deviceId
  }
  return formValid.value
})

const errorInfo = computed(() => {
  if (!testResult.value || testResult.value.success) {
    return { title: '', message: '', actions: [] }
  }
  return deviceApiService.formatConnectionError(testResult.value)
})

// Methods
const testConnection = async () => {
  testing.value = true
  testResult.value = null
  deviceInfo.value = null
  firmwareInfo.value = null

  emit('test-start')

  try {
    let response

    if (props.mode === 'manual') {
      response = await deviceApiService.testManualConnection(formData.value)
    } else {
      response = await deviceApiService.testDeviceConnection(props.deviceId)
    }

    // testDeviceConnection already unwraps; the manual test returns the envelope
    const result = props.mode === 'manual' ? response.data || response : response
    testResult.value = result

    if (result.success) {
      emit('test-complete', result)

      // Load additional info if requested
      if (props.showDeviceInfo && props.deviceId) {
        await loadDeviceInfo()
      }
    } else {
      emit('test-error', result)
    }
  } catch (error) {
    console.error('Connection test failed:', error)
    testResult.value = {
      success: false,
      message: error.userMessage || error.message || 'Connection test failed',
      details: error.message,
      testedAt: new Date().toISOString()
    }
    emit('test-error', error)
  } finally {
    testing.value = false
  }
}

const loadDeviceInfo = async () => {
  if (!props.deviceId) return

  loadingInfo.value = true

  try {
    const deviceInfoResponse = await deviceApiService.getDeviceInfo(props.deviceId)
    deviceInfo.value = deviceInfoResponse.data || deviceInfoResponse

    if (props.showFirmwareInfo) {
      const firmwareInfoResponse = await deviceApiService.getFirmwareInfo(props.deviceId)
      firmwareInfo.value = firmwareInfoResponse.data || firmwareInfoResponse
    }
  } catch (error) {
    console.error('Error loading device info:', error)
  } finally {
    loadingInfo.value = false
  }
}

const clearResults = () => {
  testResult.value = null
  deviceInfo.value = null
  firmwareInfo.value = null
}

const formatDate = (dateString) => {
  if (!dateString) return ''
  try {
    const date = new Date(dateString)
    return formatDistanceToNow(date, { addSuffix: true })
  } catch (error) {
    return dateString
  }
}

// Auto-test on mount if requested
onMounted(() => {
  if (props.autoTest && canTest.value) {
    testConnection()
  }
})

// Watch for deviceId changes in stored mode
watch(() => props.deviceId, (newId) => {
  if (newId && props.mode === 'stored' && props.autoTest) {
    testConnection()
  }
})
</script>

<style scoped>
.v-alert ul {
  margin-top: 8px;
}
</style>
