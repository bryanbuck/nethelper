import api from './api'
import debugLog, { DebugCategory } from '@/utils/debug'

export const authService = {
  /**
   * Login with email and password
   * @param {Object} credentials - Login credentials
   * @param {string} credentials.email - User email
   * @param {string} credentials.password - User password
   * @returns {Promise} API response
   */
  async login(credentials) {
    debugLog.progress(DebugCategory.API, 'Auth service login called with email:', credentials.email)
    debugLog.progress(DebugCategory.API, 'API base URL:', import.meta.env.VITE_API_URL)
    debugLog.progress(DebugCategory.API, 'Making POST request to /auth/login')
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout
    
    try {
      const response = await api.post('/auth/login', {
        email: credentials.email,
        password: credentials.password
      }, {
        signal: controller.signal,
        timeout: 15000
      })
      
      clearTimeout(timeoutId)
      debugLog.success(DebugCategory.API, 'Auth service received response', {
        status: response.status,
        statusText: response.statusText,
        data: response.data
      })
      
      return response
    } catch (error) {
      clearTimeout(timeoutId)
      debugLog.error(DebugCategory.API, 'Auth service login error type:', error.name)
      debugLog.error(DebugCategory.API, 'Auth service login error message:', error.message)
      debugLog.error(DebugCategory.API, 'Error code:', error.code)
      debugLog.error(DebugCategory.API, 'Request config:', error.config)
      debugLog.error(DebugCategory.API, 'Response status:', error.response?.status)
      debugLog.error(DebugCategory.API, 'Response data:', error.response?.data)
      debugLog.error(DebugCategory.API, 'Full error object:', error)
      
      if (error.name === 'AbortError') {
        debugLog.error(DebugCategory.API, 'Request timed out after 15 seconds')
      } else if (error.code === 'ERR_NETWORK') {
        debugLog.error(DebugCategory.API, 'Network error - check if backend is running and CORS is configured')
      }
      
      throw error
    }
  },

  /**
   * Logout user and invalidate token
   * @returns {Promise} API response
   */
  async logout() {
    return await api.post('/auth/logout')
  },

  /**
   * Refresh access token using refresh token
   * @param {string} refreshToken - The refresh token
   * @returns {Promise} API response
   */
  async refresh(refreshToken) {
    return await api.post('/auth/refresh', {
      refreshToken: refreshToken
    })
  },

  /**
   * Get current user profile
   * @returns {Promise} API response
   */
  async getProfile() {
    return await api.get('/auth/profile')
  },

  /**
   * Update user profile
   * @param {Object} profileData - Profile update data
   * @returns {Promise} API response
   */
  async updateProfile(profileData) {
    return await api.put('/auth/profile', profileData)
  },

  /**
   * Change user password
   * @param {Object} passwordData - Password change data
   * @param {string} passwordData.currentPassword - Current password
   * @param {string} passwordData.newPassword - New password
   * @returns {Promise} API response
   */
  async changePassword(passwordData) {
    return await api.put('/auth/change-password', {
      current_password: passwordData.currentPassword,
      new_password: passwordData.newPassword
    })
  },

  /**
   * Verify email address
   * @param {string} token - Email verification token
   * @returns {Promise} API response
   */
  async verifyEmail(token) {
    return await api.post('/auth/verify-email', {
      token
    })
  }
}