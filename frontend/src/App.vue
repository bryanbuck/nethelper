<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTheme } from 'vuetify'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import NotificationDisplay from '@/components/common/NotificationDisplay.vue'
import ChangePasswordDialog from '@/components/common/ChangePasswordDialog.vue'

const theme = useTheme()
const route = useRoute()
const authStore = useAuthStore()

const drawer = ref(false)
const changePasswordOpen = ref(false)
const appVersion = import.meta.env.VITE_APP_VERSION

const isAuthPage = computed(() => {
  return route.meta?.requiresAuth === false
})

const toggleTheme = () => {
  theme.global.name.value = theme.global.current.value.dark ? 'light' : 'dark'
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
          @click.stop="drawer = !drawer"
        ></v-app-bar-nav-icon>
        
        <v-toolbar-title>
          <v-icon class="mr-2">mdi-network</v-icon>
          NetHelper
          <v-chip size="x-small" variant="outlined" label class="ml-2" :title="`Version ${appVersion}`">Beta</v-chip>
        </v-toolbar-title>

        <v-spacer />

        <v-btn
          icon
          @click="toggleTheme"
        >
          <v-icon>
            {{ theme.global.current.value.dark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}
          </v-icon>
        </v-btn>

        <v-menu offset-y>
          <template #activator="{ props }">
            <v-btn
              icon
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
              <v-icon left>mdi-logout</v-icon>
              Sign Out
            </v-btn>
          </div>
        </template>
      </v-navigation-drawer>
    </template>

    <v-main>
      <router-view />
    </v-main>

    <!-- Footer only for authenticated pages -->
    <v-footer
      v-if="!isAuthPage && authStore.isAuthenticated"
      app
    >
      <v-spacer />
      <div class="text-caption text-medium-emphasis">NetHelper {{ appVersion }} · Beta</div>
      <v-spacer />
    </v-footer>

    <ChangePasswordDialog v-model="changePasswordOpen" />

    <!-- Global Notification Display -->
    <NotificationDisplay />
  </v-app>
</template>

<style scoped>
.v-application {
  font-family: 'Roboto', sans-serif;
}

/* Loading overlay */
.v-overlay {
  backdrop-filter: blur(2px);
}

/* Ensure app bar nav icon is visible */
:deep(.v-app-bar-nav-icon) {
  color: white !important;
}

:deep(.v-app-bar-nav-icon .v-icon) {
  opacity: 1 !important;
}
</style>