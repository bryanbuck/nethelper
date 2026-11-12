<template>
  <div class="port-details py-3">
    <div class="d-flex flex-wrap ga-6">
      <!-- The user's note about the port -->
      <section class="port-details-note">
        <div class="d-flex align-center ga-2 mb-1">
          <span class="text-subtitle-2">Your note</span>
          <v-btn v-if="canEdit" size="x-small" variant="text" prepend-icon="mdi-pencil-outline" @click="$emit('edit')">
            {{ port.note ? 'Edit' : 'Add' }}
          </v-btn>
        </div>
        <template v-if="port.note">
          <div v-if="port.note.label" class="font-weight-medium">{{ port.note.label }}</div>
          <div v-if="port.note.location" class="text-body-2">Location: {{ port.note.location }}</div>
          <div v-if="port.note.owner" class="text-body-2">Owner: {{ port.note.owner }}</div>
          <div v-if="port.note.notes" class="text-body-2 note-text">{{ port.note.notes }}</div>
          <div v-if="port.expected" class="text-body-2">
            Expected device {{ port.expected.mac }}:
            <span :class="port.expected.present ? 'text-success' : 'text-warning'">
              {{ port.expected.present ? 'here' : 'not here' }}
            </span>
          </div>
          <div class="text-caption text-medium-emphasis">
            Updated {{ timeAgo(port.note.updatedAt) }}<span v-if="port.note.updatedBy"> by {{ port.note.updatedBy.name }}</span>
          </div>
        </template>
        <div v-else class="text-body-2 text-medium-emphasis">No note yet.</div>
      </section>

      <!-- LLDP/CDP neighbors on the port -->
      <section v-if="port.neighbors.length" class="port-details-neighbors">
        <div class="text-subtitle-2 mb-1">Heard on the port (LLDP)</div>
        <div v-for="(n, i) in port.neighbors" :key="i" class="text-body-2">
          <router-link v-if="n.device" :to="`/devices/${n.device.id}`">{{ n.device.name }}</router-link>
          <span v-else>{{ n.sysName || n.mac }}</span>
          <span v-if="n.portId" class="text-medium-emphasis"> port {{ n.portId }}</span>
          <span v-if="n.capabilities?.length" class="text-medium-emphasis"> ({{ n.capabilities.join(', ') }})</span>
        </div>
      </section>
    </div>

    <!-- Every sighting shown for the port -->
    <div v-if="port.uplink" class="text-body-2 text-medium-emphasis mt-3">
      {{ port.macCount ?? 0 }} MAC addresses pass through this port; the devices behind it are listed on the switches they connect to.
    </div>
    <v-table v-else-if="port.clients.length" density="compact" class="table-stack mt-3 port-clients-table">
      <thead>
        <tr>
          <th>Device</th>
          <th>MAC</th>
          <th>IP</th>
          <th>VLAN</th>
          <th>Seen</th>
          <th>From</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="client in port.clients" :key="client.id" :class="{ 'text-medium-emphasis': client.state === 'gone' }">
          <td>
            <PortClientLine :client="client" />
            <div v-if="profileText(client.profile)" class="text-caption text-medium-emphasis">{{ profileText(client.profile) }}</div>
            <div v-if="client.username" class="text-caption text-medium-emphasis">User: {{ client.username }}</div>
            <div v-if="client.lldp?.sysName && client.lldp.sysName !== clientTitle(client)" class="text-caption text-medium-emphasis">
              LLDP: {{ client.lldp.sysName }}
            </div>
          </td>
          <td data-label="MAC" class="text-no-wrap">
            {{ client.mac }}
            <div class="text-caption text-medium-emphasis">
              {{ client.profile?.randomMac ? 'Private (random) MAC' : client.vendor || '' }}
            </div>
          </td>
          <td data-label="IP" class="text-no-wrap">{{ client.ip || '' }}</td>
          <td data-label="VLAN">{{ client.vlan ?? '' }}</td>
          <td data-label="Seen">
            <div>{{ freshnessText(client) }}</div>
            <div class="text-caption text-medium-emphasis">First seen {{ timeAgo(client.firstSeen) }}</div>
            <div v-if="client.goneReason === 'moved' && client.goneDetail" class="text-caption">
              <router-link :to="{ path: `/devices/${client.goneDetail.deviceId}`, query: { tab: 'ports', port: client.goneDetail.port } }">
                Now on port {{ client.goneDetail.port }}
              </router-link>
            </div>
          </td>
          <td data-label="From" class="text-caption">{{ (client.sources || []).map((s) => SOURCES[s] || s).join(', ') }}</td>
        </tr>
      </tbody>
    </v-table>
    <div v-else class="text-body-2 text-medium-emphasis mt-3">No device has been seen on this port.</div>
    <div v-if="port.goneCount > goneShown" class="text-caption text-medium-emphasis mt-1">
      {{ port.goneCount - goneShown }} older sighting{{ port.goneCount - goneShown === 1 ? '' : 's' }} kept; open the port to see them all.
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { timeAgo } from '@/models/activity'
import { SOURCES, clientTitle, freshnessText, profileText } from '@/models/port-clients'
import PortClientLine from '@/components/devices/PortClientLine.vue'

const props = defineProps({
  port: { type: Object, required: true },
  canEdit: { type: Boolean, default: false }
})
defineEmits(['edit'])

const goneShown = computed(() => props.port.clients.filter((c) => c.state === 'gone').length)
</script>

<style scoped>
.port-details-note,
.port-details-neighbors {
  min-width: 220px;
  max-width: 480px;
}
.note-text {
  white-space: pre-wrap;
}
</style>
