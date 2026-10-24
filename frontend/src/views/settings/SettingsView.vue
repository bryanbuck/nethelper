<template>
  <ErrorBoundary :show-details="isDevelopment">
    <div class="settings-view">
      <v-container fluid class="pa-4">
        <!-- Header Section -->
        <div class="d-flex align-center justify-space-between mb-6">
          <div>
            <h1 class="text-h4 font-weight-bold mb-1">Settings</h1>
            <p class="text-subtitle-1 text-medium-emphasis mb-0">
              Manage application settings and configurations
            </p>
          </div>
        </div>

        <!-- Settings Tabs -->
        <v-card>
          <v-tabs
            v-model="activeTab"
            bg-color="primary"
            align-tabs="start"
          >
            <v-tab value="credentials">
              <v-icon start>mdi-key-variant</v-icon>
              API Credentials
            </v-tab>
            <v-tab value="alerts">
              <v-icon start>mdi-bell</v-icon>
              Alerts
            </v-tab>
            <v-tab v-if="canTest" value="testing">
              <v-icon start>mdi-test-tube</v-icon>
              Connection Test
            </v-tab>
          </v-tabs>

          <v-divider></v-divider>

          <v-window v-model="activeTab">
            <!-- API Credentials Tab -->
            <v-window-item value="credentials">
              <v-card-text>
                <!-- Cloud Integrations (Central / Mist / Meraki) -->
                <ErrorBoundary :show-details="isDevelopment">
                  <CloudIntegrations />
                </ErrorBoundary>

                <!-- Divider between sections -->
                <v-divider class="my-8"></v-divider>

                <!-- Device API Credentials Section -->
                <ErrorBoundary :show-details="isDevelopment">
                  <ApiCredentials />
                </ErrorBoundary>

                <!-- Configuration backup Git mirror (admin only, like its API) -->
                <template v-if="authStore.isAdmin">
                  <v-divider class="my-8"></v-divider>
                  <ErrorBoundary :show-details="isDevelopment">
                    <GitBackupSettings />
                  </ErrorBoundary>
                </template>
              </v-card-text>
            </v-window-item>

            <!-- Alerts Tab -->
            <v-window-item value="alerts">
              <v-card-text>
                <ErrorBoundary :show-details="isDevelopment">
                  <AlertRules />
                </ErrorBoundary>
              </v-card-text>
            </v-window-item>

            <!-- Manual connection test (POST /device-api/test-manual is operator+) -->
            <v-window-item v-if="canTest" value="testing">
              <v-card-text>
                <ErrorBoundary :show-details="isDevelopment">
                  <DeviceApiTestingView />
                </ErrorBoundary>
              </v-card-text>
            </v-window-item>
          </v-window>
        </v-card>
      </v-container>
    </div>
  </ErrorBoundary>
</template>

<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ErrorBoundary from '@/components/common/ErrorBoundary.vue'
import CloudIntegrations from '@/components/settings/CloudIntegrations.vue'
import GitBackupSettings from '@/components/settings/GitBackupSettings.vue'
import ApiCredentials from '@/components/settings/ApiCredentials.vue'
import AlertRules from '@/components/settings/AlertRules.vue'
import DeviceApiTestingView from '@/views/settings/DeviceApiTestingView.vue'
import { useAuthStore } from '@/stores/auth'
import debugLog, { DebugCategory } from '@/utils/debug'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const isDevelopment = computed(() => import.meta.env.DEV)

const canTest = computed(() => ['admin', 'operator'].includes(authStore.userRole))

// Active tab state - defaults to 'credentials' or route query param (an old
// or unavailable tab, e.g. the removed General/Advanced, falls back)
const tabs = computed(() => ['credentials', 'alerts', ...(canTest.value ? ['testing'] : [])])
const activeTab = ref(tabs.value.includes(route.query.tab) ? route.query.tab : 'credentials')

// Watch for tab changes and update URL
const updateUrlTab = (tab) => {
  if (route.query.tab !== tab) {
    router.replace({ query: { tab } })
  }
}

// Update URL when tab changes
watch(() => activeTab.value, (newTab) => {
  updateUrlTab(newTab)
  debugLog.progress(DebugCategory.SETTINGS, `Switched to ${newTab} tab`)
})

onMounted(() => {
  debugLog.progress(DebugCategory.SETTINGS, 'Settings view mounted', { activeTab: activeTab.value })
})
</script>

<style scoped>
.settings-view {
  background-color: rgb(var(--v-theme-background));
  min-height: 100vh;
}

/* Fix tab text visibility - ensure active tab text is visible */
:deep(.v-tab.v-tab--selected) {
  color: white !important;
}

:deep(.v-tab) {
  color: rgba(255, 255, 255, 0.7);
}

:deep(.v-tab:hover) {
  color: rgba(255, 255, 255, 0.9);
}
</style>
