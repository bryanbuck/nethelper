<template>
  <v-container class="fill-height" fluid>
    <v-row justify="center" align="center" class="fill-height">
      <v-col cols="12" sm="8" md="6" lg="4" xl="3">
        <v-card class="elevation-8 rounded-lg">
          <v-card-title class="text-center py-8">
            <div class="text-h4 font-weight-bold primary--text">
              Reset Password
            </div>
            <div class="text-subtitle-1 text-medium-emphasis mt-2">
              Enter your email to receive reset instructions
            </div>
          </v-card-title>

          <v-card-text class="px-8 pb-8">
            <!-- Success State -->
            <div v-if="emailSent" class="text-center">
              <v-icon
                size="80"
                color="success"
                class="mb-4"
              >
                mdi-email-check
              </v-icon>
              
              <h3 class="text-h6 mb-4">Check your email</h3>
              
              <p class="text-body-2 text-medium-emphasis mb-6">
                We've sent password reset instructions to
                <strong>{{ submittedEmail }}</strong>
              </p>

              <v-btn
                color="primary"
                variant="outlined"
                @click="resetForm"
                class="mb-4"
              >
                Send to different email
              </v-btn>

              <div class="text-center">
                <router-link
                  to="/login"
                  class="text-primary text-decoration-none"
                >
                  <v-icon small class="mr-1">mdi-arrow-left</v-icon>
                  Back to Sign In
                </router-link>
              </div>
            </div>

            <!-- Form State -->
            <Form 
              v-else
              v-slot="{ handleSubmit, isSubmitting }" 
              :validation-schema="validationSchema"
            >
              <form @submit="handleSubmit(onSubmit)">
                <!-- Email Field -->
                <Field name="email" v-slot="{ field, errors }">
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
                    placeholder="Enter your email address"
                    @keyup.enter="handleSubmit(onSubmit)"
                  />
                </Field>

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

                <!-- Info Alert -->
                <v-alert
                  type="info"
                  variant="tonal"
                  class="mb-4"
                  density="compact"
                >
                  <template #prepend>
                    <v-icon>mdi-information</v-icon>
                  </template>
                  You'll receive an email with instructions to reset your password.
                </v-alert>

                <!-- Submit Button -->
                <v-btn
                  type="submit"
                  color="primary"
                  size="large"
                  :loading="authStore.isLoading"
                  :disabled="isSubmitting"
                  block
                  class="mb-4"
                >
                  Send Reset Instructions
                </v-btn>

                <!-- Back to Login Link -->
                <div class="text-center">
                  <router-link
                    to="/login"
                    class="text-primary text-decoration-none"
                  >
                    <v-icon small class="mr-1">mdi-arrow-left</v-icon>
                    Back to Sign In
                  </router-link>
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
import { ref } from 'vue'
import { Form, Field } from 'vee-validate'
import * as yup from 'yup'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

// Component state
const emailSent = ref(false)
const submittedEmail = ref('')

// Validation schema
const validationSchema = yup.object({
  email: yup
    .string()
    .required('Email is required')
    .email('Please enter a valid email address')
})

// Form submission handler
const onSubmit = async (values) => {
  try {
    await authStore.forgotPassword(values.email)
    
    // Show success state
    submittedEmail.value = values.email
    emailSent.value = true
  } catch (error) {
    console.error('Forgot password error:', error)
    // Error is handled by the auth store
  }
}

// Reset form to initial state
const resetForm = () => {
  emailSent.value = false
  submittedEmail.value = ''
  authStore.clearError()
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

/* Success state animation */
.v-icon {
  animation: bounceIn 0.6s ease-out;
}

@keyframes bounceIn {
  0% {
    transform: scale(0.3);
    opacity: 0;
  }
  50% {
    transform: scale(1.05);
  }
  70% {
    transform: scale(0.9);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
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

/* Link styling */
a {
  transition: color 0.2s ease;
}

a:hover {
  text-decoration: underline !important;
}
</style>