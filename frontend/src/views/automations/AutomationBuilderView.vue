<template>
  <div class="automation-builder">
    <!-- Header Section -->
    <div class="builder-header">
      <v-container fluid class="pa-4">
        <div class="d-flex align-center justify-space-between mb-4">
          <div class="d-flex align-center">
            <v-btn 
              variant="text" 
              icon="mdi-arrow-left"
              @click="handleBack"
              class="mr-2"
            />
            <div>
              <h1 class="text-h5 font-weight-bold mb-1">
                {{ isEditing ? 'Edit Automation' : 'Create Automation' }}
              </h1>
              <p class="text-body-2 text-medium-emphasis mb-0">
                {{ workflowMetadata.name || 'Untitled Workflow' }}
              </p>
            </div>
          </div>
          
          <div class="d-flex align-center ga-2">
            <!-- Workflow Status -->
            <v-chip 
              :color="workflowStatusColor" 
              size="small" 
              variant="flat"
            >
              <v-icon start size="small">
                {{ workflowStatusIcon }}
              </v-icon>
              {{ workflowStatus }}
            </v-chip>
            
            <!-- Action Buttons -->
            <v-btn
              variant="outlined"
              prepend-icon="mdi-play"
              @click="testWorkflow"
              :disabled="!canTestWorkflow"
            >
              Test
            </v-btn>
            
            <v-btn
              variant="outlined"
              prepend-icon="mdi-content-save"
              @click="saveWorkflow"
              :loading="saving"
            >
              Save
            </v-btn>
            
            <v-btn
              color="primary"
              prepend-icon="mdi-rocket-launch"
              @click="deployWorkflow"
              :disabled="!canDeployWorkflow"
              :loading="deploying"
            >
              Deploy
            </v-btn>
            
            <v-menu>
              <template v-slot:activator="{ props }">
                <v-btn
                  variant="outlined"
                  icon="mdi-dots-vertical"
                  v-bind="props"
                />
              </template>
              <v-list>
                <v-list-item
                  prepend-icon="mdi-import"
                  title="Import Workflow"
                  @click="importDialog = true"
                />
                <v-list-item
                  prepend-icon="mdi-export"
                  title="Export Workflow"
                  @click="exportWorkflow"
                />
                <v-divider></v-divider>
                <v-list-item
                  prepend-icon="mdi-cog"
                  title="Workflow Settings"
                  @click="settingsDialog = true"
                />
                <v-list-item
                  prepend-icon="mdi-help-circle"
                  title="Help"
                  @click="helpDialog = true"
                />
              </v-list>
            </v-menu>
          </div>
        </div>
        
        <!-- Toolbar -->
        <div class="builder-toolbar d-flex align-center justify-space-between">
          <div class="d-flex align-center ga-2">
            <v-btn
              variant="outlined"
              size="small"
              prepend-icon="mdi-undo"
              @click="undo"
              :disabled="!canUndo"
            >
              Undo
            </v-btn>
            
            <v-btn
              variant="outlined"
              size="small"
              prepend-icon="mdi-redo"
              @click="redo"
              :disabled="!canRedo"
            >
              Redo
            </v-btn>
            
            <v-divider vertical class="mx-2"></v-divider>
            
            <v-btn
              variant="outlined"
              size="small"
              prepend-icon="mdi-fit-to-screen"
              @click="resetView"
            >
              Fit View
            </v-btn>
            
            <v-btn
              variant="outlined"
              size="small"
              prepend-icon="mdi-auto-fix"
              @click="autoLayout"
            >
              Auto Layout
            </v-btn>
          </div>
          
          <div class="d-flex align-center ga-2">
            <!-- Validation Status -->
            <div v-if="validationResult" class="d-flex align-center ga-2">
              <v-icon 
                :color="validationResult.isValid ? 'success' : 'error'" 
                size="small"
              >
                {{ validationResult.isValid ? 'mdi-check-circle' : 'mdi-alert-circle' }}
              </v-icon>
              
              <span class="text-caption">
                {{ validationResult.isValid ? 'Valid' : `${validationResult.errors.length} errors` }}
              </span>
              
              <v-btn
                v-if="!validationResult.isValid || validationResult.warnings.length > 0"
                variant="text"
                size="small"
                @click="showValidationDialog = true"
              >
                Details
              </v-btn>
            </div>
            
            <v-btn
              variant="outlined"
              size="small"
              :prepend-icon="toolbarCollapsed ? 'mdi-chevron-left' : 'mdi-chevron-right'"
              @click="toolbarCollapsed = !toolbarCollapsed"
            >
              {{ toolbarCollapsed ? 'Show' : 'Hide' }} Palette
            </v-btn>
          </div>
        </div>
      </v-container>
    </div>
    
    <!-- Builder Content -->
    <div class="builder-content">
      <!-- Node Palette -->
      <div v-if="!toolbarCollapsed" class="node-palette">
        <NodeToolbar 
          :collapsed="toolbarCollapsed"
          @add-node="addNodeToCanvas"
          @toggle-collapse="toolbarCollapsed = !toolbarCollapsed"
        />
      </div>
      
      <!-- Workflow Canvas -->
      <div class="workflow-canvas-container">
        <WorkflowCanvas
          ref="canvas"
          :initial-elements="workflowElements"
          @elements-change="onElementsChange"
          @node-configure="onNodeConfigure"
          @node-select="onNodeSelect"
          @edge-select="onEdgeSelect"
          @selection-change="onSelectionChange"
        />
      </div>
      
      <!-- Properties Panel -->
      <div v-if="selectedElement" class="properties-panel">
        <v-card class="properties-card" elevation="4">
          <v-card-title class="text-h6 py-3">
            <v-icon class="mr-2" color="primary">mdi-information</v-icon>
            Properties
          </v-card-title>
          
          <v-divider></v-divider>
          
          <v-card-text class="pa-4">
            <!-- Node Properties -->
            <div v-if="selectedElement.type">
              <div class="text-subtitle-2 mb-2">Node Information</div>
              <div class="mb-2">
                <strong>Type:</strong> {{ selectedElement.type }}
              </div>
              <div class="mb-2">
                <strong>ID:</strong> {{ selectedElement.id }}
              </div>
              <div class="mb-2">
                <strong>Position:</strong> 
                {{ Math.round(selectedElement.position?.x || 0) }}, 
                {{ Math.round(selectedElement.position?.y || 0) }}
              </div>
              
              <v-divider class="my-4"></v-divider>
              
              <div class="text-subtitle-2 mb-2">Configuration</div>
              <div v-if="selectedElement.data" class="configuration-info">
                <pre class="text-caption">{{ JSON.stringify(selectedElement.data, null, 2) }}</pre>
              </div>
              
              <v-btn
                variant="outlined"
                size="small"
                prepend-icon="mdi-cog"
                @click="configureSelectedNode"
                class="mt-3"
                block
              >
                Configure Node
              </v-btn>
            </div>
            
            <!-- Edge Properties -->
            <div v-else>
              <div class="text-subtitle-2 mb-2">Connection Information</div>
              <div class="mb-2">
                <strong>From:</strong> {{ selectedElement.source }}
              </div>
              <div class="mb-2">
                <strong>To:</strong> {{ selectedElement.target }}
              </div>
              <div class="mb-2">
                <strong>Label:</strong> {{ selectedElement.label || 'None' }}
              </div>
            </div>
          </v-card-text>
        </v-card>
      </div>
    </div>
    
    <!-- Node Configuration Dialog -->
    <NodeConfigDialog
      v-model="configDialog"
      :node="selectedNode"
      @save="onNodeSave"
      @test="onNodeTest"
    />
    
    <!-- Workflow Settings Dialog -->
    <v-dialog v-model="settingsDialog" max-width="600px">
      <v-card>
        <v-card-title>Workflow Settings</v-card-title>
        
        <v-card-text>
          <v-text-field
            v-model="workflowMetadata.name"
            label="Workflow Name"
            variant="outlined"
            required
          />
          
          <v-textarea
            v-model="workflowMetadata.description"
            label="Description"
            variant="outlined"
            rows="3"
          />
          
          <v-select
            v-model="workflowMetadata.category"
            label="Category"
            :items="workflowCategories"
            variant="outlined"
          />
          
          <v-select
            v-model="workflowMetadata.priority"
            label="Priority"
            :items="priorityOptions"
            variant="outlined"
          />
          
          <v-checkbox
            v-model="workflowMetadata.enabled"
            label="Enable workflow"
          />
        </v-card-text>
        
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="settingsDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="saveSettings">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Validation Dialog -->
    <v-dialog v-model="showValidationDialog" max-width="500px">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon 
            :color="validationResult?.isValid ? 'success' : 'error'" 
            class="mr-2"
          >
            {{ validationResult?.isValid ? 'mdi-check-circle' : 'mdi-alert-circle' }}
          </v-icon>
          Workflow Validation
        </v-card-title>
        
        <v-card-text>
          <div v-if="validationResult?.errors.length > 0">
            <h4 class="text-error mb-2">Errors:</h4>
            <ul>
              <li v-for="error in validationResult.errors" :key="error" class="text-error">
                {{ error }}
              </li>
            </ul>
          </div>
          
          <div v-if="validationResult?.warnings.length > 0" class="mt-4">
            <h4 class="text-warning mb-2">Warnings:</h4>
            <ul>
              <li v-for="warning in validationResult.warnings" :key="warning" class="text-warning">
                {{ warning }}
              </li>
            </ul>
          </div>
          
          <div v-if="validationResult?.isValid && validationResult?.warnings.length === 0">
            <p class="text-success"> Your workflow is valid and ready to deploy!</p>
          </div>
        </v-card-text>
        
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="showValidationDialog = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Import Dialog -->
    <v-dialog v-model="importDialog" max-width="500px">
      <v-card>
        <v-card-title>Import Workflow</v-card-title>
        
        <v-card-text>
          <v-file-input
            v-model="importFile"
            label="Select workflow file"
            accept=".json"
            variant="outlined"
          />
          
          <v-textarea
            v-model="importJson"
            label="Or paste JSON here"
            variant="outlined"
            rows="8"
            placeholder='{
  "nodes": [...],
  "edges": [...]
}'
          />
        </v-card-text>
        
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="importDialog = false">Cancel</v-btn>
          <v-btn color="primary" @click="handleImport">Import</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    
    <!-- Help Dialog -->
    <v-dialog v-model="helpDialog" max-width="600px">
      <v-card>
        <v-card-title>Workflow Builder Help</v-card-title>
        
        <v-card-text>
          <div class="help-content">
            <h3>Getting Started</h3>
            <p>Build your automation workflow by dragging nodes from the palette onto the canvas and connecting them.</p>
            
            <h3>Node Types</h3>
            <ul>
              <li><strong>Triggers:</strong> Start your workflow (device events, schedules, etc.)</li>
              <li><strong>Conditions:</strong> Add logic and decision points</li>
              <li><strong>Actions:</strong> Perform network operations</li>
              <li><strong>Notifications:</strong> Send alerts and messages</li>
            </ul>
            
            <h3>Keyboard Shortcuts</h3>
            <ul>
              <li><strong>Ctrl+Z:</strong> Undo</li>
              <li><strong>Ctrl+Y:</strong> Redo</li>
              <li><strong>Delete:</strong> Delete selected elements</li>
              <li><strong>Ctrl+S:</strong> Save workflow</li>
            </ul>
          </div>
        </v-card-text>
        
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn @click="helpDialog = false">Close</v-btn>
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
      <template v-slot:actions>
        <v-btn 
          variant="text" 
          @click="snackbar.show = false"
        >
          Close
        </v-btn>
      </template>
    </v-snackbar>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { validateWorkflow, exportWorkflowToJSON, importWorkflowFromJSON } from '@/utils/layoutUtils'
import { useAutomationsStore } from '@/stores/automations'
import WorkflowCanvas from '@/components/automations/WorkflowCanvas.vue'
import NodeToolbar from '@/components/automations/NodeToolbar.vue'
import NodeConfigDialog from '@/components/automations/NodeConfigDialog.vue'

const router = useRouter()
const route = useRoute()
const automationsStore = useAutomationsStore()

// Component state
const canvas = ref(null)
const workflowElements = ref([])
const selectedElement = ref(null)
const selectedNode = ref(null)
const configDialog = ref(false)
const settingsDialog = ref(false)
const importDialog = ref(false)
const helpDialog = ref(false)
const showValidationDialog = ref(false)
const toolbarCollapsed = ref(false)
const saving = ref(false)
const deploying = ref(false)
const importFile = ref(null)
const importJson = ref('')

// Workflow metadata
const workflowId = ref(route.params.id || null)
const workflowMetadata = ref({
  name: 'Untitled Workflow',
  description: '',
  category: 'network',
  priority: 'medium',
  enabled: true,
  active: false,
  created: new Date().toISOString(),
  modified: new Date().toISOString()
})

// History for undo/redo
const history = ref([])
const historyIndex = ref(-1)
const maxHistorySize = 50

// Snackbar
const snackbar = ref({
  show: false,
  message: '',
  color: 'success',
  timeout: 4000
})

// Computed properties
const isEditing = computed(() => !!route.params.id)

const workflowStatus = computed(() => {
  if (workflowElements.value.length === 0) return 'Empty'
  if (!validationResult.value?.isValid) return 'Invalid'
  if (workflowMetadata.value.enabled) return 'Active'
  return 'Draft'
})

const workflowStatusColor = computed(() => {
  switch (workflowStatus.value) {
    case 'Active': return 'success'
    case 'Invalid': return 'error'
    case 'Draft': return 'warning'
    default: return 'grey'
  }
})

const workflowStatusIcon = computed(() => {
  switch (workflowStatus.value) {
    case 'Active': return 'mdi-check-circle'
    case 'Invalid': return 'mdi-alert-circle'
    case 'Draft': return 'mdi-file-edit'
    default: return 'mdi-file'
  }
})

const validationResult = computed(() => {
  const nodes = workflowElements.value.filter(el => el.type)
  const edges = workflowElements.value.filter(el => !el.type)
  return validateWorkflow(nodes, edges)
})

const canTestWorkflow = computed(() => {
  return workflowElements.value.length > 0 && validationResult.value?.isValid
})

const canDeployWorkflow = computed(() => {
  return validationResult.value?.isValid && workflowMetadata.value.name.trim() !== ''
})

const canUndo = computed(() => historyIndex.value > 0)
const canRedo = computed(() => historyIndex.value < history.value.length - 1)

// Options
const workflowCategories = [
  { title: 'Network Operations', value: 'network' },
  { title: 'Security', value: 'security' },
  { title: 'Monitoring', value: 'monitoring' },
  { title: 'Maintenance', value: 'maintenance' },
  { title: 'Compliance', value: 'compliance' }
]

const priorityOptions = [
  { title: 'Low', value: 'low' },
  { title: 'Medium', value: 'medium' },
  { title: 'High', value: 'high' },
  { title: 'Critical', value: 'critical' }
]

// Methods
const addToHistory = (elements) => {
  // Remove future history if we're not at the end
  if (historyIndex.value < history.value.length - 1) {
    history.value = history.value.slice(0, historyIndex.value + 1)
  }
  
  // Add new state to history
  history.value.push(JSON.parse(JSON.stringify(elements)))
  historyIndex.value = history.value.length - 1
  
  // Limit history size
  if (history.value.length > maxHistorySize) {
    history.value.shift()
    historyIndex.value--
  }
}

const undo = () => {
  if (canUndo.value) {
    historyIndex.value--
    const restoredElements = JSON.parse(JSON.stringify(history.value[historyIndex.value]))
    
    // Prevent this change from being added to history
    preventHistoryUpdate.value = true
    workflowElements.value = restoredElements
    
    // Update the canvas with restored elements
    if (canvas.value) {
      const nodes = restoredElements.filter(el => el.type)
      const edges = restoredElements.filter(el => !el.type)
      canvas.value.importWorkflow({ nodes, edges })
    }
    
    // Re-enable history updates after a brief delay
    setTimeout(() => {
      preventHistoryUpdate.value = false
    }, 100)
  }
}

const redo = () => {
  if (canRedo.value) {
    historyIndex.value++
    const restoredElements = JSON.parse(JSON.stringify(history.value[historyIndex.value]))
    
    // Prevent this change from being added to history
    preventHistoryUpdate.value = true
    workflowElements.value = restoredElements
    
    // Update the canvas with restored elements
    if (canvas.value) {
      const nodes = restoredElements.filter(el => el.type)
      const edges = restoredElements.filter(el => !el.type)
      canvas.value.importWorkflow({ nodes, edges })
    }
    
    // Re-enable history updates after a brief delay
    setTimeout(() => {
      preventHistoryUpdate.value = false
    }, 100)
  }
}

const preventHistoryUpdate = ref(false)

const onElementsChange = (elements) => {
  workflowElements.value = elements
  
  // Don't add to history if this change came from undo/redo
  if (!preventHistoryUpdate.value) {
    addToHistory(elements)
  }
}

const onNodeConfigure = (node) => {
  selectedNode.value = node
  configDialog.value = true
}

const onNodeSelect = (node) => {
  selectedElement.value = node
}

const onEdgeSelect = (edge) => {
  selectedElement.value = edge
}

const onSelectionChange = (selection) => {
  if (selection.nodes.length > 0) {
    selectedElement.value = selection.nodes[0]
  } else if (selection.edges.length > 0) {
    selectedElement.value = selection.edges[0]
  } else {
    selectedElement.value = null
  }
}

const onNodeSave = (updatedNode) => {
  const nodeIndex = workflowElements.value.findIndex(el => el.id === updatedNode.id)
  if (nodeIndex > -1) {
    workflowElements.value[nodeIndex] = updatedNode
    addToHistory([...workflowElements.value])
  }
  configDialog.value = false
}

const onNodeTest = (testData) => {
  showSnackbar(`Testing ${testData.node.type} node configuration...`, 'info')
  // Implement test logic here
}

const addNodeToCanvas = (nodeData) => {
  if (canvas.value) {
    canvas.value.addNodeFromPalette(nodeData)
  }
}

const configureSelectedNode = () => {
  if (selectedElement.value && selectedElement.value.type) {
    onNodeConfigure(selectedElement.value)
  }
}

const resetView = () => {
  if (canvas.value) {
    canvas.value.resetView()
  }
}

const autoLayout = () => {
  if (canvas.value) {
    canvas.value.autoLayout()
  }
}

const saveWorkflow = async () => {
  saving.value = true
  
  try {
    const nodes = workflowElements.value.filter(el => el.type)
    const edges = workflowElements.value.filter(el => !el.type)
    
    const workflowData = {
      name: workflowMetadata.value.name,
      description: workflowMetadata.value.description,
      category: workflowMetadata.value.category,
      priority: workflowMetadata.value.priority,
      active: workflowMetadata.value.active,
      enabled: workflowMetadata.value.enabled,
      elements: workflowElements.value,
      metadata: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        lastModified: new Date().toISOString()
      }
    }
    
    if (workflowId.value) {
      // Update existing automation
      const updatedAutomation = await automationsStore.updateAutomation(workflowId.value, workflowData)
      workflowMetadata.value = {
        ...workflowMetadata.value,
        ...updatedAutomation,
        modified: new Date().toISOString()
      }
    } else {
      // Create new automation
      const newAutomation = await automationsStore.createAutomation({
        ...workflowData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })
      
      workflowId.value = newAutomation.id
      workflowMetadata.value = {
        ...workflowMetadata.value,
        ...newAutomation,
        created: newAutomation.createdAt,
        modified: newAutomation.updatedAt
      }
      
      // Update URL to reflect the new automation ID
      router.replace(`/automations/builder/${newAutomation.id}`)
    }
    
    showSnackbar('Workflow saved successfully', 'success')
    
  } catch (error) {
    console.error('Failed to save workflow:', error)
    showSnackbar('Failed to save workflow', 'error')
  } finally {
    saving.value = false
  }
}

const deployWorkflow = async () => {
  if (!canDeployWorkflow.value) return
  
  deploying.value = true
  
  try {
    // First save the workflow if there are unsaved changes
    if (workflowId.value) {
      await saveWorkflow()
    } else {
      // Must save first before deploying
      await saveWorkflow()
    }
    
    // Deploy (activate) the automation
    if (workflowId.value) {
      await automationsStore.updateAutomation(workflowId.value, {
        active: true,
        enabled: true
      })
      
      workflowMetadata.value.active = true
      workflowMetadata.value.enabled = true
    }
    
    showSnackbar('Workflow deployed successfully', 'success')
    
  } catch (error) {
    console.error('Failed to deploy workflow:', error)
    showSnackbar('Failed to deploy workflow', 'error')
  } finally {
    deploying.value = false
  }
}

const testWorkflow = () => {
  if (!canTestWorkflow.value) return
  
  showSnackbar('Starting workflow test...', 'info')
  // Implement test logic here
}

const exportWorkflow = () => {
  const nodes = workflowElements.value.filter(el => el.type)
  const edges = workflowElements.value.filter(el => !el.type)
  
  const exportData = exportWorkflowToJSON(nodes, edges, workflowMetadata.value)
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json'
  })
  
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${workflowMetadata.value.name || 'workflow'}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  
  showSnackbar('Workflow exported successfully', 'success')
}

const handleImport = () => {
  try {
    let jsonData
    
    if (importJson.value) {
      jsonData = JSON.parse(importJson.value)
    } else if (importFile.value) {
      // Handle file import (would need FileReader in real implementation)
      showSnackbar('File import not implemented in demo', 'warning')
      return
    } else {
      showSnackbar('Please provide JSON data or select a file', 'warning')
      return
    }
    
    const importedData = importWorkflowFromJSON(jsonData)
    
    if (canvas.value) {
      canvas.value.importWorkflow(importedData)
    }
    
    if (importedData.metadata) {
      workflowMetadata.value = { ...workflowMetadata.value, ...importedData.metadata }
    }
    
    importDialog.value = false
    importJson.value = ''
    importFile.value = null
    
    showSnackbar('Workflow imported successfully', 'success')
    
  } catch (error) {
    console.error('Import failed:', error)
    showSnackbar('Failed to import workflow: Invalid JSON', 'error')
  }
}

const saveSettings = () => {
  settingsDialog.value = false
  showSnackbar('Settings saved', 'success')
}

const handleBack = () => {
  router.push('/automations')
}

const showSnackbar = (message, color = 'success') => {
  snackbar.value = {
    show: true,
    message,
    color,
    timeout: 4000
  }
}

// Keyboard shortcuts
const handleKeyboard = (event) => {
  if (event.ctrlKey || event.metaKey) {
    switch (event.key) {
      case 'z':
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        break
      case 'y':
        event.preventDefault()
        redo()
        break
      case 's':
        event.preventDefault()
        saveWorkflow()
        break
    }
  }
}

const loadExistingAutomation = async () => {
  if (!workflowId.value) return
  
  try {
    const automation = automationsStore.getAutomationById(workflowId.value)
    
    if (automation) {
      workflowMetadata.value = {
        name: automation.name,
        description: automation.description || '',
        category: automation.category || 'network',
        priority: automation.priority || 'medium',
        enabled: automation.enabled || false,
        active: automation.active || false,
        created: automation.createdAt,
        modified: automation.updatedAt
      }
      
      if (automation.elements && automation.elements.length > 0) {
        workflowElements.value = automation.elements
        
        if (canvas.value) {
          const nodes = automation.elements.filter(el => el.type)
          const edges = automation.elements.filter(el => !el.type)
          
          canvas.value.importWorkflow({ nodes, edges })
        }
      }
    }
  } catch (error) {
    console.error('Failed to load automation:', error)
    showSnackbar('Failed to load automation', 'error')
  }
}

// Lifecycle
onMounted(async () => {
  document.addEventListener('keydown', handleKeyboard)
  
  // Initialize history with empty state
  addToHistory([])
  
  // Load existing automation if editing
  if (workflowId.value) {
    // Ensure automations are loaded first
    if (automationsStore.automations.length === 0) {
      await automationsStore.fetchAutomations()
    }
    await loadExistingAutomation()
  }
  
  // Initialize with sample workflow if needed
  if (route.query.sample && !workflowId.value) {
    // Add sample nodes for demonstration
    setTimeout(() => {
      if (canvas.value) {
        const sampleWorkflow = {
          nodes: [
            {
              id: 'trigger-1',
              type: 'trigger',
              position: { x: 100, y: 100 },
              data: {
                triggerType: 'device-status',
                config: {
                  deviceName: 'AP-Office-01',
                  status: 'offline'
                },
                label: 'Device Offline Trigger'
              }
            },
            {
              id: 'action-1',
              type: 'action',
              position: { x: 400, y: 100 },
              data: {
                actionType: 'send-command',
                config: {
                  targetDevices: ['AP-Office-01'],
                  command: 'show version'
                },
                label: 'Check Device Status'
              }
            },
            {
              id: 'notification-1',
              type: 'notification',
              position: { x: 700, y: 100 },
              data: {
                notificationType: 'email',
                config: {
                  recipients: ['admin@company.com'],
                  subject: 'Device Alert',
                  message: 'AP-Office-01 went offline'
                },
                label: 'Send Alert Email'
              }
            }
          ],
          edges: [
            {
              id: 'edge-1',
              source: 'trigger-1',
              target: 'action-1'
            },
            {
              id: 'edge-2',
              source: 'action-1',
              target: 'notification-1'
            }
          ]
        }
        
        canvas.value.importWorkflow(sampleWorkflow)
        workflowMetadata.value.name = 'Device Offline Alert'
        workflowMetadata.value.description = 'Automatically respond to device offline events'
      }
    }, 500)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyboard)
})
</script>

<style scoped>
.automation-builder {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #fafafa;
}

.builder-header {
  background: white;
  border-bottom: 1px solid #e0e0e0;
  z-index: 10;
}

.builder-toolbar {
  padding: 8px 0;
  background: rgba(0, 0, 0, 0.02);
  border-radius: 6px;
}

.builder-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.node-palette {
  width: 280px;
  flex-shrink: 0;
  background: white;
  border-right: 1px solid #e0e0e0;
}

.workflow-canvas-container {
  flex: 1;
  position: relative;
}

.properties-panel {
  width: 300px;
  flex-shrink: 0;
  background: white;
  border-left: 1px solid #e0e0e0;
  padding: 16px;
}

.properties-card {
  height: 100%;
  overflow-y: auto;
}

.configuration-info {
  background: #f5f5f5;
  border-radius: 4px;
  padding: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.configuration-info pre {
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.help-content h3 {
  margin-top: 16px;
  margin-bottom: 8px;
  color: #333;
}

.help-content ul {
  margin-bottom: 16px;
  padding-left: 20px;
}

.help-content li {
  margin-bottom: 8px;
}
</style>