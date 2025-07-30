import api from './api'

export const authService = {
  /**
   * Login with email and password
   * @param {Object} credentials - Login credentials
   * @param {string} credentials.email - User email
   * @param {string} credentials.password - User password
   * @returns {Promise} API response
   */
  async login(credentials) {
    return await api.post('/auth/login', {
      email: credentials.email,
      password: credentials.password
    })
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
      refresh_token: refreshToken
    })
  },

  /**
   * Request password reset
   * @param {string} email - User email
   * @returns {Promise} API response
   */
  async forgotPassword(email) {
    return await api.post('/auth/forgot-password', {
      email
    })
  },

  /**
   * Reset password with token
   * @param {string} token - Reset token from email
   * @param {string} password - New password
   * @returns {Promise} API response
   */
  async resetPassword(token, password) {
    return await api.post('/auth/reset-password', {
      token,
      password
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