import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import debugLog, { DebugCategory } from '@/utils/debug'

// Lazy load components for better performance
const LoginView = () => import('@/views/auth/LoginView.vue')
const ForgotPasswordView = () => import('@/views/auth/ForgotPasswordView.vue')
const DashboardView = () => import('@/views/dashboard/DashboardView.vue')
const DevicesView = () => import('@/views/devices/DevicesView.vue')
const DeviceDetailView = () => import('@/views/devices/DeviceDetailView.vue')
const AutomationsView = () => import('@/views/automations/AutomationsView.vue')
const AutomationBuilderView = () => import('@/views/automations/AutomationBuilderView.vue')
const AutomationDetailView = () => import('@/views/automations/AutomationDetailView.vue')
const ScheduleView = () => import('@/views/schedule/ScheduleView.vue')
const ExecutionsView = () => import('@/views/executions/ExecutionsView.vue')
const ExecutionDetailView = () => import('@/views/executions/ExecutionDetailView.vue')
const SettingsView = () => import('@/views/settings/SettingsView.vue')

const routes = [
  // Default redirect
  {
    path: '/',
    redirect: '/dashboard'
  },

  // Auth routes (no auth required)
  {
    path: '/login',
    name: 'Login',
    component: LoginView,
    meta: { 
      requiresAuth: false,
      hideForAuth: true, // Hide from authenticated users
      title: 'Sign In'
    }
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: ForgotPasswordView,
    meta: { 
      requiresAuth: false,
      hideForAuth: true,
      title: 'Reset Password'
    }
  },

  // Protected routes (auth required)
  {
    path: '/dashboard',
    name: 'Dashboard',
    component: DashboardView,
    meta: { 
      requiresAuth: true,
      title: 'Dashboard',
      icon: 'mdi-view-dashboard'
    }
  },
  {
    path: '/devices',
    name: 'Devices',
    component: DevicesView,
    meta: { 
      requiresAuth: true,
      title: 'Devices',
      icon: 'mdi-router-wireless'
    }
  },
  {
    path: '/devices/:id',
    name: 'DeviceDetail',
    component: DeviceDetailView,
    meta: { 
      requiresAuth: true,
      title: 'Device Details',
      breadcrumb: [
        { text: 'Devices', to: '/devices' },
        { text: 'Device Details', disabled: true }
      ]
    }
  },
  {
    path: '/automations',
    name: 'Automations',
    component: AutomationsView,
    meta: { 
      requiresAuth: true,
      title: 'Automations',
      icon: 'mdi-auto-fix'
    }
  },
  {
    path: '/automations/builder',
    name: 'AutomationBuilder',
    component: AutomationBuilderView,
    meta: { 
      requiresAuth: true,
      title: 'Automation Builder',
      breadcrumb: [
        { text: 'Automations', to: '/automations' },
        { text: 'Builder', disabled: true }
      ]
    }
  },
  {
    path: '/automations/:id',
    name: 'AutomationDetail',
    component: AutomationDetailView,
    meta: { 
      requiresAuth: true,
      title: 'Automation Details',
      breadcrumb: [
        { text: 'Automations', to: '/automations' },
        { text: 'Details', disabled: true }
      ]
    }
  },
  {
    path: '/schedule',
    name: 'Schedule',
    component: ScheduleView,
    meta: { 
      requiresAuth: true,
      title: 'Schedule',
      icon: 'mdi-calendar-clock'
    }
  },
  {
    path: '/executions',
    name: 'Executions',
    component: ExecutionsView,
    meta: { 
      requiresAuth: true,
      title: 'Execution History',
      icon: 'mdi-history'
    }
  },
  {
    path: '/executions/:id',
    name: 'ExecutionDetail',
    component: ExecutionDetailView,
    meta: {
      requiresAuth: true,
      title: 'Execution Details',
      breadcrumb: [
        { text: 'Executions', to: '/executions' },
        { text: 'Details', disabled: true }
      ]
    }
  },
  {
    path: '/settings',
    name: 'Settings',
    component: SettingsView,
    meta: {
      requiresAuth: true,
      title: 'Settings',
      icon: 'mdi-cog'
    }
  },

  // 404 catch-all
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { 
      title: 'Page Not Found'
    }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    // Always scroll to top when changing routes
    if (savedPosition) {
      return savedPosition
    } else {
      return { top: 0 }
    }
  }
})

// Navigation guards
router.beforeEach(async (to, from, next) => {
  debugLog.progress(DebugCategory.ROUTER, `Navigating from ${from.path} to ${to.path}`)
  
  const authStore = useAuthStore()
  debugLog.progress(DebugCategory.ROUTER, 'Auth state check', {
    isAuthenticated: authStore.isAuthenticated,
    hasUser: !!authStore.user,
    hasToken: !!authStore.token
  })
  
  // Initialize auth state if not already done
  if (!authStore.user && authStore.token) {
    debugLog.progress(DebugCategory.ROUTER, 'Initializing auth state')
    authStore.initializeAuth()
  }

  // Check if route requires authentication
  if (to.meta.requiresAuth) {
    debugLog.progress(DebugCategory.ROUTER, 'Route requires auth')
    if (!authStore.isAuthenticated) {
      // Not authenticated, redirect to login
      debugLog.warn(DebugCategory.ROUTER, 'Not authenticated, redirecting to login')
      next({
        name: 'Login',
        query: { redirect: to.fullPath } // Save intended destination
      })
      return
    }

    // Check if token is about to expire and refresh if needed
    if (authStore.checkTokenExpiry()) {
      try {
        debugLog.progress(DebugCategory.ROUTER, 'Refreshing token')
        await authStore.refreshAccessToken()
      } catch (error) {
        debugLog.error(DebugCategory.ROUTER, 'Token refresh failed:', error)
        next({ name: 'Login' })
        return
      }
    }
  }

  // Redirect authenticated users away from auth pages
  if (to.meta.hideForAuth && authStore.isAuthenticated) {
    debugLog.progress(DebugCategory.ROUTER, 'Authenticated user accessing auth page, redirecting to dashboard')
    next({ name: 'Dashboard' })
    return
  }

  // Set page title
  if (to.meta.title) {
    document.title = `${to.meta.title} - Aruba Central Automation`
  }

  debugLog.success(DebugCategory.ROUTER, 'Navigation allowed')
  next()
})

// After navigation hook for analytics, etc.
router.afterEach((to, from) => {
  // Could add analytics tracking here
  console.log(`Navigated from ${from.path} to ${to.path}`)
})

export default router
