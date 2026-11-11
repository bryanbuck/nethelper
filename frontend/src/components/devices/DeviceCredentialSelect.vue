<template>
  <v-select
    v-bind="$attrs"
    v-model:menu="menu"
    :model-value="modelValue"
    :items="credentials"
    item-title="name"
    item-value="id"
    variant="outlined"
    prepend-inner-icon="mdi-key-variant"
    no-data-text="No credentials yet"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #item="{ props: itemProps, item }">
      <v-list-item
        v-bind="itemProps"
        :subtitle="`${item.raw.type} · ${item.raw.username || 'no username'}`"
      >
        <template v-if="item.raw.lastTestStatus" #append>
          <v-chip
            :color="item.raw.lastTestStatus === 'success' ? 'success' : 'error'"
            size="x-small"
            variant="flat"
          >
            {{ item.raw.lastTestStatus }}
          </v-chip>
        </template>
      </v-list-item>
    </template>

    <template v-if="canAdd" #prepend-item>
      <v-list-item
        title="Add credential"
        prepend-icon="mdi-plus"
        class="text-primary"
        @click="openForm"
      />
      <v-divider class="mb-2" />
    </template>
  </v-select>

  <ApiCredentialFormDialog
    v-if="canAdd"
    v-model="formOpen"
    :defaults="formDefaults"
    @saved="onSaved"
  />
</template>

<script setup>
import { ref, computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useAuthStore } from '@/stores/auth'
import ApiCredentialFormDialog from '@/components/settings/ApiCredentialFormDialog.vue'

// The device credential picker of the device forms (add, edit, bulk link). Its
// first item adds a credential in place, so linking a new switch never needs a
// trip to Settings; the new credential is selected once saved. Other v-select
// props (label, hint, density, loading, …) pass through.
defineOptions({ inheritAttrs: false })

const props = defineProps({
  modelValue: { type: String, default: null },
  // The device type being added/edited ('switch', 'access_point', …); it picks
  // the new credential's type. Blank leaves the type to the user.
  deviceType: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])

const settingsStore = useSettingsStore()
const authStore = useAuthStore()

// Adding credentials is operator+, like Settings → API Credentials
const canAdd = computed(() => ['admin', 'operator'].includes(authStore.userRole))
const credentials = computed(() => settingsStore.apiCredentials || [])

// Device type → credential type (the credential's own, shorter list)
const CREDENTIAL_TYPE = {
  switch: 'switch',
  access_point: 'ap',
  gateway: 'gateway',
  controller: 'controller',
  other: 'other',
}

const menu = ref(false)
const formOpen = ref(false)
const formDefaults = computed(() => {
  const type = CREDENTIAL_TYPE[props.deviceType]
  return type ? { type } : {}
})

const openForm = () => {
  menu.value = false
  formOpen.value = true
}

const onSaved = (credential) => {
  if (credential?.id) emit('update:modelValue', credential.id)
}
</script>
