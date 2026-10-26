<template>
  <v-dialog :model-value="modelValue" max-width="760" :fullscreen="$vuetify.display.xs" scrollable @update:model-value="close">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start icon="mdi-folder-multiple-outline" />
        Device groups
        <v-spacer />
        <v-btn
          v-if="canEdit && !editing"
          color="primary"
          variant="tonal"
          size="small"
          prepend-icon="mdi-plus"
          @click="startEdit(null)"
        >
          New group
        </v-btn>
      </v-card-title>

      <v-card-text>
        <p class="text-body-2 mb-4">
          Automations use groups to pick their devices: Manual and Schedule triggers can target a
          group, and Alert and Configuration Change triggers can be limited to one. Put devices in a
          group from the Devices table: select them, then <strong>Group</strong>.
        </p>

        <!-- Create / rename -->
        <v-form v-if="editing" ref="form" class="mb-4" @submit.prevent="save">
          <div class="text-subtitle-2 mb-2">{{ editing.id ? `Edit "${editing.original}"` : 'New group' }}</div>
          <v-text-field
            v-model="editing.name"
            label="Name"
            variant="outlined"
            density="compact"
            autofocus
            :rules="[(v) => !!v?.trim() || 'A name is required']"
          />
          <v-text-field
            v-model="editing.description"
            label="Description (optional)"
            variant="outlined"
            density="compact"
          />
          <div class="d-flex ga-2">
            <v-btn type="submit" color="primary" :loading="saving">{{ editing.id ? 'Save' : 'Create' }}</v-btn>
            <v-btn variant="text" @click="editing = null">Cancel</v-btn>
          </div>
        </v-form>

        <v-alert v-if="groupsStore.error" type="error" variant="tonal" density="compact" class="mb-4">
          {{ groupsStore.error.userMessage || groupsStore.error.message || 'Could not load groups' }}
        </v-alert>

        <div v-if="groupsStore.loading && !groupsStore.groups.length" class="text-center py-6">
          <v-progress-circular indeterminate color="primary" />
        </div>

        <div v-else-if="!groupsStore.groups.length" class="text-center text-medium-emphasis py-6">
          No groups yet.
        </div>

        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th>Name</th>
              <th class="text-right">Devices</th>
              <th class="text-right">Automations</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in groupsStore.sorted" :key="group.id">
              <td>
                <div class="font-weight-medium">{{ group.name }}</div>
                <div v-if="group.description" class="text-caption text-medium-emphasis">{{ group.description }}</div>
              </td>
              <td class="text-right">{{ group._count?.devices ?? 0 }}</td>
              <td class="text-right">{{ group._count?.automations ?? 0 }}</td>
              <td class="text-right text-no-wrap">
                <v-btn
                  variant="text"
                  size="small"
                  prepend-icon="mdi-filter-outline"
                  :disabled="!group._count?.devices"
                  @click="showDevices(group)"
                >
                  Show devices
                </v-btn>
                <v-btn
                  v-if="canEdit"
                  icon="mdi-pencil"
                  variant="text"
                  size="small"
                  :aria-label="`Edit ${group.name}`"
                  @click="startEdit(group)"
                />
                <v-btn
                  v-if="isAdmin"
                  icon="mdi-delete"
                  variant="text"
                  size="small"
                  color="error"
                  :aria-label="`Delete ${group.name}`"
                  @click="deleteTarget = group"
                />
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Close</v-btn>
      </v-card-actions>
    </v-card>

    <v-dialog :model-value="!!deleteTarget" max-width="460" @update:model-value="deleteTarget = null">
      <v-card>
        <v-card-title>Delete group</v-card-title>
        <v-card-text>
          Delete <strong>{{ deleteTarget?.name }}</strong>? Its devices stay in the inventory; only the
          group goes.
          <div v-if="deleteTarget?._count?.automations" class="mt-2">
            {{ deleteTarget._count.automations }} automation(s) use this group. Their triggers and
            targets will no longer match any device through it.
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteTarget = null">Cancel</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { useGroupsStore } from '@/stores/groups'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'

const dialogProps = defineProps({
  modelValue: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'show-devices'])

const groupsStore = useGroupsStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()

// Creating and renaming are operator+, deleting admin only (as in the API)
const canEdit = computed(() => ['admin', 'operator'].includes(authStore.userRole))
const isAdmin = computed(() => authStore.userRole === 'admin')

const form = ref(null)
const editing = ref(null)
const saving = ref(false)
const deleteTarget = ref(null)
const deleting = ref(false)

watch(() => dialogProps.modelValue, (open) => {
  if (!open) return
  editing.value = null
  groupsStore.fetchGroups().catch(() => {})
})

const close = () => emit('update:modelValue', false)

const startEdit = (group) => {
  editing.value = group
    ? { id: group.id, original: group.name, name: group.name, description: group.description || '' }
    : { id: null, name: '', description: '' }
}

const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid) return
  saving.value = true
  const data = { name: editing.value.name.trim(), description: editing.value.description.trim() }
  try {
    if (editing.value.id) await groupsStore.updateGroup(editing.value.id, data)
    else await groupsStore.createGroup(data)
    notifications.showSuccess(`Group "${data.name}" ${editing.value.id ? 'saved' : 'created'}`)
    editing.value = null
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not save the group')
  } finally {
    saving.value = false
  }
}

const doDelete = async () => {
  deleting.value = true
  const { id, name } = deleteTarget.value
  try {
    await groupsStore.deleteGroup(id)
    notifications.showSuccess(`Group "${name}" deleted`)
    deleteTarget.value = null
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not delete the group')
  } finally {
    deleting.value = false
  }
}

const showDevices = (group) => {
  emit('show-devices', group.id)
  close()
}
</script>
