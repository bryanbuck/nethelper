<template>
  <v-menu v-model="menu" :close-on-content-click="false" location="bottom end">
    <template #activator="{ props: activator }">
      <ActionButton
        variant="outlined"
        :icon="current ? 'mdi-bookmark' : 'mdi-bookmark-outline'"
        label="Saved filters"
        v-bind="activator"
      />
    </template>

    <v-card min-width="280" max-width="360">
      <v-list density="compact" class="saved-filters-list">
        <v-list-subheader>Saved filters</v-list-subheader>

        <v-list-item v-if="store.loading && !store.sorted.length" title="Loading…" disabled />
        <v-list-item
          v-else-if="loadError"
          prepend-icon="mdi-alert-circle-outline"
          title="Couldn't load your saved filters"
          :subtitle="loadError"
          @click="load"
        />
        <v-list-item
          v-else-if="!store.sorted.length"
          title="None yet"
          subtitle="Set filters, then save them here"
          disabled
        />

        <v-list-item
          v-for="filter in store.sorted"
          :key="filter.id"
          :active="current?.id === filter.id"
          :title="filter.name"
          :subtitle="describe(filter.view)"
          @click="apply(filter)"
        >
          <template #prepend>
            <v-icon :icon="current?.id === filter.id ? 'mdi-check' : 'mdi-bookmark-outline'" size="small" />
          </template>
          <template #append>
            <v-btn
              icon="mdi-pencil"
              variant="text"
              size="x-small"
              :aria-label="`Rename ${filter.name}`"
              title="Rename"
              @click.stop="openDialog('rename', filter)"
            />
            <v-btn
              icon="mdi-delete-outline"
              variant="text"
              size="x-small"
              :aria-label="`Delete ${filter.name}`"
              title="Delete"
              @click.stop="openDialog('delete', filter)"
            />
          </template>
        </v-list-item>

        <v-divider class="my-1" />

        <v-list-item
          v-if="changedFrom"
          prepend-icon="mdi-content-save-edit-outline"
          :title="`Update “${changedFrom.name}”`"
          subtitle="Save the current filters under this name"
          :disabled="busy"
          @click="update(changedFrom)"
        />
        <v-list-item
          prepend-icon="mdi-content-save-outline"
          title="Save current filters…"
          :subtitle="filtered ? null : 'Set a filter or search first'"
          :disabled="!filtered || Boolean(current)"
          @click="openDialog('save')"
        />
      </v-list>
    </v-card>
  </v-menu>

  <v-dialog v-model="dialog.open" max-width="440">
    <v-card>
      <v-card-title>{{ dialogTitle }}</v-card-title>
      <v-card-text>
        <template v-if="dialog.mode === 'delete'">
          Delete the saved filter <strong>{{ dialog.target?.name }}</strong>? The list you are
          looking at stays as it is.
        </template>
        <template v-else>
          <v-text-field
            v-model="dialog.name"
            label="Name"
            autofocus
            counter="60"
            maxlength="60"
            :error-messages="dialog.error"
            :hint="replacing ? `Replaces your saved filter “${replacing.name}”` : ''"
            persistent-hint
            @update:model-value="dialog.error = ''"
            @keyup.enter="confirmDialog"
          />
          <div v-if="dialog.mode === 'save'" class="text-body-2 text-medium-emphasis mt-2">
            {{ describe(view) }}
          </div>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
        <v-btn
          :color="dialog.mode === 'delete' ? 'error' : 'primary'"
          variant="flat"
          :loading="busy"
          :disabled="dialog.mode !== 'delete' && !dialog.name.trim()"
          @click="confirmDialog"
        >
          {{ confirmLabel }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted } from 'vue'
import ActionButton from '@/components/common/ActionButton.vue'
import { useSavedFiltersStore } from '@/stores/savedFilters'
import { useNotificationsStore } from '@/stores/notifications'
import { isFiltered, sameFilterSet } from '@/models/device-view'

const props = defineProps({
  // The table's current view ({ filters, search, sortBy, page, itemsPerPage })
  view: { type: Object, required: true },
  // Turns a saved view into words for the list (filter labels need the table's options)
  describe: { type: Function, required: true }
})
// apply: the saved filter's view ({ filters, search, sortBy }); the table keeps its page size
const emit = defineEmits(['apply'])

const store = useSavedFiltersStore()
const notifications = useNotificationsStore()

const menu = ref(false)
const busy = ref(false)
const loadError = ref('')

const filtered = computed(() => isFiltered(props.view))
// The saved filter this list matches (filters, search and sort)
const current = computed(() => store.matching(props.view))

// The last saved filter picked or saved here; once the filters move away from
// it, "Update" offers to save the change under its name.
const lastUsedId = ref(null)
const changedFrom = computed(() => {
  if (current.value) return null
  const last = store.filters.find((f) => f.id === lastUsedId.value)
  return last && !sameFilterSet(last.view, props.view) ? last : null
})

const load = async () => {
  loadError.value = ''
  try {
    await store.ensureLoaded()
  } catch (err) {
    loadError.value = err.userMessage || err.message || 'Request failed'
  }
}
onMounted(load)
watch(menu, (open) => { if (open && loadError.value) load() })

const apply = (filter) => {
  lastUsedId.value = filter.id
  emit('apply', filter.view)
  menu.value = false
}

const update = async (filter) => {
  busy.value = true
  try {
    await store.overwrite(filter.id, props.view)
    notifications.showSuccess(`Updated saved filter “${filter.name}”`)
    menu.value = false
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not update the saved filter')
  } finally {
    busy.value = false
  }
}

// One dialog for save / rename / delete
const dialog = reactive({ open: false, mode: 'save', target: null, name: '', error: '' })

const openDialog = (mode, target = null) => {
  Object.assign(dialog, { open: true, mode, target, name: target?.name || '', error: '' })
  menu.value = false
}

// Saving under a name already in use replaces that filter (asked in the hint)
const replacing = computed(() => {
  if (dialog.mode !== 'save') return null
  const name = dialog.name.trim()
  return store.filters.find((f) => f.name === name) || null
})

const dialogTitle = computed(() => ({
  save: 'Save filters',
  rename: 'Rename saved filter',
  delete: 'Delete saved filter'
})[dialog.mode])

const confirmLabel = computed(() => {
  if (dialog.mode === 'delete') return 'Delete'
  if (dialog.mode === 'rename') return 'Rename'
  return replacing.value ? 'Replace' : 'Save'
})

const confirmDialog = async () => {
  if (busy.value) return
  const name = dialog.name.trim()
  if (dialog.mode !== 'delete' && !name) return
  busy.value = true
  try {
    if (dialog.mode === 'delete') {
      await store.remove(dialog.target.id)
      notifications.showSuccess(`Deleted saved filter “${dialog.target.name}”`)
    } else if (dialog.mode === 'rename') {
      if (name !== dialog.target.name) await store.rename(dialog.target.id, name)
    } else {
      const saved = replacing.value
        ? await store.overwrite(replacing.value.id, props.view)
        : await store.create(name, props.view)
      lastUsedId.value = saved.id
      notifications.showSuccess(`Saved filter “${saved.name}”`)
    }
    dialog.open = false
  } catch (err) {
    const message = err.userMessage || err.message || 'Request failed'
    if (dialog.mode === 'delete') notifications.showError(message)
    else dialog.error = message
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.saved-filters-list {
  max-height: 60vh;
  overflow-y: auto;
}
</style>
