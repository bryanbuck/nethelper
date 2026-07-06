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
            <v-tab value="general">
              <v-icon start>mdi-cog</v-icon>
              General
            </v-tab>
            <v-tab value="notifications">
              <v-icon start>mdi-bell</v-icon>
              Notifications
            </v-tab>
            <v-tab value="advanced">
              <v-icon start>mdi-tune</v-icon>
              Advanced
            </v-tab>
          </v-tabs>

          <v-divider></v-divider>

          <v-window v-model="activeTab">
            <!-- API Credentials Tab -->
            <v-window-item value="credentials">
              <v-card-text>
                <!-- Aruba Central API Credentials Section -->
                <ErrorBoundary :show-details="isDevelopment">
                  <ArubaCentralCredentials />
                </ErrorBoundary>

                <!-- Divider between sections -->
                <v-divider class="my-8"></v-divider>

                <!-- Device API Credentials Section -->
                <ErrorBoundary :show-details="isDevelopment">
                  <ApiCredentials />
                </ErrorBoundary>
              </v-card-text>
            </v-window-item>

            <!-- General Settings Tab -->
            <v-window-item value="general">
              <v-card-text>
                <div class="text-h6 mb-4">General Settings</div>
                <p class="text-medium-emphasis">
                  General application settings will be available here in future updates.
                </p>
              </v-card-text>
            </v-window-item>

            <!-- Notifications Tab -->
            <v-window-item value="notifications">
              <v-card-text>
                <div class="text-h6 mb-4">Notification Settings</div>
                <p class="text-medium-emphasis">
                  Notification preferences will be available here in future updates.
                </p>
              </v-card-text>
            </v-window-item>

            <!-- Advanced Settings Tab -->
            <v-window-item value="advanced">
              <v-card-text>
                <div class="text-h6 mb-4">Advanced Settings</div>
                <p class="text-medium-emphasis">
                  Advanced configuration options will be available here in future updates.
                </p>
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
import ArubaCentralCredentials from '@/components/settings/ArubaCentralCredentials.vue'
import ApiCredentials from '@/components/settings/ApiCredentials.vue'
import debugLog, { DebugCategory } from '@/utils/debug'

const route = useRoute()
const router = useRouter()

const isDevelopment = computed(() => import.meta.env.DEV)

// Active tab state - defaults to 'credentials' or route query param
const activeTab = ref(route.query.tab || 'credentials')

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
