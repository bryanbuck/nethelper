<template>
  <v-dialog :model-value="modelValue" max-width="440" persistent @update:model-value="emit('update:modelValue', $event)">
    <v-card>
      <v-card-title>Change password</v-card-title>
      <v-card-text>
        <v-form ref="formRef" @submit.prevent="submit">
          <v-text-field
            v-model="current"
            label="Current password"
            type="password"
            :rules="[required]"
            autocomplete="current-password"
          />
          <v-text-field
            v-model="next"
            label="New password"
            type="password"
            :rules="[required, minLength]"
            hint="At least 12 characters"
            persistent-hint
            autocomplete="new-password"
          />
          <v-text-field
            v-model="confirm"
            class="mt-2"
            label="Confirm new password"
            type="password"
            :rules="[required, matches]"
            autocomplete="new-password"
          />
        </v-form>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn color="primary" :loading="saving" @click="submit">Change password</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { apiErrorMessage } from '@/utils/apiError'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const authStore = useAuthStore()
const notifications = useNotificationsStore()

const formRef = ref(null)
const current = ref('')
const next = ref('')
const confirm = ref('')
const saving = ref(false)

const required = (v) => !!v || 'Required'
const minLength = (v) => (v && v.length >= 12) || 'At least 12 characters'
const matches = (v) => v === next.value || 'Passwords do not match'

// Never keep typed passwords around between openings.
watch(() => props.modelValue, (open) => {
  if (open) {
    current.value = ''
    next.value = ''
    confirm.value = ''
  }
})

function close () {
  emit('update:modelValue', false)
}

async function submit () {
  const { valid } = await formRef.value.validate()
  if (!valid) return
  saving.value = true
  try {
    await authStore.changePassword(current.value, next.value)
    notifications.showSuccess('Password changed')
    close()
  } catch (error) {
    notifications.showError(apiErrorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>
