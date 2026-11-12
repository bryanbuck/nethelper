import { ref, toValue, watch, onUnmounted } from 'vue'
import portsService from '@/services/ports.service'
import { useWebSocket } from '@/composables/useWebSocket'
import { portKey } from '@/models/port-clients'

/**
 * Port Identity: a switch's port notes, for showing "your label" next to a
 * port in other views (Live, Neighbors). Keyed by the API's port key and by
 * the device's own spelling, so either finds the note. Reloads when the
 * switch's ports change. Best effort: a failed load just shows no labels.
 * @param deviceRef  ref/getter of the device ({ id, type })
 * @returns {{ noteFor: (port) => note|null }}
 */
export function usePortLabels(deviceRef) {
  const notes = ref(new Map())
  let deviceId = null

  async function load() {
    const device = toValue(deviceRef)
    deviceId = device?.id || null
    if (!device || device.type !== 'switch') {
      notes.value = new Map()
      return
    }
    try {
      const view = await portsService.getPorts(device.id)
      const map = new Map()
      for (const p of view.ports || []) {
        if (!p.note) continue
        map.set(portKey(p.port), p.note)
        map.set(portKey(p.label), p.note)
      }
      notes.value = map
    } catch {
      notes.value = new Map()
    }
  }

  const { on, off } = useWebSocket()
  const onUpdated = (e) => {
    if (e?.deviceId && e.deviceId === deviceId) load()
  }
  on('ports:updated', onUpdated)
  onUnmounted(() => off('ports:updated', onUpdated))
  watch(() => toValue(deviceRef)?.id, load, { immediate: true })

  return { noteFor: (port) => notes.value.get(portKey(port)) || null }
}
