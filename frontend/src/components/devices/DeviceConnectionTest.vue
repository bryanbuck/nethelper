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
          variant="outlined"
          density="compact"
          class="mb-2"
          prepend-icon="mdi-ip-network"
        />

        <v-text-field
          v-model="formData.username"
          label="Username"
          :rules="[rules.required]"
          variant="outlined"
          density="compact"
          class="mb-2"
          prepend-icon="mdi-account"
        />

        <v-text-field
          v-model="formData.password"
          label="Password"
          :rules="[rules.required]"
          :type="showPassword ? 'text' : 'password'"
          variant="outlined"
          density="compact"
          class="mb-2"
          prepend-icon="mdi-lock"
          :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append-inner="showPassword = !showPassword"
        />

        <v-select
          v-model="formData.platform"
          label="Platform"
          :items="platforms"
          item-title="name"
          item-value="platform"
          :rules="[rules.required]"
          :loading="loadingPlatforms"
          :hint="platformHint"
          persistent-hint
          variant="outlined"
          density="compact"
          prepend-icon="mdi-router-network"
        />
      </v-form>

      <!-- Test Results -->
      <v-alert
        v-if="testResult"
        :type="resultType"
        class="mt-4"
        :closable="mode === 'manual'"
        @click:close="clearResults"
      >
        <div class="text-h6 mb-2">{{ resultTitle }}</div>

        <div v-if="testResult.success">
          <div v-if="testResult.transport" class="mb-1">
            <strong>Via:</strong> {{ transportLabel(testResult.transport) }}
          </div>

          <div v-if="testResult.responseTime" class="mb-1">
            <strong>Response Time:</strong> {{ testResult.responseTime }} ms
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

          <pre v-if="testResult.preview" class="text-caption mt-2 preview">{{ testResult.preview }}</pre>
        </div>

        <!-- Nothing reaches this device directly: not a failure -->
        <div v-else-if="testResult.cloudOnly">
          {{ testResult.message }}
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

        <div v-if="testResult.centralStatus" class="mt-2 text-caption">
          Switch reports: {{ centralStatusLabel }}
        </div>
        <div v-if="testResult.testedAt" class="mt-2 text-caption">
          Tested {{ formatDate(testResult.testedAt) }}
        </div>
      </v-alert>

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
        color="primary"
        :loading="testing"
        :disabled="!canTest"
        @click="testConnection"
      >
        <v-icon start>mdi-connection</v-icon>
        {{ testResult && mode === 'stored' ? 'Test Again' : 'Test Connection' }}
      </v-btn>
    </v-card-actions>
  </v-card>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import deviceApiService from '@/services/deviceApi.service'
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
  // A result already reported elsewhere (stored mode), shown without
  // contacting the device again; Test Again runs a new test.
  result: {
    type: Object,
    default: null
  },
  autoTest: {
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

// test-complete fires for every finished test, passed or not
// (result.success says which); test-error when the test couldn't run.
const emit = defineEmits(['test-start', 'test-complete', 'test-error'])

// Form data
const formRef = ref(null)
const formValid = ref(false)
const showPassword = ref(false)

const formData = ref({
  deviceIp: '',
  username: '',
  password: '',
  platform: 'aos-cx'
})

// Platforms the backend can test (GET /device-api/supported-types)
const platforms = ref([])
const loadingPlatforms = ref(false)

const platformHint = computed(() => {
  const transports = platforms.value.find(p => p.platform === formData.value.platform)?.transports || []
  return transports.length ? `Tested over ${transports.join(', then ')}` : ''
})

const loadPlatforms = async () => {
  loadingPlatforms.value = true
  try {
    platforms.value = (await deviceApiService.getSupportedTypes()).filter(p => p.testable)
  } catch (error) {
    console.error('Error loading platforms:', error)
  } finally {
    loadingPlatforms.value = false
  }
}

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
const testResult = ref(props.result)

watch(() => props.result, (result) => {
  testResult.value = result
})

const canTest = computed(() => {
  if (props.mode === 'stored') {
    return !!props.deviceId
  }
  return formValid.value
})

const resultType = computed(() => {
  if (testResult.value?.success) return 'success'
  return testResult.value?.cloudOnly ? 'info' : 'error'
})

const resultTitle = computed(() => {
  if (testResult.value?.success) return 'Connection Successful'
  if (testResult.value?.cloudOnly) return 'No direct connection to test'
  return errorInfo.value.title
})

const errorInfo = computed(() => {
  if (!testResult.value || testResult.value.success || testResult.value.cloudOnly) {
    return { title: '', message: '', actions: [] }
  }
  return deviceApiService.formatConnectionError(testResult.value)
})

const centralStatusLabel = computed(() => {
  const status = testResult.value?.centralStatus
  if (!status) return ''
  const label = status.centralManaged === true ? 'Central-managed' : status.centralManaged === false ? 'Locally managed' : 'Unknown'
  return status.connectionStatus ? `${label} (${status.connectionStatus})` : label
})

const transportLabel = (transport) => ({ 'cx-rest': 'REST', rest: 'REST', netconf: 'NETCONF', ssh: 'SSH' }[transport] || transport)

// Methods
const testConnection = async () => {
  testing.value = true
  testResult.value = null

  emit('test-start')

  try {
    // Both return the test's own result, never the HTTP envelope
    const result = props.mode === 'manual'
      ? await deviceApiService.testManualConnection(formData.value)
      : await deviceApiService.testDeviceConnection(props.deviceId)
    testResult.value = result

    const { deviceIp, username, platform } = formData.value
    emit('test-complete', props.mode === 'manual' ? { ...result, deviceIp, username, platform } : result)
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

const clearResults = () => {
  testResult.value = null
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

onMounted(() => {
  if (props.mode === 'manual') loadPlatforms()
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

.preview {
  white-space: pre-wrap;
}
</style>
