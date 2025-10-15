<template>
  <div v-if="hasError" class="error-boundary">
    <v-container>
      <v-row justify="center">
        <v-col cols="12" md="8" lg="6">
          <v-card class="mt-8">
            <v-card-text class="text-center pa-8">
              <v-icon
                size="80"
                :color="errorLevel === 'warning' ? 'warning' : 'error'"
                class="mb-4"
              >
                {{ errorLevel === 'warning' ? 'mdi-alert' : 'mdi-alert-circle' }}
              </v-icon>

              <h2 class="text-h5 mb-2">{{ errorTitle }}</h2>
              <p class="text-body-1 text-medium-emphasis mb-6">
                {{ errorMessage }}
              </p>

              <v-expansion-panels v-if="showDetails && errorDetails" class="mb-4">
                <v-expansion-panel>
                  <v-expansion-panel-title>
                    <v-icon start>mdi-information</v-icon>
                    Technical Details
                  </v-expansion-panel-title>
                  <v-expansion-panel-text>
                    <pre class="error-details">{{ errorDetails }}</pre>
                  </v-expansion-panel-text>
                </v-expansion-panel>
              </v-expansion-panels>

              <div class="d-flex gap-2 justify-center">
                <v-btn
                  color="primary"
                  variant="flat"
                  prepend-icon="mdi-refresh"
                  @click="handleRetry"
                >
                  Try Again
                </v-btn>

                <v-btn
                  v-if="showHome"
                  color="grey"
                  variant="outlined"
                  prepend-icon="mdi-home"
                  @click="goHome"
                >
                  Go Home
                </v-btn>
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
  </div>

  <slot v-else></slot>
</template>

<script setup>
import { ref, onErrorCaptured } from 'vue'
import { useRouter } from 'vue-router'
import debugLog, { DebugCategory } from '@/utils/debug'

const props = defineProps({
  showDetails: {
    type: Boolean,
    default: false // Only show details in development
  },
  showHome: {
    type: Boolean,
    default: true
  },
  errorLevel: {
    type: String,
    default: 'error', // 'error' or 'warning'
    validator: (value) => ['error', 'warning'].includes(value)
  }
})

const emit = defineEmits(['retry', 'error'])

const router = useRouter()

const hasError = ref(false)
const errorTitle = ref('Something went wrong')
const errorMessage = ref('We encountered an unexpected issue. Please try again.')
const errorDetails = ref('')

const handleRetry = () => {
  hasError.value = false
  errorTitle.value = ''
  errorMessage.value = ''
  errorDetails.value = ''
  emit('retry')
}

const goHome = () => {
  router.push('/dashboard')
}

// Capture errors from child components
onErrorCaptured((err, instance, info) => {
  debugLog.error(DebugCategory.COMPONENT, 'Error caught by ErrorBoundary:', {
    error: err,
    info,
    component: instance?.$options?.name
  })

  hasError.value = true

  // User-friendly error messages
  if (err.message.includes('Failed to fetch') || err.message.includes('Network')) {
    errorTitle.value = 'Connection Issue'
    errorMessage.value = 'Unable to connect to the server. Please check your internet connection and try again.'
  } else if (err.message.includes('401') || err.message.includes('Unauthorized')) {
    errorTitle.value = 'Authentication Required'
    errorMessage.value = 'Your session has expired. Please sign in again.'
    setTimeout(() => router.push('/login'), 2000)
  } else if (err.message.includes('403') || err.message.includes('Forbidden')) {
    errorTitle.value = 'Access Denied'
    errorMessage.value = 'You do not have permission to access this resource.'
  } else if (err.message.includes('404') || err.message.includes('Not Found')) {
    errorTitle.value = 'Not Found'
    errorMessage.value = 'The requested resource could not be found.'
  } else if (err.message.includes('500') || err.message.includes('Server Error')) {
    errorTitle.value = 'Server Error'
    errorMessage.value = 'The server encountered an error. Please try again later.'
  } else {
    errorTitle.value = 'Something went wrong'
    errorMessage.value = 'An unexpected error occurred. Please try again or contact support if the issue persists.'
  }

  // Include technical details in development
  if (props.showDetails || import.meta.env.DEV) {
    errorDetails.value = `${err.message}\n\nStack Trace:\n${err.stack || 'No stack trace available'}\n\nComponent Info: ${info}`
  }

  emit('error', err)

  // Prevent the error from propagating further
  return false
})

// Method to manually trigger error state (for programmatic error handling)
const showError = (title, message, details = null) => {
  hasError.value = true
  errorTitle.value = title
  errorMessage.value = message
  if (details) {
    errorDetails.value = details
  }
}

// Expose methods for parent components
defineExpose({
  showError,
  handleRetry
})
</script>

<style scoped>
.error-boundary {
  min-height: 400px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.error-details {
  background-color: #f5f5f5;
  padding: 1rem;
  border-radius: 4px;
  font-size: 12px;
  overflow-x: auto;
  text-align: left;
  max-height: 300px;
  overflow-y: auto;
}

.gap-2 {
  gap: 0.5rem;
}
</style>
