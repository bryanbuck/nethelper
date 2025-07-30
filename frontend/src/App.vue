<script setup>
import { ref, computed, onMounted } from 'vue'
import { useTheme } from 'vuetify'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const theme = useTheme()
const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

const drawer = ref(false)

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

const navigationItems = [
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
    title: 'Automations',
    icon: 'mdi-cogs',
    to: '/automations'
  },
  {
    title: 'Schedule',
    icon: 'mdi-calendar',
    to: '/schedule'
  },
  {
    title: 'Executions',
    icon: 'mdi-history',
    to: '/executions'
  }
]

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
          variant="text"
          @click.stop="drawer = !drawer"
        />
        
        <v-toolbar-title>
          <v-icon class="mr-2">mdi-network</v-icon>
          NetHelper
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

        <v-btn icon>
          <v-icon>mdi-bell</v-icon>
        </v-btn>

        <v-menu offset-y>
          <template v-slot:activator="{ props }">
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
              <v-list-item-subtitle>{{ authStore.user?.email }}</v-list-item-subtitle>
            </v-list-item>
            
            <v-divider />
            
            <v-list-item @click="logout">
              <template v-slot:prepend>
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
            :title="authStore.userName || 'Network Admin'"
            :subtitle="authStore.user?.email || 'admin@company.com'"
          >
            <template v-slot:prepend>
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
          />
        </v-list>

        <template v-slot:append>
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
      <div>&copy; {{ new Date().getFullYear() }} — NetHelper Automation Platform</div>
      <v-spacer />
    </v-footer>
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
</style>