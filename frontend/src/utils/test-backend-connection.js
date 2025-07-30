/**
 * Backend Connection Test Utility
 * Simple script to test connectivity to the backend API health endpoint
 */

import axios from 'axios'

// Get API base URL from environment or use default
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1'

/**
 * Test backend connection by calling the health endpoint
 * @returns {Promise<Object>} Test result with status and details
 */
export async function testBackendConnection() {
  const result = {
    success: false,
    status: null,
    message: '',
    timestamp: new Date().toISOString(),
    url: '',
    responseTime: null,
    error: null
  }

  const startTime = performance.now()

  try {
    // Determine the health endpoint URL
    const healthUrl = `${API_BASE_URL}/health`
    result.url = healthUrl

    console.log(`Testing backend connection to: ${healthUrl}`)

    // Make the API call with a reasonable timeout
    const response = await axios.get(healthUrl, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json'
      }
    })

    const endTime = performance.now()
    result.responseTime = Math.round(endTime - startTime)

    result.success = true
    result.status = response.status
    result.message = `Backend is responding. Status: ${response.status}`
    
    // Log response data if available
    if (response.data) {
      console.log('Health check response:', response.data)
    }

    return result

  } catch (error) {
    const endTime = performance.now()
    result.responseTime = Math.round(endTime - startTime)

    result.success = false
    result.error = error

    if (error.response) {
      // Server responded with error status
      result.status = error.response.status
      result.message = `Backend responded with error: ${error.response.status} - ${error.response.statusText}`
    } else if (error.request) {
      // Request made but no response received
      result.message = 'No response from backend - check if server is running'
    } else {
      // Error in request setup
      result.message = `Request setup error: ${error.message}`
    }

    return result
  }
}

/**
 * Run the connection test and log results to console
 * @returns {Promise<Object>} Test result
 */
export async function runConnectionTest() {
  console.log('🔍 Starting backend connection test...')
  
  const result = await testBackendConnection()
  
  if (result.success) {
    console.log('✅ Backend connection successful!')
    console.log(`   URL: ${result.url}`)
    console.log(`   Status: ${result.status}`)
    console.log(`   Response time: ${result.responseTime}ms`)
  } else {
    console.error('❌ Backend connection failed!')
    console.error(`   URL: ${result.url}`)
    console.error(`   Message: ${result.message}`)
    console.error(`   Response time: ${result.responseTime}ms`)
    
    if (result.error) {
      console.error('   Error details:', result.error.message)
    }
  }
  
  return result
}

/**
 * Test multiple endpoints to verify backend functionality
 * @returns {Promise<Object>} Overall test results
 */
export async function testMultipleEndpoints() {
  const endpoints = [
    { name: 'Health Check', path: '/health' },
    { name: 'API Status', path: '/status' },
    { name: 'Devices Endpoint', path: '/devices' } // This might require auth
  ]

  const results = {
    overall: true,
    timestamp: new Date().toISOString(),
    tests: []
  }

  console.log('🔍 Testing multiple backend endpoints...')

  for (const endpoint of endpoints) {
    const testUrl = `${API_BASE_URL}${endpoint.path}`
    const startTime = performance.now()

    try {
      const response = await axios.get(testUrl, {
        timeout: 5000,
        headers: {
          'Content-Type': 'application/json'
        }
      })

      const endTime = performance.now()
      const responseTime = Math.round(endTime - startTime)

      results.tests.push({
        name: endpoint.name,
        path: endpoint.path,
        url: testUrl,
        success: true,
        status: response.status,
        responseTime,
        message: `Success: ${response.status}`
      })

      console.log(`✅ ${endpoint.name}: ${response.status} (${responseTime}ms)`)

    } catch (error) {
      const endTime = performance.now()
      const responseTime = Math.round(endTime - startTime)

      let message = 'Unknown error'
      let status = null

      if (error.response) {
        status = error.response.status
        message = `Error: ${error.response.status} - ${error.response.statusText}`
      } else if (error.request) {
        message = 'No response from server'
      } else {
        message = `Request error: ${error.message}`
      }

      results.tests.push({
        name: endpoint.name,
        path: endpoint.path,
        url: testUrl,
        success: false,
        status,
        responseTime,
        message,
        error: error.message
      })

      results.overall = false
      console.error(`❌ ${endpoint.name}: ${message} (${responseTime}ms)`)
    }
  }

  console.log(`\n📊 Overall result: ${results.overall ? '✅ PASS' : '❌ FAIL'}`)
  return results
}

// Export default function for easy import
export default testBackendConnection