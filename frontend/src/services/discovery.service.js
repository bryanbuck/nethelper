import api from './api'
import { handleApiError } from '@/utils/apiError'

class DiscoveryService {
  /**
   * Get suggested local subnets derived from the backend host's interfaces
   * @returns {Promise<Object>} { success, data: [{ interface, subnet }] }
   */
  async getSubnets() {
    try {
      const response = await api.get('/discovery/subnets')
      return response.data
    } catch (error) {
      console.error('Error fetching suggested subnets:', error)
      throw handleApiError(error, 'fetching suggested subnets')
    }
  }

  /**
   * Start a new discovery scan
   * @param {string[]|null} subnets - CIDR strings to scan (omit to auto-detect)
   * @returns {Promise<Object>} { success, data: scan }
   */
  async startScan(subnets = null) {
    try {
      const body = subnets && subnets.length > 0 ? { subnets } : {}
      const response = await api.post('/discovery/scan', body)
      return response.data
    } catch (error) {
      console.error('Error starting discovery scan:', error)
      throw handleApiError(error, 'starting discovery scan')
    }
  }

  /**
   * List recent discovery scans
   * @param {number} limit - Maximum number of scans to return
   * @returns {Promise<Object>} { success, data: scans, count }
   */
  async getScans(limit = 20) {
    try {
      const response = await api.get('/discovery/scans', { params: { limit } })
      return response.data
    } catch (error) {
      console.error('Error fetching discovery scans:', error)
      throw handleApiError(error, 'fetching discovery scans')
    }
  }

  /**
   * Get a single scan with its discovered devices
   * @param {string} scanId - Scan ID
   * @returns {Promise<Object>} { success, data: scan (with discoveredDevices[]) }
   */
  async getScan(scanId) {
    try {
      const response = await api.get(`/discovery/scans/${scanId}`)
      return response.data
    } catch (error) {
      console.error('Error fetching discovery scan:', error)
      throw handleApiError(error, 'fetching discovery scan')
    }
  }

  /**
   * Delete a scan and its results (admin only)
   * @param {string} scanId - Scan ID
   */
  async deleteScan(scanId) {
    try {
      const response = await api.delete(`/discovery/scans/${scanId}`)
      return response.data
    } catch (error) {
      console.error('Error deleting discovery scan:', error)
      throw handleApiError(error, 'deleting discovery scan')
    }
  }

  /**
   * Import a discovered device into the inventory
   * @param {string} discoveredId - Discovered device ID
   * @param {Object} data - { name?, type?, serial?, model?, location?, updateExisting? }
   * @returns {Promise<Object>} { success, data: device, merged, message }
   */
  async importDevice(discoveredId, data = {}) {
    try {
      const response = await api.post(`/discovery/devices/${discoveredId}/import`, data)
      return response.data
    } catch (error) {
      console.error('Error importing discovered device:', error)
      throw handleApiError(error, 'importing discovered device')
    }
  }

  /**
   * Ignore a discovered device
   * @param {string} discoveredId - Discovered device ID
   */
  async ignoreDevice(discoveredId) {
    try {
      const response = await api.post(`/discovery/devices/${discoveredId}/ignore`)
      return response.data
    } catch (error) {
      console.error('Error ignoring discovered device:', error)
      throw handleApiError(error, 'ignoring discovered device')
    }
  }
}

export default new DiscoveryService()
