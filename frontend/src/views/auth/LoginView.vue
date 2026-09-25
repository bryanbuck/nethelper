<template>
  <v-container class="fill-height" fluid>
    <v-row justify="center" align="center" class="fill-height">
      <v-col cols="12" sm="8" md="6" lg="4" xl="3">
        <v-card class="elevation-8 rounded-lg">
          <v-card-title class="text-center py-8">
            <div class="text-h4 font-weight-bold primary--text">
              NetHelper
            </div>
            <div class="text-subtitle-1 text-medium-emphasis mt-2">
              Network Automation Platform
            </div>
          </v-card-title>

          <v-card-text class="px-8 pb-8">
            <Form v-slot="{ handleSubmit, isSubmitting }" :validation-schema="validationSchema">
              <form @submit.prevent="handleSubmit(onSubmit)">
                <!-- Email Field -->
                <Field v-slot="{ field, errors }" name="email">
                  <v-text-field
                    v-bind="field"
                    label="Email Address"
                    type="email"
                    variant="outlined"
                    prepend-inner-icon="mdi-email"
                    :error-messages="errors"
                    :disabled="authStore.isLoading"
                    class="mb-3"
                    autocomplete="email"
                    @keyup.enter="focusPassword"
                  />
                </Field>

                <!-- Password Field -->
                <Field v-slot="{ field, errors }" name="password">
                  <v-text-field
                    ref="passwordField"
                    v-bind="field"
                    label="Password"
                    :type="showPassword ? 'text' : 'password'"
                    variant="outlined"
                    prepend-inner-icon="mdi-lock"
                    :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                    :error-messages="errors"
                    :disabled="authStore.isLoading"
                    class="mb-3"
                    autocomplete="current-password"
                    @click:append-inner="showPassword = !showPassword"
                    @keyup.enter="handleSubmit(onSubmit)"
                  />
                </Field>

                <!-- Remember Me -->
                <v-checkbox
                  v-model="rememberMe"
                  label="Remember me"
                  color="primary"
                  :disabled="authStore.isLoading"
                  class="mb-3"
                />

                <!-- Error Alert -->
                <v-alert
                  v-if="authStore.error"
                  type="error"
                  variant="tonal"
                  class="mb-4"
                  closable
                  @click:close="authStore.clearError"
                >
                  {{ authStore.error }}
                </v-alert>

                <!-- Login Button -->
                <v-btn
                  type="submit"
                  color="primary"
                  size="large"
                  :loading="authStore.isLoading"
                  :disabled="isSubmitting"
                  block
                  class="mb-4"
                >
                  Sign In
                </v-btn>


                <!-- No self-service reset: accounts are managed by an admin -->
                <div class="text-center text-body-2 text-medium-emphasis">
                  Forgot your password? Ask a NetHelper administrator to reset it.
                </div>
              </form>
            </Form>
          </v-card-text>
        </v-card>


        <!-- Footer -->
        <div class="text-center mt-6">
          <v-chip
            variant="text"
            size="small"
            class="text-medium-emphasis"
          >
            � 2024 NetHelper Automation Platform
          </v-chip>
        </div>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { Form, Field } from 'vee-validate'
import * as yup from 'yup'
import { useAuthStore } from '@/stores/auth'
import { useRouter, useRoute } from 'vue-router'
import debugLog, { DebugCategory } from '@/utils/debug'

const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()

// Component state
const showPassword = ref(false)
const rememberMe = ref(false)
const passwordField = ref(null)

// Validation schema
const validationSchema = yup.object({
  email: yup
    .string()
    .required('Email is required')
    .email('Please enter a valid email address'),
  password: yup
    .string()
    .required('Password is required')
    .min(6, 'Password must be at least 6 characters')
})

// Focus password field when Enter is pressed in email field
const focusPassword = async () => {
  await nextTick()
  if (passwordField.value) {
    passwordField.value.focus()
  }
}

// Form submission handler
const onSubmit = async (values) => {
  debugLog.progress(DebugCategory.AUTH, 'Login form submitted', { email: values.email, password: '***' })
  debugLog.progress(DebugCategory.AUTH, 'Remember me:', rememberMe.value)
  
  try {
    debugLog.progress(DebugCategory.AUTH, 'Calling authStore.login...')
    const result = await authStore.login({
      email: values.email,
      password: values.password,
      remember: rememberMe.value
    })
    
    debugLog.success(DebugCategory.AUTH, 'Login successful, result:', result)
    debugLog.success(DebugCategory.AUTH, 'Auth store state after login', {
      isAuthenticated: authStore.isAuthenticated,
      user: authStore.user,
      token: authStore.token ? 'present' : 'missing'
    })

    // Redirect to intended page or dashboard
    const redirectTo = route.query.redirect || '/dashboard'
    debugLog.progress(DebugCategory.AUTH, 'Redirecting to:', redirectTo)
    await router.push(redirectTo)
    debugLog.success(DebugCategory.AUTH, 'Redirect completed')
  } catch (error) {
    debugLog.error(DebugCategory.AUTH, 'Login error:', error)
    debugLog.error(DebugCategory.AUTH, 'Error response:', error.response?.data)
    debugLog.error(DebugCategory.AUTH, 'Error status:', error.response?.status)
    // Error is handled by the auth store
  }
}

// Clear any existing errors when component mounts
authStore.clearError()
</script>

<style scoped>
.fill-height {
  min-height: 100vh;
  background: linear-gradient(135deg, #FF8300 0%, #cc6900 100%);
}

.v-card {
  border-radius: 16px !important;
}

.v-card-title {
  background: linear-gradient(45deg, #FF8300, #cc6900);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.primary--text {
  color: #FF8300 !important;
}

/* Custom input styling */
:deep(.v-field--variant-outlined .v-field__outline) {
  --v-field-border-width: 2px;
}

:deep(.v-field--focused .v-field__outline) {
  --v-field-border-color: rgb(var(--v-theme-primary));
}

/* Loading animation */
.v-btn--loading {
  pointer-events: none;
}

/* Responsive adjustments */
@media (max-width: 600px) {
  .v-card-text {
    padding: 1.5rem !important;
  }
  
  .v-card-title {
    padding: 2rem 1.5rem !important;
  }
}
</style>