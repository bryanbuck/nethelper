<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTheme } from 'vuetify'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import StatusBar from '@/components/common/StatusBar.vue'
import ChangePasswordDialog from '@/components/common/ChangePasswordDialog.vue'
import AlertBell from '@/components/common/AlertBell.vue'
import { THEMES, writeThemePreference } from '@/utils/theme-preference'
import { defaultsForTheme } from '@/plugins/theme-defaults'

const theme = useTheme()
const route = useRoute()
const authStore = useAuthStore()

const drawer = ref(false)
const changePasswordOpen = ref(false)
const appVersion = import.meta.env.VITE_APP_VERSION

const isAuthPage = computed(() => {
  return route.meta?.requiresAuth === false
})

const currentTheme = computed(() => THEMES.find((t) => t.id === theme.global.name.value) || THEMES[0])
const themeDefaults = computed(() => defaultsForTheme(theme.global.name.value))
// The global VBtn default is color: 'primary', which vanishes on the primary app
// bar. Vuetify has no text-on-* class, so pass the token as a CSS color.
const onPrimary = 'rgb(var(--v-theme-on-primary))'

const selectTheme = (id) => {
  theme.global.name.value = id
  writeThemePreference(id)
}

const logout = async () => {
  try {
    await authStore.logout()
  } catch (error) {
    console.error('Logout error:', error)
  }
}

const allNavigationItems = [
  {
    title: 'Dashboard',
    icon: 'mdi-view-dashboard',
    to: '/dashboard'
  },
  {
    title: 'Devices',
    icon: 'mdi-router-wireless',
    to: '/devices'
  },
  {
    title: 'Network Map',
    icon: 'mdi-graph-outline',
    to: '/map'
  },
  {
    title: 'Activity',
    icon: 'mdi-timeline-clock-outline',
    to: '/activity'
  },
  {
    title: 'Alerts',
    icon: 'mdi-bell',
    to: '/alerts'
  },
  {
    title: 'Discovery',
    icon: 'mdi-radar',
    to: '/devices/discovery'
  },
  {
    title: 'Config Backups',
    icon: 'mdi-backup-restore',
    to: '/devices/backups'
  },
  {
    title: 'Automations',
    icon: 'mdi-cogs',
    to: '/automations',
    badge: 'Experimental'
  },
  {
    title: 'Users',
    icon: 'mdi-account-multiple',
    to: '/users',
    adminOnly: true
  },
  {
    title: 'System Status',
    icon: 'mdi-monitor-dashboard',
    to: '/system',
    adminOnly: true
  },
  {
    title: 'Settings',
    icon: 'mdi-cog',
    to: '/settings'
  }
]

const navigationItems = computed(() =>
  allNavigationItems.filter((item) => !item.adminOnly || authStore.isAdmin)
)

// Initialize auth on app mount
onMounted(() => {
  authStore.initializeAuth()
})
</script>

<template>
  <v-app>
    <v-defaults-provider :defaults="themeDefaults">
      <!-- Auth pages don't show navigation -->
      <template v-if="!isAuthPage && authStore.isAuthenticated">
        <v-app-bar
          app
          color="primary"
          dark
          elevation="2"
        >
          <v-app-bar-nav-icon
            icon="mdi-menu"
            :color="onPrimary"
            @click.stop="drawer = !drawer"
          ></v-app-bar-nav-icon>
        
          <v-toolbar-title>
            <v-icon class="mr-2">mdi-network</v-icon>
            NetHelper
            <v-chip size="x-small" variant="outlined" label class="ml-2" :title="`Version ${appVersion}`">Beta</v-chip>
          </v-toolbar-title>

          <v-spacer />

          <AlertBell :color="onPrimary" />

          <v-menu>
            <template #activator="{ props }">
              <v-btn
                icon
                :color="onPrimary"
                v-bind="props"
                :title="`Theme: ${currentTheme.label}`"
              >
                <v-icon>mdi-palette</v-icon>
              </v-btn>
            </template>

            <v-list>
              <v-list-subheader>Theme</v-list-subheader>
              <v-list-item
                v-for="t in THEMES"
                :key="t.id"
                :prepend-icon="t.icon"
                :title="t.label"
                :active="t.id === currentTheme.id"
                color="primary"
                @click="selectTheme(t.id)"
              />
            </v-list>
          </v-menu>

          <v-menu offset-y>
            <template #activator="{ props }">
              <v-btn
                icon
                :color="onPrimary"
                v-bind="props"
              >
                <v-icon>mdi-account-circle</v-icon>
              </v-btn>
            </template>
          
            <v-list>
              <v-list-item>
                <v-list-item-title>{{ authStore.userName }}</v-list-item-title>
                <v-list-item-subtitle>{{ authStore.user?.email }} · {{ authStore.userRole }}</v-list-item-subtitle>
              </v-list-item>

              <v-divider />

              <v-list-item @click="changePasswordOpen = true">
                <template #prepend>
                  <v-icon>mdi-lock-reset</v-icon>
                </template>
                <v-list-item-title>Change password</v-list-item-title>
              </v-list-item>

              <v-list-item @click="logout">
                <template #prepend>
                  <v-icon>mdi-logout</v-icon>
                </template>
                <v-list-item-title>Sign Out</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </v-app-bar>

        <v-navigation-drawer
          v-model="drawer"
          app
          temporary
        >
          <v-list>
            <v-list-item
              :title="authStore.userName"
              :subtitle="authStore.user?.email"
            >
              <template #prepend>
                <v-avatar color="primary">
                  <v-icon>mdi-account</v-icon>
                </v-avatar>
              </template>
            </v-list-item>
          </v-list>

          <v-divider />

          <v-list density="compact" nav>
            <v-list-item
              v-for="item in navigationItems"
              :key="item.title"
              :prepend-icon="item.icon"
              :title="item.title"
              :to="item.to"
              color="primary"
            >
              <template v-if="item.badge" #append>
                <v-chip size="x-small" color="warning" variant="tonal" label>{{ item.badge }}</v-chip>
              </template>
            </v-list-item>
          </v-list>

          <template #append>
            <div class="pa-2">
              <v-btn
                block
                color="error"
                variant="outlined"
                @click="logout"
              >
                <v-icon start>mdi-logout</v-icon>
                Sign Out
              </v-btn>
            </div>
          </template>
        </v-navigation-drawer>
      </template>

      <v-main>
        <router-view />
      </v-main>

      <!-- Status bar (activity log + version) only for authenticated pages -->
      <StatusBar
        v-if="!isAuthPage && authStore.isAuthenticated"
        :version="appVersion"
      />

      <ChangePasswordDialog v-model="changePasswordOpen" />
    </v-defaults-provider>
  </v-app>
</template>

<style scoped>
/* Loading overlay */
.v-overlay {
  backdrop-filter: blur(2px);
}
</style>