import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { Automation } from '@/models'
import automationService from '@/services/automation.service'

export const useAutomationsStore = defineStore('automations', () => {
  const automations = ref([])
  const selectedAutomation = ref(null)
  const loading = ref(false)
  const stats = ref({
    total: 0,
    active: 0,
    inactive: 0,
    scheduled: 0
  })

  // Computed properties
  const activeAutomations = computed(() => 
    automations.value.filter(automation => automation.active)
  )

  const inactiveAutomations = computed(() => 
    automations.value.filter(automation => !automation.active)
  )

  const automationsByType = computed(() => {
    const types = {}
    automations.value.forEach(automation => {
      const type = automation.type
      if (!types[type]) {
        types[type] = []
      }
      types[type].push(automation)
    })
    return types
  })

  const recentAutomations = computed(() => 
    automations.value
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, 10)
  )

  // Actions
  async function fetchAutomations() {
    loading.value = true
    try {
      const response = await automationService.getAutomations()
      automations.value = response.data.map(data => 
        Automation.fromApiResponse(data)
      )
      updateStats()
    } catch (error) {
      console.error('Failed to fetch automations:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function createAutomation(automationData) {
    loading.value = true
    try {
      const automation = new Automation(automationData)
      const validation = automation.validate()
      
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
      }

      const response = await automationService.createAutomation(automation.toApiPayload())
      const newAutomation = Automation.fromApiResponse(response.data)
      
      automations.value.unshift(newAutomation)
      updateStats()
      
      return newAutomation
    } catch (error) {
      console.error('Failed to create automation:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function updateAutomation(automationId, updates) {
    loading.value = true
    try {
      const automation = automations.value.find(a => a.id === automationId)
      if (!automation) {
        throw new Error('Automation not found')
      }

      const updatedAutomation = automation.update(updates)
      const validation = updatedAutomation.validate()
      
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
      }

      const response = await automationService.updateAutomation(
        automationId, 
        updatedAutomation.toApiPayload()
      )
      
      const index = automations.value.findIndex(a => a.id === automationId)
      if (index > -1) {
        automations.value[index] = Automation.fromApiResponse(response.data)
      }
      
      updateStats()
      return automations.value[index]
    } catch (error) {
      console.error('Failed to update automation:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function deleteAutomation(automationId) {
    loading.value = true
    try {
      await automationService.deleteAutomation(automationId)
      
      const index = automations.value.findIndex(a => a.id === automationId)
      if (index > -1) {
        automations.value.splice(index, 1)
      }
      
      updateStats()
    } catch (error) {
      console.error('Failed to delete automation:', error)
      throw error
    } finally {
      loading.value = false
    }
  }

  async function toggleAutomationStatus(automationId) {
    const automation = automations.value.find(a => a.id === automationId)
    if (automation) {
      await updateAutomation(automationId, { active: !automation.active })
    }
  }

  async function executeAutomation(automationId, deviceId = null) {
    try {
      const response = await automationService.executeAutomation(automationId, { deviceId })
      return response.data
    } catch (error) {
      console.error('Failed to execute automation:', error)
      throw error
    }
  }

  function addAutomation(automationData) {
    const automation = automationData instanceof Automation 
      ? automationData 
      : Automation.fromApiResponse(automationData)
    
    automations.value.unshift(automation)
    updateStats()
  }

  function removeAutomation(automationId) {
    const index = automations.value.findIndex(a => a.id === automationId)
    if (index > -1) {
      automations.value.splice(index, 1)
      updateStats()
    }
  }

  function updateAutomationInStore(automationId, updates) {
    const index = automations.value.findIndex(a => a.id === automationId)
    if (index > -1) {
      const currentAutomation = automations.value[index]
      automations.value[index] = currentAutomation.update(updates)
      updateStats()
    }
  }

  function setSelectedAutomation(automationId) {
    selectedAutomation.value = automations.value.find(a => a.id === automationId) || null
  }

  function clearSelectedAutomation() {
    selectedAutomation.value = null
  }

  function updateStats() {
    const scheduledCount = automations.value.filter(a => 
      a.schedules && a.schedules.length > 0
    ).length

    stats.value = {
      total: automations.value.length,
      active: activeAutomations.value.length,
      inactive: inactiveAutomations.value.length,
      scheduled: scheduledCount
    }
  }

  function getAutomationsByType(type) {
    return automations.value.filter(automation => automation.type === type)
  }

  function getAutomationById(automationId) {
    return automations.value.find(automation => automation.id === automationId)
  }

  function searchAutomations(query) {
    if (!query) return automations.value

    const searchTerm = query.toLowerCase()
    return automations.value.filter(automation => 
      automation.name.toLowerCase().includes(searchTerm) ||
      automation.description?.toLowerCase().includes(searchTerm) ||
      automation.type.toLowerCase().includes(searchTerm)
    )
  }

  return {
    automations,
    selectedAutomation,
    loading,
    stats,
    activeAutomations,
    inactiveAutomations,
    automationsByType,
    recentAutomations,
    fetchAutomations,
    createAutomation,
    updateAutomation,
    deleteAutomation,
    toggleAutomationStatus,
    executeAutomation,
    addAutomation,
    removeAutomation,
    updateAutomationInStore,
    setSelectedAutomation,
    clearSelectedAutomation,
    getAutomationsByType,
    getAutomationById,
    searchAutomations
  }
})