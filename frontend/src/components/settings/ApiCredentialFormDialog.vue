<template>
  <v-dialog v-model="open" max-width="600px" :fullscreen="$vuetify.display.xs" persistent>
    <v-card>
      <v-card-title>
        <span class="text-h5">{{ isEdit ? 'Edit' : 'Add' }} API Credential</span>
      </v-card-title>

      <v-card-text>
        <v-form ref="formRef" v-model="formValid" @submit.prevent="save">
          <v-text-field
            v-model="formData.name"
            label="Credential Name"
            :rules="[rules.required]"
            variant="outlined"
            prepend-inner-icon="mdi-text"
            autofocus
            class="mb-2"
          ></v-text-field>

          <v-select
            v-model="formData.type"
            :items="credentialTypes"
            label="Credential Type"
            :rules="[rules.required]"
            variant="outlined"
            prepend-inner-icon="mdi-shape"
            class="mb-2"
          ></v-select>

          <v-text-field
            v-model="formData.username"
            label="Username"
            variant="outlined"
            prepend-inner-icon="mdi-account"
            autocomplete="off"
            class="mb-2"
          ></v-text-field>

          <v-text-field
            v-model="formData.password"
            label="Password"
            :type="showPassword ? 'text' : 'password'"
            variant="outlined"
            prepend-inner-icon="mdi-lock"
            :append-inner-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :hint="isEdit ? 'Leave blank to keep the current password' : ''"
            persistent-hint
            autocomplete="new-password"
            class="mb-2"
            @click:append-inner="showPassword = !showPassword"
          ></v-text-field>

          <v-text-field
            v-model="formData.apiKey"
            label="API Key (Optional)"
            :type="showApiKey ? 'text' : 'password'"
            variant="outlined"
            prepend-inner-icon="mdi-key"
            :append-inner-icon="showApiKey ? 'mdi-eye' : 'mdi-eye-off'"
            :hint="isEdit && credential?.apiKey ? 'Leave blank to keep the current key' : ''"
            persistent-hint
            autocomplete="new-password"
            class="mb-2"
            @click:append-inner="showApiKey = !showApiKey"
          ></v-text-field>

          <v-text-field
            v-model="formData.apiSecret"
            label="API Secret (Optional)"
            :type="showSecret ? 'text' : 'password'"
            variant="outlined"
            prepend-inner-icon="mdi-key-variant"
            :append-inner-icon="showSecret ? 'mdi-eye' : 'mdi-eye-off'"
            autocomplete="new-password"
            class="mb-2"
            @click:append-inner="showSecret = !showSecret"
          ></v-text-field>

          <v-text-field
            v-model="formData.enableSecret"
            label="Enable Secret (Optional, Cisco IOS)"
            :type="showEnable ? 'text' : 'password'"
            variant="outlined"
            prepend-inner-icon="mdi-shield-key"
            :append-inner-icon="showEnable ? 'mdi-eye' : 'mdi-eye-off'"
            :disabled="clearEnableSecret"
            :hint="enableSecretHint"
            persistent-hint
            autocomplete="new-password"
            class="mb-2"
            @click:append-inner="showEnable = !showEnable"
          ></v-text-field>
          <v-checkbox
            v-if="isEdit && credential?.enableSecret"
            v-model="clearEnableSecret"
            label="Remove the stored enable secret"
            density="compact"
            hide-details
            class="mb-2"
          ></v-checkbox>

          <v-textarea
            v-model="formData.notes"
            label="Notes (Optional)"
            variant="outlined"
            prepend-inner-icon="mdi-note-text"
            rows="3"
          ></v-textarea>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer></v-spacer>
        <v-btn color="grey" variant="text" :disabled="saving" @click="open = false">
          Cancel
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="!formValid"
          :loading="saving"
          @click="save"
        >
          {{ isEdit ? 'Save' : 'Add' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useNotificationsStore } from '@/stores/notifications'
import debugLog, { DebugCategory } from '@/utils/debug'

// Add or edit one device API credential. Used by Settings → API Credentials and,
// in create mode, by the device forms' "Add credential" option, which select the
// new credential from the `saved` event.
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  // The credential to edit; null adds a new one
  credential: { type: Object, default: null },
  // Starting values for a new credential (e.g. { type: 'switch' })
  defaults: { type: Object, default: () => ({}) },
})
const emit = defineEmits(['update:modelValue', 'saved'])

const settingsStore = useSettingsStore()
const notificationStore = useNotificationsStore()

const open = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const isEdit = computed(() => !!props.credential)

const credentialTypes = [
  { title: 'Switch', value: 'switch' },
  { title: 'Access Point', value: 'ap' },
  { title: 'Gateway', value: 'gateway' },
  { title: 'Controller', value: 'controller' },
  { title: 'Other', value: 'other' },
]

const rules = {
  required: (value) => !!value || 'This field is required',
}

const emptyForm = () => ({
  name: '',
  type: '',
  username: '',
  password: '',
  apiKey: '',
  apiSecret: '',
  enableSecret: '',
  notes: '',
})

const formRef = ref(null)
const formValid = ref(false)
const formData = ref(emptyForm())
const saving = ref(false)
const showPassword = ref(false)
const showSecret = ref(false)
const showApiKey = ref(false)
const showEnable = ref(false)
const clearEnableSecret = ref(false)

const enableSecretHint = computed(() => (
  isEdit.value && props.credential?.enableSecret
    ? 'Leave blank to keep the current enable secret'
    : 'Only for a login that lands at the ">" prompt. Not needed with a privilege-15 account.'
))

// Fill the form each time the dialog opens. Secrets are never pre-filled: the
// list carries only their masks.
watch(() => props.modelValue, (isOpen) => {
  if (!isOpen) return
  const c = props.credential
  formData.value = c
    ? { ...emptyForm(), name: c.name, type: c.type, username: c.username || '', notes: c.notes || '' }
    : { ...emptyForm(), ...props.defaults }
  showPassword.value = false
  showSecret.value = false
  showApiKey.value = false
  showEnable.value = false
  clearEnableSecret.value = false
  formRef.value?.resetValidation()
}, { immediate: true })

const save = async () => {
  if (!formValid.value || saving.value) return

  // Secrets only when entered: blank keeps the stored value on an edit
  const f = formData.value
  const data = {
    name: f.name,
    type: f.type,
    username: f.username,
    notes: f.notes,
  }
  if (f.apiKey) data.apiKey = f.apiKey
  if (f.password) data.password = f.password
  if (f.apiSecret) data.apiSecret = f.apiSecret
  // The enable secret: a new value, or an empty one to remove the stored one
  if (clearEnableSecret.value) {
    data.enableSecret = ''
  } else if (f.enableSecret) {
    data.enableSecret = f.enableSecret
  }

  saving.value = true
  try {
    let saved
    if (isEdit.value) {
      saved = await settingsStore.updateApiCredential(props.credential.id, data)
      notificationStore.showSuccess(`Credential ${f.name} updated`)
    } else {
      saved = await settingsStore.createApiCredential(data)
      notificationStore.showSuccess(`Credential ${f.name} added`)
    }
    emit('saved', saved)
    open.value = false
  } catch (error) {
    debugLog.error(DebugCategory.SETTINGS, 'Failed to save credential:', error)
    notificationStore.showError(
      error.userMessage || error.response?.data?.message || 'Failed to save credential'
    )
  } finally {
    saving.value = false
  }
}
</script>
