/**
 * API Endpoints Configuration
 * Centralizes all backend API endpoints for the Aruba Central Automation Platform
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'

/**
 * API endpoints organized by feature area
 */
export const endpoints = {
  // Authentication endpoints
  auth: {
    register: '/auth/register',
    login: '/auth/login',
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    me: '/auth/me',
    updateProfile: '/auth/me',
  },

  // Device management endpoints
  devices: {
    list: '/devices',
    create: '/devices',
    sync: '/devices/sync',
    detail: (deviceId) => `/devices/${deviceId}`,
    update: (deviceId) => `/devices/${deviceId}`,
    delete: (deviceId) => `/devices/${deviceId}`,
    stats: (deviceId) => `/devices/${deviceId}/stats`,
    updateConfiguration: (deviceId) => `/devices/${deviceId}/configuration`,
    backup: (deviceId) => `/devices/${deviceId}/backup`,
    executeCommand: (deviceId) => `/devices/${deviceId}/command`,
    
    // Device groups
    groups: {
      list: '/devices/groups',
      create: '/devices/groups',
      update: (groupId) => `/devices/groups/${groupId}`,
      delete: (groupId) => `/devices/groups/${groupId}`,
    },
  },

  // Automation management endpoints
  automations: {
    list: '/automations',
    create: '/automations',
    detail: (automationId) => `/automations/${automationId}`,
    update: (automationId) => `/automations/${automationId}`,
    delete: (automationId) => `/automations/${automationId}`,
    execute: (automationId) => `/automations/${automationId}/execute`,
  },

  // Schedule management endpoints
  schedules: {
    list: '/schedules',
    create: '/schedules',
    detail: (scheduleId) => `/schedules/${scheduleId}`,
    update: (scheduleId) => `/schedules/${scheduleId}`,
    delete: (scheduleId) => `/schedules/${scheduleId}`,
    byAutomation: (automationId) => `/schedules/automation/${automationId}`,
  },

  // Execution monitoring endpoints
  executions: {
    list: '/executions',
    detail: (executionId) => `/executions/${executionId}`,
    cancel: (executionId) => `/executions/${executionId}/cancel`,
    stats: '/executions/stats/summary',
    byAutomation: (automationId) => `/executions/automation/${automationId}`,
    byDevice: (deviceId) => `/executions/device/${deviceId}`,
  },
}

/**
 * Helper function to build full URL
 * @param {string} endpoint - The endpoint path
 * @returns {string} Full URL
 */
export const buildUrl = (endpoint) => {
  return `${API_BASE_URL}${endpoint}`
}

/**
 * Helper function to build endpoint with parameters
 * @param {Function|string} endpointBuilder - Endpoint builder function or static string
 * @param {...any} params - Parameters to pass to the builder function
 * @returns {string} Built endpoint path
 */
export const buildEndpoint = (endpointBuilder, ...params) => {
  if (typeof endpointBuilder === 'function') {
    return endpointBuilder(...params)
  }
  return endpointBuilder
}

/**
 * Get full URL for an endpoint with optional parameters
 * @param {Function|string} endpointBuilder - Endpoint builder function or static string
 * @param {...any} params - Parameters to pass to the builder function
 * @returns {string} Full URL
 */
export const getEndpointUrl = (endpointBuilder, ...params) => {
  const endpoint = buildEndpoint(endpointBuilder, ...params)
  return buildUrl(endpoint)
}

// Export API base URL for direct access
export { API_BASE_URL }

// Export default object for convenience
export default {
  endpoints,
  buildUrl,
  buildEndpoint,
  getEndpointUrl,
  API_BASE_URL,
}