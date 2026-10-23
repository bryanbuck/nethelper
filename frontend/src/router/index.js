import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import debugLog, { DebugCategory } from '@/utils/debug'

// Lazy load components for better performance
const LoginView = () => import('@/views/auth/LoginView.vue')
const DashboardView = () => import('@/views/dashboard/DashboardView.vue')
const DevicesView = () => import('@/views/devices/DevicesView.vue')
const DeviceDetailView = () => import('@/views/devices/DeviceDetailView.vue')
const FirmwareStatusView = () => import('@/views/devices/FirmwareStatusView.vue')
const DeviceDiscoveryView = () => import('@/views/devices/DeviceDiscoveryView.vue')
const ConfigBackupsView = () => import('@/views/devices/ConfigBackupsView.vue')
const NetworkMapView = () => import('@/views/topology/NetworkMapView.vue')
const AutomationsView = () => import('@/views/automations/AutomationsView.vue')
const AutomationBuilderView = () => import('@/views/automations/AutomationBuilderView.vue')
const ExecutionsView = () => import('@/views/automations/ExecutionsView.vue')
const SettingsView = () => import('@/views/settings/SettingsView.vue')
const DeviceApiTestingView = () => import('@/views/settings/DeviceApiTestingView.vue')

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
    path: '/map',
    name: 'NetworkMap',
    component: NetworkMapView,
    meta: {
      requiresAuth: true,
      title: 'Network Map',
      icon: 'mdi-graph-outline'
    }
  },
  {
    path: '/alerts',
    name: 'Alerts',
    component: () => import('@/views/alerts/AlertsView.vue'),
    meta: {
      requiresAuth: true,
      title: 'Alerts',
      icon: 'mdi-bell'
    }
  },
  {
    path: '/devices/firmware',
    name: 'FirmwareStatus',
    component: FirmwareStatusView,
    meta: {
      requiresAuth: true,
      title: 'Firmware Status',
      icon: 'mdi-chip',
      breadcrumb: [
        { text: 'Devices', to: '/devices' },
        { text: 'Firmware Status', disabled: true }
      ]
    }
  },
  {
    path: '/devices/discovery',
    name: 'DeviceDiscovery',
    component: DeviceDiscoveryView,
    meta: {
      requiresAuth: true,
      title: 'Device Discovery',
      icon: 'mdi-radar',
      breadcrumb: [
        { text: 'Devices', to: '/devices' },
        { text: 'Device Discovery', disabled: true }
      ]
    }
  },
  {
    path: '/devices/backups',
    name: 'ConfigBackups',
    component: ConfigBackupsView,
    meta: {
      requiresAuth: true,
      title: 'Config Backups',
      icon: 'mdi-backup-restore',
      breadcrumb: [
        { text: 'Devices', to: '/devices' },
        { text: 'Config Backups', disabled: true }
      ]
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
    path: '/automations/executions',
    name: 'AutomationExecutions',
    component: ExecutionsView,
    meta: {
      requiresAuth: true,
      title: 'Run History',
      breadcrumb: [
        { text: 'Automations', to: '/automations' },
        { text: 'Run History', disabled: true }
      ]
    }
  },
  {
    path: '/automations/builder/:id?',
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
    path: '/settings',
    name: 'Settings',
    component: SettingsView,
    meta: {
      requiresAuth: true,
      title: 'Settings',
      icon: 'mdi-cog'
    }
  },
  {
    path: '/users',
    name: 'Users',
    component: () => import('@/views/users/UsersView.vue'),
    meta: {
      requiresAuth: true,
      requiresRole: 'admin',
      title: 'Users',
      icon: 'mdi-account-multiple'
    }
  },
  {
    path: '/system',
    name: 'SystemStatus',
    component: () => import('@/views/system/SystemStatusView.vue'),
    meta: {
      requiresAuth: true,
      requiresRole: 'admin',
      title: 'System Status',
      icon: 'mdi-monitor-dashboard'
    }
  },
  {
    path: '/settings/device-api-testing',
    name: 'DeviceApiTesting',
    component: DeviceApiTestingView,
    meta: {
      requiresAuth: true,
      title: 'Device API Testing',
      icon: 'mdi-test-tube',
      breadcrumb: [
        { text: 'Settings', to: '/settings' },
        { text: 'Device API Testing', disabled: true }
      ]
    }
  },

  // 404 catch-all
  // Automation scheduling/execution pages are not built yet (automation is
  // experimental for the beta); send old bookmarks to the automations list.
  { path: '/schedule', redirect: '/automations' },
  { path: '/executions/:pathMatch(.*)*', redirect: '/automations/executions' },
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

  // Role-restricted pages. The API enforces roles regardless; this only keeps
  // people off pages whose every request would be refused.
  if (to.meta.requiresRole && authStore.user?.role !== to.meta.requiresRole) {
    debugLog.warn(DebugCategory.ROUTER, `Route requires role ${to.meta.requiresRole}, redirecting to dashboard`)
    next({ name: 'Dashboard' })
    return
  }

  // Redirect authenticated users away from auth pages
  if (to.meta.hideForAuth && authStore.isAuthenticated) {
    debugLog.progress(DebugCategory.ROUTER, 'Authenticated user accessing auth page, redirecting to dashboard')
    next({ name: 'Dashboard' })
    return
  }

  // Set page title
  if (to.meta.title) {
    document.title = `${to.meta.title} - NetHelper`
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
