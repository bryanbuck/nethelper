import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import router from '@/router'
import { authService } from '@/services/auth.service'
import debugLog, { DebugCategory } from '@/utils/debug'

export const useAuthStore = defineStore('auth', () => {
  // State
  const user = ref(null)
  const token = ref(localStorage.getItem('access_token'))
  const refreshToken = ref(localStorage.getItem('refresh_token'))
  const isLoading = ref(false)
  const error = ref(null)

  // Getters
  const isAuthenticated = computed(() => !!token.value && !!user.value)
  const userRole = computed(() => user.value?.role || null)
  const userName = computed(() => user.value?.name || user.value?.email || '')

  // Actions
  const login = async (credentials) => {
    debugLog.progress(DebugCategory.AUTH, 'Auth store login called', { email: credentials.email, password: '***' })
    
    try {
      isLoading.value = true
      error.value = null
      debugLog.progress(DebugCategory.AUTH, 'Setting loading state to true, cleared errors')

      debugLog.progress(DebugCategory.AUTH, 'Calling authService.login...')
      const response = await authService.login(credentials)
      debugLog.success(DebugCategory.AUTH, 'Auth service response received', {
        status: response.status,
        data: response.data ? {
          success: response.data.success ? 'present' : 'missing',
          user: response.data.data?.user ? 'present' : 'missing',
          accessToken: response.data.data?.accessToken ? 'present' : 'missing',
          refreshToken: response.data.data?.refreshToken ? 'present' : 'missing'
        } : 'no data'
      })
      
      // Backend wraps response in { success: true, data: { user, accessToken, refreshToken } }
      const responseData = response.data.data
      token.value = responseData.accessToken
      refreshToken.value = responseData.refreshToken
      user.value = responseData.user

      debugLog.progress(DebugCategory.AUTH, 'Storing tokens and user data in state')
      debugLog.progress(DebugCategory.AUTH, 'Token stored:', token.value ? 'yes' : 'no')
      debugLog.progress(DebugCategory.AUTH, 'User stored:', user.value ? 'yes' : 'no')

      // Persist to localStorage
      localStorage.setItem('access_token', token.value)
      localStorage.setItem('refresh_token', refreshToken.value)
      localStorage.setItem('user', JSON.stringify(user.value))
      debugLog.progress(DebugCategory.AUTH, 'Data persisted to localStorage')

      debugLog.success(DebugCategory.AUTH, 'isAuthenticated computed:', isAuthenticated.value)

      // Don't navigate here - let the component handle navigation
      // This prevents double navigation conflicts
      
      return response.data
    } catch (err) {
      debugLog.error(DebugCategory.AUTH, 'Auth store login error:', err)
      debugLog.error(DebugCategory.AUTH, 'Error response data:', err.response?.data)
      debugLog.error(DebugCategory.AUTH, 'Error status:', err.response?.status)
      error.value = err.response?.data?.message || 'Login failed'
      throw err
    } finally {
      isLoading.value = false
      debugLog.progress(DebugCategory.AUTH, 'Loading state set to false')
    }
  }

  const logout = async () => {
    try {
      // Call logout endpoint if token exists
      if (token.value) {
        await authService.logout()
      }
    } catch (err) {
      console.warn('Logout API call failed:', err)
    } finally {
      // Clear state regardless of API call result
      clearAuthData()
      router.push('/login')
    }
  }

  const refreshAccessToken = async () => {
    try {
      if (!refreshToken.value) {
        throw new Error('No refresh token available')
      }

      const response = await authService.refresh(refreshToken.value)
      
      // Backend wraps response in { success: true, data: { accessToken, refreshToken } }
      const responseData = response.data.data
      token.value = responseData.accessToken
      if (responseData.refreshToken) {
        refreshToken.value = responseData.refreshToken
        localStorage.setItem('refresh_token', refreshToken.value)
      }
      
      localStorage.setItem('access_token', token.value)
      
      return response.data
    } catch (err) {
      console.error('Token refresh failed:', err)
      clearAuthData()
      router.push('/login')
      throw err
    }
  }

  const forgotPassword = async (email) => {
    try {
      isLoading.value = true
      error.value = null
      
      const response = await authService.forgotPassword(email)
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Failed to send reset email'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const resetPassword = async (token, password) => {
    try {
      isLoading.value = true
      error.value = null
      
      const response = await authService.resetPassword(token, password)
      return response.data
    } catch (err) {
      error.value = err.response?.data?.message || 'Password reset failed'
      throw err
    } finally {
      isLoading.value = false
    }
  }

  const clearAuthData = () => {
    user.value = null
    token.value = null
    refreshToken.value = null
    error.value = null
    
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    localStorage.removeItem('user')
  }

  const initializeAuth = () => {
    // Restore user from localStorage if token exists
    if (token.value) {
      const storedUser = localStorage.getItem('user')
      if (storedUser) {
        try {
          user.value = JSON.parse(storedUser)
        } catch (err) {
          console.error('Failed to parse stored user data:', err)
          clearAuthData()
        }
      }
    }
  }

  const checkTokenExpiry = () => {
    if (!token.value) return false
    
    try {
      // Decode JWT token to check expiry
      const payload = JSON.parse(atob(token.value.split('.')[1]))
      const currentTime = Math.floor(Date.now() / 1000)
      
      // Check if token expires in the next 5 minutes
      return payload.exp - currentTime < 300
    } catch (err) {
      console.error('Failed to decode token:', err)
      return true // Assume expired if we can't decode
    }
  }

  const clearError = () => {
    error.value = null
  }

  // Initialize auth state on store creation
  initializeAuth()

  return {
    // State
    user,
    token,
    refreshToken,
    isLoading,
    error,
    
    // Getters
    isAuthenticated,
    userRole,
    userName,
    
    // Actions
    login,
    logout,
    refreshAccessToken,
    forgotPassword,
    resetPassword,
    clearAuthData,
    initializeAuth,
    checkTokenExpiry,
    clearError
  }
})