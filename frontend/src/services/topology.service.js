import api from './api'
import { handleApiError } from '@/utils/apiError'

class TopologyService {
  /**
   * The Network Map graph.
   * @param {Object} params - { site?: string, includeDiscovered?: boolean }
   * @returns {Promise<Object>} { success, data: { nodes, edges, sites, stats } }
   */
  async getGraph(params = {}) {
    try {
      const query = {}
      if (params.site) query.site = params.site
      if (params.includeDiscovered) query.includeDiscovered = true
      const response = await api.get('/topology/graph', { params: query })
      return response.data
    } catch (error) {
      console.error('Error fetching network map:', error)
      throw handleApiError(error, 'loading the network map')
    }
  }

  /**
   * Link added/removed/changed history, newest first.
   * @param {Object} params - { since?: ISO string, deviceId?: string, limit?: number }
   */
  async getChanges(params = {}) {
    try {
      const response = await api.get('/topology/changes', { params })
      return response.data
    } catch (error) {
      console.error('Error fetching topology changes:', error)
      throw handleApiError(error, 'loading topology changes')
    }
  }

  /**
   * Queue a neighbor collection (all devices, or the given ones).
   * @param {string[]|null} deviceIds
   */
  async collect(deviceIds = null) {
    try {
      const response = await api.post('/topology/collect', deviceIds?.length ? { deviceIds } : {})
      return response.data
    } catch (error) {
      console.error('Error starting topology collection:', error)
      throw handleApiError(error, 'refreshing the topology')
    }
  }

  /** Saved node positions for a scope ("all" or "site:<location>"). */
  async getLayout(scope) {
    try {
      const response = await api.get(`/topology/layouts/${encodeURIComponent(scope)}`)
      return response.data
    } catch (error) {
      console.error('Error fetching map layout:', error)
      throw handleApiError(error, 'loading the saved layout')
    }
  }

  /** Replace a scope's saved positions: { nodeId: { x, y } }. */
  async saveLayout(scope, positions) {
    try {
      const response = await api.put(`/topology/layouts/${encodeURIComponent(scope)}`, { positions })
      return response.data
    } catch (error) {
      console.error('Error saving map layout:', error)
      throw handleApiError(error, 'saving the layout')
    }
  }

  /** One device's LLDP/CDP neighbors with far ends resolved. */
  async getDeviceNeighbors(deviceId) {
    try {
      const response = await api.get(`/devices/${deviceId}/neighbors`)
      return response.data
    } catch (error) {
      console.error('Error fetching device neighbors:', error)
      throw handleApiError(error, 'loading neighbors')
    }
  }
}

export default new TopologyService()
