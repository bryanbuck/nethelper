<template>
  <div>
    <div class="d-flex flex-wrap align-center ga-2 mb-2">
      <div class="flex-grow-1">
        <div class="text-h6">Notification channels</div>
        <p class="text-body-2 text-medium-emphasis mb-0">
          Send alerts outside the app, by email or to a webhook (Slack, Teams, or anything that takes a JSON POST).
          Each channel gets one message when a matching alert opens and one when it resolves; repeats of an open
          alert don't send again. A channel can also send the alarms Aruba Central and Juniper Mist raise themselves.
        </p>
      </div>
      <v-btn color="primary" prepend-icon="mdi-plus" class="ml-sm-2" @click="openEditor(null)">Add channel</v-btn>
    </div>

    <v-alert v-if="!store.emailConfigured && hasEmailChannel" type="warning" variant="tonal" density="compact" class="my-4">
      Email isn't set up on the server, so email channels can't deliver. Set <code>SMTP_HOST</code> (and
      <code>SMTP_USER</code>/<code>SMTP_PASS</code> if your mail server needs a login) as described in
      <code>docs/CONFIGURATION.md</code>, then restart the backend.
    </v-alert>

    <v-alert v-if="store.error" type="error" variant="tonal" class="my-4">
      {{ store.error.userMessage || store.error.message || 'Could not load notification channels' }}
    </v-alert>

    <div v-if="store.loading && !store.channels.length" class="text-center py-6">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <div v-else-if="!store.channels.length" class="text-center text-medium-emphasis py-6">
      No channels yet. Alerts show in the app only.
    </div>

    <v-table v-else class="table-stack mt-2">
      <thead>
        <tr>
          <th>Name</th>
          <th>Sends to</th>
          <th>Alerts</th>
          <th>Last delivery</th>
          <th style="width: 90px">Enabled</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="channel in store.channels" :key="channel.id">
          <td>
            <v-icon size="small" class="mr-1">{{ channel.type === 'email' ? 'mdi-email-outline' : 'mdi-webhook' }}</v-icon>
            <span class="font-weight-medium">{{ channel.name }}</span>
          </td>
          <td class="text-body-2" data-label="Sends to">
            <template v-if="channel.type === 'email'">{{ channel.config.recipients.join(', ') }}</template>
            <template v-else>
              {{ channel.config.urlHint }}
              <v-chip v-if="channel.config.insecure" size="x-small" color="warning" variant="tonal" class="ml-1">http</v-chip>
            </template>
          </td>
          <td class="text-body-2" data-label="Alerts">
            {{ severityLabel(channel.minSeverity) }} and up ·
            {{ channel.rules.length ? channel.rules.map(ruleLabel).join(', ') : 'all rules' }}
            <div v-if="channel.cloudAlarms" class="text-caption text-medium-emphasis">
              + cloud alarms{{ channel.cloudAlarmNames?.length ? `: ${channel.cloudAlarmNames.join(', ')}` : '' }}
            </div>
          </td>
          <td class="text-body-2" data-label="Last delivery">
            <template v-if="channel.lastDeliveryAt">
              <v-icon
                size="small"
                :color="channel.lastDeliveryStatus === 'success' ? 'success' : 'error'"
              >
                {{ channel.lastDeliveryStatus === 'success' ? 'mdi-check-circle' : 'mdi-alert-circle' }}
              </v-icon>
              {{ ago(channel.lastDeliveryAt) }}
              <div v-if="channel.lastDeliveryError" class="text-caption text-error">{{ channel.lastDeliveryError }}</div>
            </template>
            <span v-else class="text-medium-emphasis">Never</span>
          </td>
          <td data-label="Enabled">
            <v-switch
              :model-value="channel.enabled"
              color="primary"
              density="compact"
              hide-details
              :aria-label="`${channel.enabled ? 'Disable' : 'Enable'} ${channel.name}`"
              @update:model-value="setEnabled(channel, $event)"
            />
          </td>
          <td class="text-right text-no-wrap">
            <v-btn
              variant="text"
              size="small"
              prepend-icon="mdi-send"
              :loading="testing === channel.id"
              @click="sendTest(channel)"
            >
              Test
            </v-btn>
            <v-btn icon="mdi-pencil" variant="text" size="small" :aria-label="`Edit ${channel.name}`" @click="openEditor(channel)" />
            <v-btn icon="mdi-delete" variant="text" size="small" color="error" :aria-label="`Delete ${channel.name}`" @click="deleteTarget = channel" />
          </td>
        </tr>
      </tbody>
    </v-table>

    <!-- Add / edit -->
    <v-dialog v-model="editorOpen" max-width="620" :fullscreen="$vuetify.display.xs" scrollable>
      <v-card v-if="draft">
        <v-card-title>{{ draft.id ? `Edit "${draft.originalName}"` : 'Add notification channel' }}</v-card-title>
        <v-card-text>
          <v-form ref="form" @submit.prevent="save">
            <v-text-field
              v-model="draft.name"
              label="Name"
              variant="outlined"
              density="compact"
              :rules="[(v) => !!v?.trim() || 'A name is required']"
            />

            <v-btn-toggle
              v-model="draft.type"
              mandatory
              density="compact"
              variant="outlined"
              color="primary"
              class="mb-4"
              :disabled="!!draft.id"
            >
              <v-btn value="email" prepend-icon="mdi-email-outline">Email</v-btn>
              <v-btn value="webhook" prepend-icon="mdi-webhook">Webhook</v-btn>
            </v-btn-toggle>

            <template v-if="draft.type === 'email'">
              <v-combobox
                v-model="draft.recipients"
                label="Recipients"
                hint="Type an address and press Enter"
                persistent-hint
                multiple
                chips
                closable-chips
                variant="outlined"
                density="compact"
                :rules="[(v) => (v && v.length > 0) || 'Add at least one recipient']"
              />
            </template>

            <template v-else>
              <v-text-field
                v-model="draft.url"
                label="Webhook URL"
                :placeholder="draft.id ? `${draft.urlHint} (unchanged)` : 'https://hooks.slack.com/services/…'"
                :hint="draft.id ? 'Leave blank to keep the stored URL' : 'Stored encrypted; only its host is shown afterwards'"
                persistent-hint
                variant="outlined"
                density="compact"
                :rules="[urlRule]"
              />
              <v-alert v-if="draft.url?.startsWith('http:')" type="warning" variant="tonal" density="compact" class="mt-2">
                Plain http sends alert details unencrypted. Use https if the receiver supports it.
              </v-alert>

              <div class="text-subtitle-2 mt-4 mb-2">Headers (optional)</div>
              <div v-for="(header, index) in draft.headers" :key="index" class="d-flex ga-2 align-center">
                <v-text-field
                  v-model="header.name"
                  label="Name"
                  variant="outlined"
                  density="compact"
                  :rules="[(v) => /^[A-Za-z0-9-]+$/.test(v || '') || 'Letters, digits and dashes']"
                />
                <v-text-field
                  v-model="header.value"
                  label="Value"
                  :placeholder="header.stored ? '(unchanged)' : ''"
                  variant="outlined"
                  density="compact"
                  type="password"
                />
                <v-btn icon="mdi-close" variant="text" size="small" aria-label="Remove header" class="mb-5" @click="draft.headers.splice(index, 1)" />
              </div>
              <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="draft.headers.push({ name: '', value: '', stored: false })">
                Add header
              </v-btn>
            </template>

            <v-select
              v-model="draft.minSeverity"
              :items="severityItems"
              label="Send alerts of at least"
              variant="outlined"
              density="compact"
              class="mt-4"
            />
            <v-select
              v-model="draft.rules"
              :items="ruleItems"
              label="Only these rules"
              hint="Leave empty for every built-in rule (alerts raised by automations only when picked)"
              persistent-hint
              multiple
              chips
              closable-chips
              variant="outlined"
              density="compact"
            />

            <v-switch
              v-model="draft.cloudAlarms"
              label="Also send cloud alarms"
              color="primary"
              density="compact"
              hide-details
              class="mt-4"
            />
            <div class="text-caption text-medium-emphasis mb-2">
              Alarms Aruba Central or Juniper Mist raise themselves (for example Central's Port Flap), once when
              raised and once when they clear. The severity above applies. Acknowledge and clear them in the cloud.
            </div>
            <v-combobox
              v-if="draft.cloudAlarms"
              v-model="draft.cloudAlarmNames"
              :items="cloudAlarmNameItems"
              label="Only these cloud alarms"
              hint="Leave empty for every cloud alarm. Names as the cloud shows them; case, spaces and underscores don't matter."
              persistent-hint
              multiple
              chips
              closable-chips
              variant="outlined"
              density="compact"
            />
            <v-switch v-model="draft.enabled" label="Enabled" color="primary" density="compact" hide-details class="mt-2" />
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editorOpen = false">Cancel</v-btn>
          <v-btn color="primary" :loading="saving" @click="save">{{ draft.id ? 'Save' : 'Add' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="!!deleteTarget" max-width="440" @update:model-value="deleteTarget = null">
      <v-card>
        <v-card-title>Delete channel</v-card-title>
        <v-card-text>Delete <strong>{{ deleteTarget?.name }}</strong>? Alerts stop going there.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteTarget = null">Cancel</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { formatDistanceToNow } from 'date-fns'
import { useNotificationChannelsStore } from '@/stores/notificationChannels'
import { useNotificationsStore } from '@/stores/notifications'
import { ALERT_SEVERITIES, ALERT_RULE_LABELS } from '@/models/alerts'

const SECRET_MASK = '***'

const store = useNotificationChannelsStore()
const notifications = useNotificationsStore()

const hasEmailChannel = computed(() => store.channels.some((c) => c.type === 'email'))
const severityItems = [...ALERT_SEVERITIES].reverse().map((s) => ({ title: s.title, value: s.value }))
const ruleItems = Object.entries(ALERT_RULE_LABELS).map(([value, title]) => ({ title, value }))
const severityLabel = (value) => ALERT_SEVERITIES.find((s) => s.value === value)?.title || value
const ruleLabel = (rule) => ALERT_RULE_LABELS[rule] || rule
const ago = (at) => formatDistanceToNow(new Date(at), { addSuffix: true })

onMounted(() => store.fetchChannels().catch(() => {}))

// Editor
const form = ref(null)
const editorOpen = ref(false)
const draft = ref(null)
const saving = ref(false)

const openEditor = (channel) => {
  draft.value = channel
    ? {
        id: channel.id,
        originalName: channel.name,
        name: channel.name,
        type: channel.type,
        recipients: [...(channel.config.recipients || [])],
        url: '',
        urlHint: channel.config.urlHint,
        headers: Object.keys(channel.config.headers || {}).map((name) => ({ name, value: '', stored: true })),
        minSeverity: channel.minSeverity,
        rules: [...channel.rules],
        cloudAlarms: Boolean(channel.cloudAlarms),
        cloudAlarmNames: [...(channel.cloudAlarmNames || [])],
        enabled: channel.enabled
      }
    : {
        id: null, name: '', type: 'webhook', recipients: [], url: '', headers: [], minSeverity: 'warning', rules: [],
        cloudAlarms: false, cloudAlarmNames: [], enabled: true
      }
  editorOpen.value = true
  store.fetchCloudAlarmNames()
}

// One entry per name however each cloud spells it ("Port Flap", "Port flap")
const alarmKey = (name) => String(name).trim().toLowerCase().replace(/[\s_-]+/g, ' ')
const cloudAlarmNameItems = computed(() => {
  const seen = new Set()
  return (store.cloudAlarmNames || []).map((n) => n.name).filter((name) => {
    const key = alarmKey(name)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
})

// A new webhook needs a URL; an edit may leave it blank to keep the stored one
const urlRule = (v) => {
  if (!v) return draft.value?.id ? true : 'The webhook URL is required'
  return /^https?:\/\/\S+$/.test(v) || 'Must start with https:// (or http://)'
}

const payloadOf = (d) => ({
  name: d.name.trim(),
  type: d.type,
  minSeverity: d.minSeverity,
  rules: d.rules,
  cloudAlarms: d.cloudAlarms,
  cloudAlarmNames: d.cloudAlarmNames.map((n) => String(n).trim()).filter(Boolean),
  enabled: d.enabled,
  config: d.type === 'email'
    ? { recipients: d.recipients.map((r) => String(r).trim()).filter(Boolean) }
    : {
        // Blank keeps the stored secret (sent as the mask, never as a new value)
        url: d.url.trim() || SECRET_MASK,
        headers: Object.fromEntries(d.headers.filter((h) => h.name.trim())
          .map((h) => [h.name.trim(), h.value || (h.stored ? SECRET_MASK : '')]))
      }
})

const save = async () => {
  const { valid } = await form.value.validate()
  if (!valid) return
  saving.value = true
  try {
    const payload = payloadOf(draft.value)
    if (draft.value.id) await store.updateChannel(draft.value.id, payload)
    else await store.createChannel(payload)
    notifications.showSuccess(`Channel "${payload.name}" ${draft.value.id ? 'saved' : 'added'}`)
    editorOpen.value = false
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not save the channel')
  } finally {
    saving.value = false
  }
}

const setEnabled = async (channel, enabled) => {
  try {
    await store.updateChannel(channel.id, { enabled })
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not change the channel')
  }
}

// Test send
const testing = ref(null)
const sendTest = async (channel) => {
  testing.value = channel.id
  try {
    const result = await store.testChannel(channel.id)
    if (result.success) notifications.showSuccess(`Test sent through "${channel.name}"`)
    else notifications.showError(`"${channel.name}": ${result.error}`, 'Test failed')
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'The test could not run')
  } finally {
    testing.value = null
  }
}

// Delete
const deleteTarget = ref(null)
const deleting = ref(false)
const doDelete = async () => {
  deleting.value = true
  const { id, name } = deleteTarget.value
  try {
    await store.deleteChannel(id)
    notifications.showSuccess(`Channel "${name}" deleted`)
    deleteTarget.value = null
  } catch (err) {
    notifications.showError(err.userMessage || err.message || 'Could not delete the channel')
  } finally {
    deleting.value = false
  }
}
</script>
