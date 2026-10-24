<template>
  <div>
    <div class="d-flex align-center mb-2">
      <div>
        <div class="text-h6">Alert Rules</div>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Built-in conditions that raise alerts. Each opens one alert per device (or port, integration, scope) and
          resolves it when the condition clears. A settle time holds a new condition back until it has lasted that long,
          so brief bounces never become alerts.
        </p>
      </div>
    </div>
    <p v-if="!authStore.isAdmin" class="text-caption text-medium-emphasis">
      Only administrators can change alert rules.
    </p>
    <p class="text-caption text-medium-emphasis">
      To send alerts by email or to a webhook as well, add a channel under <strong>Notifications</strong> (administrators).
      Live-monitor rules apply only to devices with <strong>Always monitor</strong> on.
    </p>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">{{ loadError }}</v-alert>

    <v-table density="comfortable">
      <thead>
        <tr>
          <th>Rule</th>
          <th style="width: 110px">Enabled</th>
          <th style="width: 170px">Severity</th>
          <th style="width: 170px">Settle time</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="loading && !rows.length">
          <td colspan="4" class="text-center py-6"><v-progress-circular indeterminate size="24" /></td>
        </tr>
        <tr v-for="rule in rows" :key="rule.key">
          <td class="py-2">
            <div class="font-weight-medium">{{ rule.label }}</div>
            <div class="text-caption text-medium-emphasis">{{ rule.description }}</div>
          </td>
          <td>
            <v-switch
              :model-value="rule.enabled"
              color="primary"
              density="compact"
              hide-details
              inset
              :disabled="!authStore.isAdmin || saving === rule.key"
              @update:model-value="(v) => save(rule, { enabled: v })"
            />
          </td>
          <td>
            <v-select
              :model-value="rule.severity"
              :items="ALERT_SEVERITIES"
              item-title="title"
              item-value="value"
              density="compact"
              hide-details
              :disabled="!authStore.isAdmin || saving === rule.key"
              @update:model-value="(v) => save(rule, { severity: v })"
            >
              <template #selection="{ item }">
                <v-icon :color="item.raw.color" size="small" class="mr-2">{{ item.raw.icon }}</v-icon>
                {{ item.raw.title }}
              </template>
            </v-select>
          </td>
          <td>
            <v-text-field
              :model-value="rule.settleSeconds"
              type="number"
              min="0"
              max="3600"
              suffix="s"
              density="compact"
              hide-details="auto"
              :rules="[settleRule]"
              :disabled="!authStore.isAdmin || saving === rule.key"
              @change="(e) => onSettle(rule, e.target.value)"
            />
          </td>
        </tr>
      </tbody>
    </v-table>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAlertsStore } from '@/stores/alerts'
import { useAuthStore } from '@/stores/auth'
import { useNotificationsStore } from '@/stores/notifications'
import { ALERT_SEVERITIES } from '@/models/alerts'

const alertsStore = useAlertsStore()
const authStore = useAuthStore()
const notifications = useNotificationsStore()

const loading = ref(false)
const loadError = ref(null)
const saving = ref(null)
const rows = computed(() => alertsStore.rules)

const settleRule = (value) => {
  const n = Number(value)
  return (Number.isInteger(n) && n >= 0 && n <= 3600) || 'Whole seconds, 0–3600'
}

async function save(rule, patch) {
  saving.value = rule.key
  try {
    await alertsStore.updateRule(rule.key, patch)
    notifications.showSuccess(`Saved "${rule.label}"`)
  } catch (error) {
    notifications.showError(error.userMessage || error.message || 'Failed to save the rule')
  } finally {
    saving.value = null
  }
}

function onSettle(rule, value) {
  if (settleRule(value) !== true || Number(value) === rule.settleSeconds) return
  save(rule, { settleSeconds: Number(value) })
}

onMounted(async () => {
  loading.value = true
  try {
    await alertsStore.fetchRules()
  } catch (error) {
    loadError.value = error.userMessage || error.message || 'Failed to load alert rules'
  } finally {
    loading.value = false
  }
})
</script>
