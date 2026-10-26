<template>
  <div class="automations-view">
    <!-- Header Section -->
    <div class="automations-header">
      <v-container fluid>
        <div class="d-flex flex-wrap align-center justify-space-between ga-2 mb-4">
          <div>
            <h1 class="text-h4 font-weight-bold mb-1">
              Automations
              <v-chip size="small" color="warning" variant="tonal" label class="ml-2 align-middle">Experimental</v-chip>
            </h1>
            <p class="text-body-1 text-medium-emphasis">
              Create and manage your network automation workflows
            </p>
          </div>
          
          <div class="d-flex flex-wrap ga-2">
            <v-btn
              variant="outlined"
              prepend-icon="mdi-history"
              size="large"
              to="/automations/executions"
            >
              Run History
            </v-btn>
            <v-btn
              color="primary"
              prepend-icon="mdi-plus"
              size="large"
              @click="createNewAutomation"
            >
              Create Automation
            </v-btn>
          </div>
        </div>
        
        <!-- Stats Cards -->
        <v-row class="mb-4">
          <v-col cols="6" md="3">
            <v-card class="stats-card">
              <v-card-text>
                <div class="d-flex align-center">
                  <v-icon color="primary" size="40" class="mr-3 d-none d-sm-flex">mdi-robot</v-icon>
                  <div>
                    <p class="text-h4 font-weight-bold mb-0">{{ stats.total }}</p>
                    <p class="text-body-2 text-medium-emphasis mb-0">Total Automations</p>
                  </div>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
          
          <v-col cols="6" md="3">
            <v-card class="stats-card">
              <v-card-text>
                <div class="d-flex align-center">
                  <v-icon color="success" size="40" class="mr-3 d-none d-sm-flex">mdi-play-circle</v-icon>
                  <div>
                    <p class="text-h4 font-weight-bold mb-0">{{ stats.active }}</p>
                    <p class="text-body-2 text-medium-emphasis mb-0">Active</p>
                  </div>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
          
          <v-col cols="6" md="3">
            <v-card class="stats-card">
              <v-card-text>
                <div class="d-flex align-center">
                  <v-icon color="warning" size="40" class="mr-3 d-none d-sm-flex">mdi-pause-circle</v-icon>
                  <div>
                    <p class="text-h4 font-weight-bold mb-0">{{ stats.inactive }}</p>
                    <p class="text-body-2 text-medium-emphasis mb-0">Inactive</p>
                  </div>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
          
          <v-col cols="6" md="3">
            <v-card class="stats-card">
              <v-card-text>
                <div class="d-flex align-center">
                  <v-icon color="info" size="40" class="mr-3 d-none d-sm-flex">mdi-calendar-clock</v-icon>
                  <div>
                    <p class="text-h4 font-weight-bold mb-0">{{ stats.scheduled }}</p>
                    <p class="text-body-2 text-medium-emphasis mb-0">Scheduled</p>
                  </div>
                </div>
              </v-card-text>
            </v-card>
          </v-col>
        </v-row>
      </v-container>
    </div>

    <!-- Filters and Search -->
    <div class="automations-filters">
      <v-container fluid>
        <v-card class="mb-4">
          <v-card-text>
            <v-row align="center">
              <v-col cols="12" md="4">
                <v-text-field
                  v-model="searchQuery"
                  prepend-inner-icon="mdi-magnify"
                  label="Search automations"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                />
              </v-col>
              
              <v-col cols="12" md="3">
                <v-select
                  v-model="statusFilter"
                  :items="statusOptions"
                  label="Status"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                />
              </v-col>
              
              <v-col cols="12" md="3">
                <v-select
                  v-model="categoryFilter"
                  :items="categoryOptions"
                  label="Category"
                  variant="outlined"
                  density="compact"
                  hide-details
                  clearable
                />
              </v-col>
              
              <v-col cols="12" md="2">
                <v-select
                  v-model="sortBy"
                  :items="sortOptions"
                  label="Sort by"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-container>
    </div>

    <!-- Automations List -->
    <div class="automations-content">
      <v-container fluid>
        <v-card>
          <v-card-text class="pa-0">
            <!-- Loading -->
            <div v-if="loading" class="text-center pa-8">
              <v-progress-circular
                indeterminate
                color="primary"
                size="64"
              />
              <p class="text-body-1 mt-4">Loading automations...</p>
            </div>
            
            <!-- Empty State -->
            <div v-else-if="filteredAutomations.length === 0" class="empty-state pa-8 text-center">
              <v-icon size="80" color="grey-lighten-2" class="mb-4">
                mdi-robot-outline
              </v-icon>
              <h3 class="text-h6 mb-2">No automations found</h3>
              <p class="text-body-2 text-medium-emphasis mb-4">
                {{ searchQuery ? 'Try adjusting your search criteria.' : 'Get started by creating your first automation workflow.' }}
              </p>
              <v-btn
                v-if="!searchQuery"
                color="primary"
                prepend-icon="mdi-plus"
                @click="createNewAutomation"
              >
                Create First Automation
              </v-btn>
            </div>
            
            <!-- Automations Table -->
            <v-data-table
              v-else
              :headers="tableHeaders"
              :items="filteredAutomations"
              :loading="loading"
              :items-per-page="itemsPerPage"
              :search="searchQuery"
              class="automations-table"
              @click:row="handleRowClick"
            >
              <!-- Name column -->
              <template #item.name="{ item }">
                <div class="d-flex align-center">
                  <v-avatar
                    :color="getAutomationColor(item)"
                    size="32"
                    class="mr-3"
                  >
                    <v-icon color="white" size="18">
                      {{ getAutomationIcon(item) }}
                    </v-icon>
                  </v-avatar>
                  
                  <div>
                    <div class="font-weight-medium">{{ item.name }}</div>
                    <div class="text-caption text-medium-emphasis">
                      {{ item.description || 'No description' }}
                    </div>
                  </div>
                </div>
              </template>
              
              <!-- Status column -->
              <template #item.status="{ item }">
                <v-chip
                  :color="item.active ? 'success' : 'grey'"
                  variant="flat"
                  size="small"
                >
                  <v-icon start size="small">
                    {{ item.active ? 'mdi-check-circle' : 'mdi-pause-circle' }}
                  </v-icon>
                  {{ item.active ? 'Active' : 'Inactive' }}
                </v-chip>
              </template>
              
              <!-- Category column -->
              <template #item.category="{ item }">
                <v-chip
                  variant="outlined"
                  size="small"
                  :color="getCategoryColor(item.category)"
                >
                  {{ item.category || 'Uncategorized' }}
                </v-chip>
              </template>
              
              <!-- Last run column -->
              <template #item.lastRun="{ item }">
                <div v-if="item.lastRun">
                  <div class="text-body-2">{{ formatDate(item.lastRun) }}</div>
                  <div class="text-caption text-medium-emphasis">
                    {{ formatTimeAgo(item.lastRun) }}
                  </div>
                </div>
                <span v-else class="text-medium-emphasis">Never</span>
                <div v-if="item.active && item.schedules?.[0]?.nextRun" class="text-caption text-medium-emphasis">
                  <v-icon size="x-small">mdi-clock-outline</v-icon>
                  next {{ formatDate(item.schedules[0].nextRun) }}
                </div>
              </template>
              
              <!-- Actions column -->
              <template #item.actions="{ item }">
                <div class="d-flex align-center ga-1">
                  <!-- Toggle Status -->
                  <v-btn
                    :icon="item.active ? 'mdi-pause' : 'mdi-play'"
                    size="small"
                    variant="text"
                    :color="item.active ? 'warning' : 'success'"
                    :title="item.active ? 'Pause Automation' : 'Start Automation'"
                    @click.stop="toggleAutomationStatus(item)"
                  />
                  
                  <!-- Run Now -->
                  <v-btn
                    icon="mdi-play-circle"
                    size="small"
                    variant="text"
                    color="primary"
                    title="Run Now"
                    @click.stop="executeAutomation(item)"
                  />

                  <!-- Run history -->
                  <v-btn
                    icon="mdi-history"
                    size="small"
                    variant="text"
                    title="Run History"
                    :to="{ path: '/automations/executions', query: { automationId: item.id } }"
                    @click.stop
                  />
                  
                  <!-- Edit -->
                  <v-btn
                    icon="mdi-pencil"
                    size="small"
                    variant="text"
                    color="primary"
                    title="Edit Automation"
                    @click.stop="editAutomation(item)"
                  />
                  
                  <!-- More actions -->
                  <v-menu>
                    <template #activator="{ props }">
                      <v-btn
                        icon="mdi-dots-vertical"
                        size="small"
                        variant="text"
                        v-bind="props"
                        @click.stop
                      />
                    </template>
                    
                    <v-list>
                      <v-list-item
                        prepend-icon="mdi-content-duplicate"
                        title="Duplicate"
                        @click="duplicateAutomation(item)"
                      />
                      <v-list-item
                        prepend-icon="mdi-export"
                        title="Export"
                        @click="exportAutomation(item)"
                      />
                      <v-divider />
                      <v-list-item
                        prepend-icon="mdi-delete"
                        title="Delete"
                        class="text-error"
                        @click="showDeleteDialog(item)"
                      />
                    </v-list>
                  </v-menu>
                </div>
              </template>
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-container>
    </div>
    
    <!-- Delete Confirmation Dialog -->
    <v-dialog v-model="deleteDialog.show" max-width="500px">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="error" class="mr-2">mdi-delete-alert</v-icon>
          Confirm Delete
        </v-card-title>
        
        <v-card-text>
          <p>Are you sure you want to delete the automation <strong>"{{ deleteDialog.automation?.name }}"</strong>?</p>
          <p class="text-error">This action cannot be undone.</p>
          
          <v-alert
            v-if="deleteDialog.automation?.active"
            type="warning"
            variant="tonal"
            class="mt-4"
          >
            This automation is currently active and may be running scheduled tasks.
          </v-alert>
        </v-card-text>
        
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="deleteDialog.show = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="error"
            :loading="deleteDialog.loading"
            @click="confirmDelete"
          >
            Delete
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Snackbar for notifications -->
    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      :timeout="snackbar.timeout"
      location="bottom right"
    >
      {{ snackbar.message }}
      <template #actions>
        <v-btn
          icon="mdi-close"
          variant="text"
          @click="snackbar.show = false"
        >
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAutomationsStore } from '@/stores/automations'
import { apiErrorMessage } from '@/utils/apiError'
import { formatDistanceToNow, format } from 'date-fns'

const router = useRouter()
const automationsStore = useAutomationsStore()

// Component state
const searchQuery = ref('')
const statusFilter = ref(null)
const categoryFilter = ref(null)
const sortBy = ref('updated')
const itemsPerPage = ref(10)

const deleteDialog = ref({
  show: false,
  automation: null,
  loading: false
})

const snackbar = ref({
  show: false,
  message: '',
  color: 'success',
  timeout: 4000
})

// Computed properties
// storeToRefs keeps these reactive (a plain destructure copies the values once)
const { automations, loading, stats } = storeToRefs(automationsStore)
const filteredAutomations = computed(() => {
  let filtered = automations.value

  if (searchQuery.value) {
    filtered = automationsStore.searchAutomations(searchQuery.value)
  }

  if (statusFilter.value !== null) {
    filtered = filtered.filter(automation => 
      statusFilter.value === 'active' ? automation.active : !automation.active
    )
  }

  if (categoryFilter.value) {
    filtered = filtered.filter(automation => automation.category === categoryFilter.value)
  }

  // Sort
  filtered = [...filtered].sort((a, b) => {
    switch (sortBy.value) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'created':
        return new Date(b.createdAt) - new Date(a.createdAt)
      case 'updated':
        return new Date(b.updatedAt) - new Date(a.updatedAt)
      case 'lastRun':
        if (!a.lastRun && !b.lastRun) return 0
        if (!a.lastRun) return 1
        if (!b.lastRun) return -1
        return new Date(b.lastRun) - new Date(a.lastRun)
      default:
        return 0
    }
  })

  return filtered
})

// Table configuration
const tableHeaders = [
  { title: 'Name', key: 'name', sortable: false },
  { title: 'Status', key: 'status', sortable: false },
  { title: 'Category', key: 'category', sortable: false },
  { title: 'Last Run', key: 'lastRun', sortable: false },
  { title: 'Actions', key: 'actions', sortable: false, width: 200 }
]

// Filter options
const statusOptions = [
  { title: 'Active', value: 'active' },
  { title: 'Inactive', value: 'inactive' }
]

const categoryOptions = [
  { title: 'Network Operations', value: 'network' },
  { title: 'Security', value: 'security' },
  { title: 'Monitoring', value: 'monitoring' },
  { title: 'Maintenance', value: 'maintenance' },
  { title: 'Compliance', value: 'compliance' }
]

const sortOptions = [
  { title: 'Recently Updated', value: 'updated' },
  { title: 'Recently Created', value: 'created' },
  { title: 'Name', value: 'name' },
  { title: 'Last Run', value: 'lastRun' }
]

// Methods
const createNewAutomation = () => {
  router.push('/automations/builder')
}

const handleRowClick = (event, { item }) => {
  editAutomation(item)
}

const editAutomation = (automation) => {
  router.push(`/automations/builder/${automation.id}`)
}

const toggleAutomationStatus = async (automation) => {
  try {
    await automationsStore.toggleAutomationStatus(automation.id)
    showSnackbar(
      `Automation ${automation.active ? 'paused' : 'activated'} successfully`,
      'success'
    )
  } catch (error) {
    showSnackbar(apiErrorMessage(error), 'error')
  }
}

const executeAutomation = async (automation) => {
  try {
    await automationsStore.executeAutomation(automation.id)
    showSnackbar(`Automation "${automation.name}" execution started`, 'info')
  } catch (error) {
    showSnackbar(apiErrorMessage(error), 'error')
  }
}

const duplicateAutomation = async (automation) => {
  try {
    const duplicateData = {
      ...automation,
      name: `${automation.name} (Copy)`,
      active: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
    delete duplicateData.id
    
    await automationsStore.createAutomation(duplicateData)
    showSnackbar('Automation duplicated successfully', 'success')
  } catch (error) {
    showSnackbar('Failed to duplicate automation', 'error')
  }
}

const exportAutomation = (automation) => {
  const exportData = {
    name: automation.name,
    description: automation.description,
    category: automation.category,
    elements: automation.elements,
    metadata: automation.metadata
  }
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json'
  })
  
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${automation.name}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  
  showSnackbar('Automation exported successfully', 'success')
}

const showDeleteDialog = (automation) => {
  deleteDialog.value = {
    show: true,
    automation,
    loading: false
  }
}

const confirmDelete = async () => {
  if (!deleteDialog.value.automation) return
  
  deleteDialog.value.loading = true
  
  try {
    await automationsStore.deleteAutomation(deleteDialog.value.automation.id)
    showSnackbar('Automation deleted successfully', 'success')
    deleteDialog.value.show = false
  } catch (error) {
    showSnackbar('Failed to delete automation', 'error')
  } finally {
    deleteDialog.value.loading = false
  }
}

const getAutomationColor = (automation) => {
  const colors = {
    network: 'blue',
    security: 'red',
    monitoring: 'green',
    maintenance: 'orange',
    compliance: 'purple'
  }
  return colors[automation.category] || 'grey'
}

const getAutomationIcon = (automation) => {
  const icons = {
    network: 'mdi-network',
    security: 'mdi-shield',
    monitoring: 'mdi-chart-line',
    maintenance: 'mdi-wrench',
    compliance: 'mdi-clipboard-check'
  }
  return icons[automation.category] || 'mdi-robot'
}

const getCategoryColor = (category) => {
  const colors = {
    network: 'blue',
    security: 'red', 
    monitoring: 'green',
    maintenance: 'orange',
    compliance: 'purple'
  }
  return colors[category] || 'grey'
}

const formatDate = (date) => {
  return format(new Date(date), 'MMM d, yyyy HH:mm')
}

const formatTimeAgo = (date) => {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

const showSnackbar = (message, color = 'success') => {
  snackbar.value = {
    show: true,
    message,
    color,
    timeout: 4000
  }
}

// Lifecycle
onMounted(async () => {
  try {
    await automationsStore.fetchAutomations()
  } catch (error) {
    console.error('Failed to load automations:', error)
    showSnackbar('Failed to load automations', 'error')
  }
})
</script>

<style scoped>
.automations-view {
  background-color: rgb(var(--v-theme-background));
  min-height: 100vh;
}

.automations-header {
  background: rgb(var(--v-theme-surface));
  padding: 24px 0;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.stats-card {
  height: 100%;
  border-left: 4px solid currentColor;
}

.automations-filters {
  padding: 16px 0;
}

.automations-content {
  padding-bottom: 32px;
}

.automations-table :deep(.v-data-table__tr) {
  cursor: pointer;
}

.automations-table :deep(.v-data-table__tr:hover) {
  background-color: rgba(var(--v-theme-on-surface), 0.03);
}

.empty-state {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

/* Style the snackbar action button to be bold and match notification text color */
.snackbar-action-btn {
  font-weight: bold !important;
  opacity: 1 !important;
}
</style>
