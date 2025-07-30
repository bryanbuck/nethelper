/**
 * Automation Model
 * Represents an automation workflow in the NetHelper Automation Platform
 */

// Automation type enumeration
export const AutomationType = {
  CONFIGURATION_BACKUP: 'configuration_backup',
  FIRMWARE_UPDATE: 'firmware_update',
  COMPLIANCE_CHECK: 'compliance_check',
  CUSTOM_SCRIPT: 'custom_script',
  MONITORING_ALERT: 'monitoring_alert'
}

// Automation type display information
export const AutomationTypeInfo = {
  [AutomationType.CONFIGURATION_BACKUP]: {
    label: 'Configuration Backup',
    icon: 'mdi-backup-restore',
    description: 'Backup device configurations automatically',
    color: 'blue',
    category: 'Maintenance'
  },
  [AutomationType.FIRMWARE_UPDATE]: {
    label: 'Firmware Update',
    icon: 'mdi-update',
    description: 'Update device firmware versions',
    color: 'orange',
    category: 'Maintenance'
  },
  [AutomationType.COMPLIANCE_CHECK]: {
    label: 'Compliance Check',
    icon: 'mdi-shield-check',
    description: 'Verify device compliance with policies',
    color: 'green',
    category: 'Security'
  },
  [AutomationType.CUSTOM_SCRIPT]: {
    label: 'Custom Script',
    icon: 'mdi-code-braces',
    description: 'Execute custom automation scripts',
    color: 'purple',
    category: 'Custom'
  },
  [AutomationType.MONITORING_ALERT]: {
    label: 'Monitoring Alert',
    icon: 'mdi-bell-alert',
    description: 'Monitor device status and send alerts',
    color: 'red',
    category: 'Monitoring'
  }
}

// Workflow node types
export const WorkflowNodeType = {
  TRIGGER: 'trigger',
  CONDITION: 'condition',
  ACTION: 'action',
  NOTIFICATION: 'notification'
}

// Default workflow structure
export const DefaultWorkflow = {
  nodes: [],
  edges: [],
  variables: {},
  settings: {
    timeout: 300000, // 5 minutes in milliseconds
    retryCount: 3,
    retryDelay: 5000, // 5 seconds
    concurrency: 1
  }
}

export class Automation {
  constructor(data = {}) {
    this.id = data.id || null
    this.name = data.name || ''
    this.description = data.description || null
    this.type = data.type || AutomationType.CUSTOM_SCRIPT
    this.workflow = data.workflow || { ...DefaultWorkflow }
    this.active = data.active !== undefined ? data.active : true
    this.createdBy = data.createdBy || null
    this.userId = data.userId || null
    this.createdAt = data.createdAt ? new Date(data.createdAt) : new Date()
    this.updatedAt = data.updatedAt ? new Date(data.updatedAt) : new Date()
    
    // Related data
    this.schedules = data.schedules || []
    this.executions = data.executions || []
    this.deviceGroups = data.deviceGroups || []
  }

  /**
   * Create Automation instance from API response
   * @param {Object} apiData - Raw data from API
   * @returns {Automation} Automation instance
   */
  static fromApiResponse(apiData) {
    return new Automation(apiData)
  }

  /**
   * Convert Automation instance to API payload
   * @returns {Object} API payload
   */
  toApiPayload() {
    return {
      name: this.name,
      description: this.description,
      type: this.type,
      workflow: this.workflow,
      active: this.active
    }
  }

  /**
   * Get automation type information
   * @returns {Object} Type information with label, icon, description, color, and category
   */
  getTypeInfo() {
    return AutomationTypeInfo[this.type] || AutomationTypeInfo[AutomationType.CUSTOM_SCRIPT]
  }

  /**
   * Get display name for automation
   * @returns {string} Display name
   */
  getDisplayName() {
    return this.name || 'Unnamed Automation'
  }

  /**
   * Check if automation is active
   * @returns {boolean} Whether automation is active
   */
  isActive() {
    return this.active
  }

  /**
   * Check if automation has schedules
   * @returns {boolean} Whether automation has schedules
   */
  hasSchedules() {
    return this.schedules && this.schedules.length > 0
  }

  /**
   * Get active schedules count
   * @returns {number} Number of active schedules
   */
  getActiveSchedulesCount() {
    return this.schedules.filter(schedule => schedule.active).length
  }

  /**
   * Get total executions count
   * @returns {number} Number of executions
   */
  getExecutionsCount() {
    return this.executions.length
  }

  /**
   * Get successful executions count
   * @returns {number} Number of successful executions
   */
  getSuccessfulExecutionsCount() {
    return this.executions.filter(exec => exec.status === 'success').length
  }

  /**
   * Get automation success rate
   * @returns {number} Success rate percentage (0-100)
   */
  getSuccessRate() {
    const totalExecutions = this.getExecutionsCount()
    if (totalExecutions === 0) return 0
    
    const successfulExecutions = this.getSuccessfulExecutionsCount()
    return Math.round((successfulExecutions / totalExecutions) * 100)
  }

  /**
   * Get last execution
   * @returns {Object|null} Last execution or null
   */
  getLastExecution() {
    if (this.executions.length === 0) return null
    
    return this.executions.reduce((latest, execution) => {
      const executionDate = new Date(execution.createdAt)
      const latestDate = new Date(latest.createdAt)
      return executionDate > latestDate ? execution : latest
    })
  }

  /**
   * Get last execution status
   * @returns {string|null} Last execution status or null
   */
  getLastExecutionStatus() {
    const lastExecution = this.getLastExecution()
    return lastExecution ? lastExecution.status : null
  }

  /**
   * Get workflow complexity score based on nodes and connections
   * @returns {number} Complexity score (1-10)
   */
  getComplexityScore() {
    const nodeCount = this.workflow.nodes?.length || 0
    const edgeCount = this.workflow.edges?.length || 0
    
    if (nodeCount <= 3) return 1
    if (nodeCount <= 5) return 3
    if (nodeCount <= 10) return 5
    if (nodeCount <= 15) return 7
    return 10
  }

  /**
   * Get workflow node count by type
   * @returns {Object} Node counts by type
   */
  getNodeCounts() {
    const counts = {
      trigger: 0,
      condition: 0,
      action: 0,
      notification: 0
    }

    if (this.workflow.nodes) {
      this.workflow.nodes.forEach(node => {
        if (counts.hasOwnProperty(node.type)) {
          counts[node.type]++
        }
      })
    }

    return counts
  }

  /**
   * Validate workflow structure
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validateWorkflow() {
    const errors = []
    
    if (!this.workflow) {
      errors.push('Workflow is required')
      return { isValid: false, errors }
    }

    const { nodes = [], edges = [] } = this.workflow

    // Check for at least one trigger node
    const triggerNodes = nodes.filter(node => node.type === WorkflowNodeType.TRIGGER)
    if (triggerNodes.length === 0) {
      errors.push('Workflow must have at least one trigger node')
    }

    // Check for at least one action node
    const actionNodes = nodes.filter(node => node.type === WorkflowNodeType.ACTION)
    if (actionNodes.length === 0) {
      errors.push('Workflow must have at least one action node')
    }

    // Validate node connections
    const nodeIds = new Set(nodes.map(node => node.id))
    edges.forEach(edge => {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge references non-existent source node: ${edge.source}`)
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge references non-existent target node: ${edge.target}`)
      }
    })

    // Check for isolated nodes (except triggers)
    const connectedNodes = new Set()
    edges.forEach(edge => {
      connectedNodes.add(edge.source)
      connectedNodes.add(edge.target)
    })

    nodes.forEach(node => {
      if (node.type !== WorkflowNodeType.TRIGGER && !connectedNodes.has(node.id)) {
        errors.push(`Node "${node.data?.label || node.id}" is not connected to the workflow`)
      }
    })

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Validate automation data
   * @returns {Object} Validation result with isValid boolean and errors array
   */
  validate() {
    const errors = []

    // Name validation
    if (!this.name || this.name.trim().length < 2) {
      errors.push('Automation name must be at least 2 characters long')
    }

    // Type validation
    if (!Object.values(AutomationType).includes(this.type)) {
      errors.push('Invalid automation type')
    }

    // Workflow validation
    const workflowValidation = this.validateWorkflow()
    if (!workflowValidation.isValid) {
      errors.push(...workflowValidation.errors)
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * Clone automation instance
   * @returns {Automation} Cloned automation instance
   */
  clone() {
    return new Automation({
      id: this.id,
      name: this.name,
      description: this.description,
      type: this.type,
      workflow: JSON.parse(JSON.stringify(this.workflow)), // Deep clone workflow
      active: this.active,
      createdBy: this.createdBy,
      userId: this.userId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      schedules: [...this.schedules],
      executions: [...this.executions],
      deviceGroups: [...this.deviceGroups]
    })
  }

  /**
   * Update automation data
   * @param {Object} updates - Updates to apply
   * @returns {Automation} Updated automation instance
   */
  update(updates) {
    const updatedAutomation = this.clone()
    Object.assign(updatedAutomation, updates)
    updatedAutomation.updatedAt = new Date()
    return updatedAutomation
  }

  /**
   * Toggle automation active status
   * @returns {Automation} Updated automation instance
   */
  toggleActive() {
    return this.update({ active: !this.active })
  }

  /**
   * Add node to workflow
   * @param {Object} node - Node to add
   * @returns {Automation} Updated automation instance
   */
  addWorkflowNode(node) {
    const updatedWorkflow = { ...this.workflow }
    updatedWorkflow.nodes = [...(updatedWorkflow.nodes || []), node]
    return this.update({ workflow: updatedWorkflow })
  }

  /**
   * Remove node from workflow
   * @param {string} nodeId - ID of node to remove
   * @returns {Automation} Updated automation instance
   */
  removeWorkflowNode(nodeId) {
    const updatedWorkflow = { ...this.workflow }
    updatedWorkflow.nodes = (updatedWorkflow.nodes || []).filter(node => node.id !== nodeId)
    updatedWorkflow.edges = (updatedWorkflow.edges || []).filter(
      edge => edge.source !== nodeId && edge.target !== nodeId
    )
    return this.update({ workflow: updatedWorkflow })
  }

  /**
   * Add edge to workflow
   * @param {Object} edge - Edge to add
   * @returns {Automation} Updated automation instance
   */
  addWorkflowEdge(edge) {
    const updatedWorkflow = { ...this.workflow }
    updatedWorkflow.edges = [...(updatedWorkflow.edges || []), edge]
    return this.update({ workflow: updatedWorkflow })
  }

  /**
   * Get automation summary for quick display
   * @returns {Object} Automation summary
   */
  getSummary() {
    return {
      id: this.id,
      name: this.getDisplayName(),
      type: this.getTypeInfo().label,
      active: this.active,
      schedulesCount: this.getActiveSchedulesCount(),
      executionsCount: this.getExecutionsCount(),
      successRate: this.getSuccessRate(),
      lastExecutionStatus: this.getLastExecutionStatus(),
      complexityScore: this.getComplexityScore()
    }
  }

  /**
   * Get workflow visualization data
   * @returns {Object} Data for workflow visualization
   */
  getWorkflowVisualization() {
    return {
      nodes: this.workflow.nodes || [],
      edges: this.workflow.edges || [],
      nodeCount: this.workflow.nodes?.length || 0,
      edgeCount: this.workflow.edges?.length || 0,
      nodeCounts: this.getNodeCounts(),
      complexity: this.getComplexityScore()
    }
  }

  /**
   * Convert to JSON representation
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      type: this.type,
      workflow: this.workflow,
      active: this.active,
      createdBy: this.createdBy,
      userId: this.userId,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      schedules: this.schedules,
      executions: this.executions,
      deviceGroups: this.deviceGroups
    }
  }
}

export default Automation