<template>
  <div>
    <v-container fluid class="pa-4">
      <div class="d-flex align-center flex-wrap mb-4">
        <div>
          <h1 class="text-h4 font-weight-bold">Users</h1>
          <p class="text-body-2 text-medium-emphasis mb-0">
            Who can sign in, and what they can do. There is no self-signup: accounts are created here.
          </p>
        </div>
        <v-spacer />
        <v-btn color="primary" prepend-icon="mdi-account-plus" @click="openCreate">Add user</v-btn>
      </div>

      <v-card>
        <v-data-table
          :headers="shownHeaders"
          :items="usersStore.users"
          :loading="usersStore.loading"
          item-value="id"
          :items-per-page="25"
        >
          <template #item.name="{ item }">
            {{ item.name }}
            <v-chip v-if="item.id === authStore.user?.id" size="x-small" class="ml-2" label>You</v-chip>
          </template>
          <template #item.role="{ item }">
            <v-chip :color="roleColor(item.role)" size="small" variant="tonal" label>{{ roleLabel(item.role) }}</v-chip>
          </template>
          <template #item.lastLogin="{ item }">
            {{ item.lastLogin ? formatDate(item.lastLogin) : 'Never' }}
          </template>
          <template #item.createdAt="{ item }">
            {{ formatDate(item.createdAt) }}
          </template>
          <template #item.actions="{ item }">
            <v-btn icon="mdi-pencil" size="small" variant="text" title="Edit" @click="openEdit(item)" />
            <v-btn icon="mdi-lock-reset" size="small" variant="text" title="Reset password" @click="openReset(item)" />
            <v-btn
              icon="mdi-delete"
              size="small"
              variant="text"
              color="error"
              title="Delete"
              :disabled="item.id === authStore.user?.id"
              @click="openDelete(item)"
            />
          </template>
        </v-data-table>
      </v-card>

      <v-card variant="tonal" class="mt-4">
        <v-card-text class="text-body-2">
          <strong>Roles.</strong>
          Viewers see inventory, status, and backup history.
          Operators can also add and edit devices and their credentials, run discovery, backups, and connection tests, and view backup contents.
          Admins can also manage users, cloud integrations, the Git mirror, and delete records.
        </v-card-text>
      </v-card>
    </v-container>

    <!-- Create / edit -->
    <v-dialog v-model="editDialog" max-width="480" persistent>
      <v-card>
        <v-card-title>{{ editing ? 'Edit user' : 'Add user' }}</v-card-title>
        <v-card-text>
          <v-form ref="editForm" @submit.prevent="saveUser">
            <v-text-field
              v-model="form.email"
              label="Email"
              type="email"
              :disabled="!!editing"
              :rules="editing ? [] : [rules.required, rules.email]"
              autocomplete="off"
            />
            <v-text-field v-model="form.name" label="Full name" :rules="[rules.required, rules.name]" />
            <v-select
              v-model="form.role"
              :items="roleItems"
              label="Role"
              :disabled="editing?.id === authStore.user?.id"
              :hint="editing?.id === authStore.user?.id ? 'You cannot change your own role' : ''"
              persistent-hint
            />
            <v-text-field
              v-if="!editing"
              v-model="form.password"
              label="Initial password"
              :type="showPassword ? 'text' : 'password'"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              :rules="[rules.required, rules.password]"
              hint="At least 12 characters. Share it with the user securely; they can change it after signing in."
              persistent-hint
              autocomplete="new-password"
              @click:append-inner="showPassword = !showPassword"
            />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="saveUser">{{ editing ? 'Save' : 'Create' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Reset password -->
    <v-dialog v-model="resetDialog" max-width="480" persistent>
      <v-card>
        <v-card-title>Reset password</v-card-title>
        <v-card-text>
          <p class="mb-4">
            Set a new password for <strong>{{ target?.email }}</strong>. They will be signed out of their current sessions.
          </p>
          <v-form ref="resetForm" @submit.prevent="doReset">
            <v-text-field
              v-model="resetPassword"
              label="New password"
              :type="showPassword ? 'text' : 'password'"
              :append-inner-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
              :rules="[rules.required, rules.password]"
              autocomplete="new-password"
              @click:append-inner="showPassword = !showPassword"
            />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="doReset">Reset</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete -->
    <v-dialog v-model="deleteDialog" max-width="480">
      <v-card>
        <v-card-title>Delete user</v-card-title>
        <v-card-text>
          Delete <strong>{{ target?.email }}</strong>? They can no longer sign in.
          Cloud integrations, credentials, and other shared settings they created are kept and transferred to you.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" :loading="saving" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useUsersStore } from '@/stores/users'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { apiErrorMessage } from '@/utils/apiError'
import { usePhoneColumns } from '@/composables/usePhoneColumns'

const usersStore = useUsersStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()

const headers = [
  { title: 'Name', key: 'name' },
  { title: 'Email', key: 'email' },
  { title: 'Role', key: 'role' },
  { title: 'Last sign-in', key: 'lastLogin' },
  { title: 'Created', key: 'createdAt' },
  { title: '', key: 'actions', sortable: false, align: 'end' }
]
const shownHeaders = usePhoneColumns(headers, ['name', 'email', 'role', 'actions'])

const ROLES = {
  admin: { label: 'Admin', color: 'error' },
  operator: { label: 'Operator', color: 'warning' },
  viewer: { label: 'Viewer', color: 'info' }
}
const roleItems = Object.entries(ROLES).map(([value, r]) => ({ value, title: r.label }))
const roleLabel = (role) => ROLES[role]?.label || role
const roleColor = (role) => ROLES[role]?.color || 'grey'
const formatDate = (value) => new Date(value).toLocaleString()

const rules = {
  required: (v) => !!(v && String(v).trim()) || 'Required',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Enter a valid email',
  name: (v) => (v && v.trim().length >= 2) || 'At least 2 characters',
  password: (v) => (v && v.length >= 12) || 'At least 12 characters'
}

const saving = ref(false)
const showPassword = ref(false)
const target = ref(null)

const editDialog = ref(false)
const editForm = ref(null)
const editing = ref(null)
const form = ref({})

const resetDialog = ref(false)
const resetForm = ref(null)
const resetPassword = ref('')

const deleteDialog = ref(false)

function openCreate () {
  editing.value = null
  form.value = { email: '', name: '', role: 'viewer', password: '' }
  showPassword.value = false
  editDialog.value = true
}

function openEdit (user) {
  editing.value = user
  form.value = { email: user.email, name: user.name, role: user.role }
  editDialog.value = true
}

function openReset (user) {
  target.value = user
  resetPassword.value = ''
  showPassword.value = false
  resetDialog.value = true
}

function openDelete (user) {
  target.value = user
  deleteDialog.value = true
}

// Wrap a mutation: spinner, success toast, server's message on failure.
async function run (action, successMessage) {
  saving.value = true
  try {
    await action()
    if (successMessage) notifications.showSuccess(successMessage)
    return true
  } catch (error) {
    notifications.showError(apiErrorMessage(error))
    return false
  } finally {
    saving.value = false
  }
}

async function saveUser () {
  const { valid } = await editForm.value.validate()
  if (!valid) return
  const ok = editing.value
    ? await run(() => usersStore.updateUser(editing.value.id, { name: form.value.name, role: form.value.role }), 'User updated')
    : await run(() => usersStore.createUser({ ...form.value, email: form.value.email.trim() }), `Created ${form.value.email}`)
  if (ok) editDialog.value = false
}

async function doReset () {
  const { valid } = await resetForm.value.validate()
  if (!valid) return
  if (await run(() => usersStore.resetPassword(target.value.id, resetPassword.value), `Password reset for ${target.value.email}`)) {
    resetDialog.value = false
  }
}

async function doDelete () {
  let reassigned = {}
  const ok = await run(async () => { reassigned = await usersStore.deleteUser(target.value.id) })
  if (!ok) return
  const moved = Object.values(reassigned).reduce((a, b) => a + b, 0)
  notifications.showSuccess(`Deleted ${target.value.email}` + (moved ? `; ${moved} shared record(s) transferred to you` : ''))
  deleteDialog.value = false
}

onMounted(() => {
  usersStore.fetchUsers().catch((error) => notifications.showError(apiErrorMessage(error)))
})
</script>
