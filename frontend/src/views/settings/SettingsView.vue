<template>
  <div class="settings-view">
    <!-- Header Section -->
    <div class="settings-header">
      <v-container fluid>
        <div class="d-flex align-center justify-space-between mb-4">
          <div>
            <h1 class="text-h4 font-weight-bold mb-1">Settings</h1>
            <p class="text-body-1 text-medium-emphasis">
              Manage application settings and configurations
            </p>
          </div>
        </div>
      </v-container>
    </div>

    <!-- Settings Tabs -->
    <v-container fluid>
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
              <ApiCredentials />
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
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ApiCredentials from '@/components/settings/ApiCredentials.vue'
import debugLog, { DebugCategory } from '@/utils/debug'

const route = useRoute()
const router = useRouter()

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

<script>
import { watch } from 'vue'

export default {
  name: 'SettingsView'
}
</script>

<style scoped>
.settings-view {
  min-height: 100vh;
  background-color: #f5f5f5;
}

.settings-header {
  background: linear-gradient(135deg, #1976D2 0%, #1565C0 100%);
  color: white;
  padding: 2rem 0;
  margin-bottom: 2rem;
}

.settings-header h1,
.settings-header p {
  color: white;
}
</style>
