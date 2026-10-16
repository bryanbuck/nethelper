import axios from 'axios'
import router from '@/router'
import { THEME_STORAGE_KEY } from '@/utils/theme-preference'

// Create axios instance with base configuration
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// On an unrecoverable auth failure, drop everything stored for the session but
// keep the viewer's theme choice (a display preference, not session data).
const clearSessionStorage = () => {
  const theme = localStorage.getItem(THEME_STORAGE_KEY)
  localStorage.clear()
  if (theme) localStorage.setItem(THEME_STORAGE_KEY, theme)
}

// Flag to prevent multiple token refresh attempts
let isRefreshing = false
let failedQueue = []

const processQueue = (error, token = null) => {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error)
    } else {
      resolve(token)
    }
  })
  
  failedQueue = []
}

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor for token refresh and error handling
api.interceptors.response.use(
  (response) => {
    return response
  },
  async (error) => {
    const originalRequest = error.config

    // A 401 from login/refresh means bad credentials or a dead refresh token,
    // not an expired session, so it must not enter the refresh flow.
    const isAuthEndpoint = /\/auth\/(login|refresh)$/.test(originalRequest?.url || '')

    // Handle 401 Unauthorized errors
    if (error.response?.status === 401 && !isAuthEndpoint && !originalRequest._retry) {
      if (isRefreshing) {
        // If already refreshing, queue the request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(token => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        }).catch(err => {
          return Promise.reject(err)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      const refreshToken = localStorage.getItem('refresh_token')
      
      if (!refreshToken) {
        // No refresh token, redirect to login. Reset the flag here too: this
        // early return skips the finally below, and a stuck flag would park
        // every later 401 in failedQueue forever.
        isRefreshing = false
        processQueue(error, null)
        clearSessionStorage()
        router.push('/login')
        return Promise.reject(error)
      }

      try {
        // Attempt to refresh the token
        const response = await axios.post(`${api.defaults.baseURL}/auth/refresh`, {
          refreshToken: refreshToken
        })

        const { accessToken, refreshToken: newRefreshToken } = response.data.data

        // Update stored tokens
        localStorage.setItem('access_token', accessToken)
        if (newRefreshToken) {
          localStorage.setItem('refresh_token', newRefreshToken)
        }

        // Update default authorization header
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`
        
        // Process queued requests
        processQueue(null, accessToken)
        
        // Retry original request
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return api(originalRequest)
        
      } catch (refreshError) {
        // Refresh failed, clear auth data and redirect
        processQueue(refreshError, null)
        clearSessionStorage()
        router.push('/login')
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }

    // Handle other error statuses
    if (error.response?.status === 403) {
      // Forbidden - user doesn't have permission
      console.error('Access forbidden:', error.response.data)
    } else if (error.response?.status === 404) {
      // Not found
      console.error('Resource not found:', error.response.data)
    } else if (error.response?.status >= 500) {
      // Server error
      console.error('Server error:', error.response.data)
    }

    return Promise.reject(error)
  }
)

// Request timeout interceptor
api.interceptors.request.use(
  (config) => {
    // Add request timestamp for debugging
    config.metadata = { startTime: new Date() }
    return config
  },
  (error) => Promise.reject(error)
)

api.interceptors.response.use(
  (response) => {
    // Calculate request duration for debugging
    if (response.config.metadata) {
      response.config.metadata.endTime = new Date()
      response.duration = response.config.metadata.endTime - response.config.metadata.startTime
    }
    return response
  },
  (error) => {
    if (error.config?.metadata) {
      error.config.metadata.endTime = new Date()
      error.duration = error.config.metadata.endTime - error.config.metadata.startTime
    }
    return Promise.reject(error)
  }
)

export default api