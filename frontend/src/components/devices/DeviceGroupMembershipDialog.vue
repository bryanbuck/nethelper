<template>
  <v-dialog :model-value="modelValue" max-width="520" @update:model-value="close">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start icon="mdi-folder-plus-outline" />
        Group {{ deviceIds.length }} device{{ deviceIds.length === 1 ? '' : 's' }}
      </v-card-title>

      <v-card-text>
        <v-btn-toggle v-model="mode" mandatory density="compact" variant="outlined" color="primary" class="mb-4">
          <v-btn value="add" prepend-icon="mdi-folder-plus-outline">Add to group</v-btn>
          <v-btn value="remove" prepend-icon="mdi-folder-remove-outline">Remove from group</v-btn>
        </v-btn-toggle>

        <v-combobox
          v-if="mode === 'add'"
          v-model="choice"
          :items="groupsStore.sorted"
          item-title="name"
          item-value="id"
          label="Group"
          hint="Pick a group, or type a new name to create one"
          persistent-hint
          variant="outlined"
          density="compact"
          :loading="groupsStore.loading"
        />
        <v-select
          v-else
          v-model="choice"
          :items="groupsStore.sorted"
          item-title="name"
          item-value="id"
          return-object
          label="Group"
          variant="outlined"
          density="compact"
          :loading="groupsStore.loading"
          no-data-text="No groups yet"
        />

        <p class="text-body-2 text-medium-emphasis mt-4 mb-0">
          Other devices in the group stay in it. Devices already in (or not in) the group are left as they are.
        </p>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancel</v-btn>
        <v-btn color="primary" :disabled="!choiceName" :loading="saving" @click="apply">
          {{ mode === 'add' ? (isNewGroup ? 'Create and add' : 'Add') : 'Remove' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useGroupsStore } from '@/stores/groups'
import { useNotificationsStore } from '@/stores/notifications'

const dialogProps = defineProps({
  modelValue: { type: Boolean, default: false },
  deviceIds: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:modelValue', 'changed'])

const groupsStore = useGroupsStore()
const notifications = useNotificationsStore()

const mode = ref('add')
// A group row, or (adding only) a typed name for a new group
const choice = ref(null)
const saving = ref(false)

watch(() => dialogProps.modelValue, (open) => {
  if (!open) return
  mode.value = 'add'
  choice.value = null
  groupsStore.fetchGroups().catch(() => {})
})
watch(mode, () => { choice.value = null })

const choiceName = computed(() => (typeof choice.value === 'string' ? choice.value.trim() : choice.value?.name) || '')
// A typed name that matches an existing group (any case) uses that group
const existingByName = computed(() => groupsStore.groups.find((g) => g.name.toLowerCase() === choiceName.value.toLowerCase()))
const isNewGroup = computed(() => mode.value === 'add' && !!choiceName.value && !existingByName.value)

const close = () => emit('update:modelValue', false)

const apply = async () => {
  saving.value = true
  try {
    const group = isNewGroup.value
      ? await groupsStore.createGroup({ name: choiceName.value })
      : (typeof choice.value === 'object' && choice.value) || existingByName.value
    const ids = dialogProps.deviceIds
    const change = mode.value === 'add' ? { add: ids } : { remove: ids }
    const result = await groupsStore.changeMembers(group.id, change)
    const n = ids.length
    notifications.showSuccess(
      `${mode.value === 'add' ? 'Added' : 'Removed'} ${n} device${n === 1 ? '' : 's'} ${mode.value === 'add' ? 'to' : 'from'} "${result.name}" (${result.deviceCount} now)`
    )
    emit('changed', result)
    close()
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not change the group')
  } finally {
    saving.value = false
  }
}
</script>
