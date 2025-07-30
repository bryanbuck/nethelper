import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { Execution, ExecutionStatus } from '@/models'

export const useExecutionsStore = defineStore('executions', () => {
  const executions = ref([])
  const activeExecutions = ref([])
  const recentExecutions = ref([])
  const loading = ref(false)
  const stats = ref({
    total: 0,
    running: 0,
    success: 0,
    failed: 0,
    pending: 0
  })

  // Computed properties
  const runningExecutions = computed(() => 
    executions.value.filter(exec => exec.status === ExecutionStatus.RUNNING)
  )

  const pendingExecutions = computed(() => 
    executions.value.filter(exec => exec.status === ExecutionStatus.PENDING)
  )

  const completedExecutions = computed(() => 
    executions.value.filter(exec => 
      [ExecutionStatus.SUCCESS, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED].includes(exec.status)
    )
  )

  const successfulExecutions = computed(() => 
    executions.value.filter(exec => exec.status === ExecutionStatus.SUCCESS)
  )

  const failedExecutions = computed(() => 
    executions.value.filter(exec => exec.status === ExecutionStatus.FAILED)
  )

  // Actions
  function addExecution(executionData) {
    const execution = executionData instanceof Execution 
      ? executionData 
      : Execution.fromApiResponse(executionData)
    
    executions.value.unshift(execution)
    updateActiveExecutions()
    updateStats()
  }

  function updateExecution(executionId, updates) {
    const index = executions.value.findIndex(exec => exec.id === executionId)
    if (index > -1) {
      const currentExecution = executions.value[index]
      const updatedExecution = currentExecution.update(updates)
      executions.value[index] = updatedExecution
      updateActiveExecutions()
      updateStats()
    }
  }

  function updateExecutionStatus(executionId, status, additionalData = {}) {
    const execution = executions.value.find(exec => exec.id === executionId)
    if (execution) {
      const updates = { status, ...additionalData }
      
      // Set timestamps based on status
      if (status === ExecutionStatus.RUNNING && !execution.startedAt) {
        updates.startedAt = new Date()
      } else if ([ExecutionStatus.SUCCESS, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED].includes(status)) {
        updates.completedAt = new Date()
        
        // Calculate duration if we have start time
        if (execution.startedAt) {
          updates.duration = new Date() - new Date(execution.startedAt)
        }
      }
      
      updateExecution(executionId, updates)
    }
  }

  function updateExecutionProgress(executionId, progressData) {
    const execution = executions.value.find(exec => exec.id === executionId)
    if (execution) {
      const output = execution.output || {}
      output.progress = progressData.progress
      output.currentStep = progressData.currentStep
      output.totalSteps = progressData.totalSteps
      output.message = progressData.message
      
      updateExecution(executionId, { output })
    }
  }

  function removeExecution(executionId) {
    const index = executions.value.findIndex(exec => exec.id === executionId)
    if (index > -1) {
      executions.value.splice(index, 1)
      updateActiveExecutions()
      updateStats()
    }
  }

  function updateActiveExecutions() {
    activeExecutions.value = executions.value.filter(exec => 
      [ExecutionStatus.PENDING, ExecutionStatus.RUNNING].includes(exec.status)
    )
  }

  function updateStats() {
    stats.value = {
      total: executions.value.length,
      running: runningExecutions.value.length,
      success: successfulExecutions.value.length,
      failed: failedExecutions.value.length,
      pending: pendingExecutions.value.length
    }
  }

  function getExecutionsByAutomation(automationId) {
    return executions.value.filter(exec => exec.automationId === automationId)
  }

  function getExecutionsByDevice(deviceId) {
    return executions.value.filter(exec => exec.deviceId === deviceId)
  }

  function clearCompletedExecutions() {
    executions.value = executions.value.filter(exec => 
      ![ExecutionStatus.SUCCESS, ExecutionStatus.FAILED, ExecutionStatus.CANCELLED].includes(exec.status)
    )
    updateActiveExecutions()
    updateStats()
  }

  return {
    executions,
    activeExecutions,
    recentExecutions,
    loading,
    stats,
    runningExecutions,
    pendingExecutions,
    completedExecutions,
    successfulExecutions,
    failedExecutions,
    addExecution,
    updateExecution,
    updateExecutionStatus,
    updateExecutionProgress,
    removeExecution,
    getExecutionsByAutomation,
    getExecutionsByDevice,
    clearCompletedExecutions
  }
})