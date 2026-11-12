import api from './api'
import { handleApiError } from '@/utils/apiError'

// Port names carry slashes (1/1/4, ge-0/0/1): always URL-encode them.
const portPath = (deviceId, port) => `/devices/${deviceId}/ports/${encodeURIComponent(port)}`

/** Port Identity: a switch's ports, port notes, and the fleet-wide search. */
class PortsService {
  /** Every port of a device: { device, reads, lastSuccessAt, observingSince, intervalMs, ports } */
  async getPorts(deviceId) {
    try {
      const response = await api.get(`/devices/${deviceId}/ports`)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'loading ports')
    }
  }

  /** One port with every kept sighting and the note's revisions. */
  async getPort(deviceId, port) {
    try {
      const response = await api.get(portPath(deviceId, port))
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'loading the port')
    }
  }

  /** Save a note; returns the note, or null when the save left it empty (cleared). */
  async setNote(deviceId, port, note) {
    try {
      const response = await api.put(`${portPath(deviceId, port)}/note`, note)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'saving the port note')
    }
  }

  async clearNote(deviceId, port) {
    try {
      await api.delete(`${portPath(deviceId, port)}/note`)
    } catch (error) {
      throw handleApiError(error, 'clearing the port note')
    }
  }

  /** Queue a client read of the switch; the result arrives as ports:collected. */
  async readNow(deviceId) {
    try {
      const response = await api.post(`/devices/${deviceId}/ports/read`)
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'starting the port read')
    }
  }

  /** Fleet-wide: { clients, notes } matching a MAC (fragment), IP, host, user, vendor or note text. */
  async search(q) {
    try {
      const response = await api.get('/devices/ports/search', { params: { q } })
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'searching ports')
    }
  }
}

export default new PortsService()
