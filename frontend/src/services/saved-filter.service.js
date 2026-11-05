import api from './api'
import { handleApiError } from '@/utils/apiError'

/**
 * The signed-in user's saved Devices-page filters (/devices/saved-filters).
 * Each row is { id, name, view: { filters, search, sortBy } }; the server
 * keeps them private to the user and drops anything the table can't use.
 */
class SavedFilterService {
  async list() {
    try {
      const response = await api.get('/devices/saved-filters')
      return response.data.data || []
    } catch (error) {
      throw handleApiError(error, 'loading saved filters')
    }
  }

  async create({ name, view }) {
    try {
      const response = await api.post('/devices/saved-filters', { name, view })
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'saving the filter')
    }
  }

  /** Rename and/or replace the view; leave a field out to keep it. */
  async update(id, { name, view }) {
    try {
      const response = await api.put(`/devices/saved-filters/${id}`, { name, view })
      return response.data.data
    } catch (error) {
      throw handleApiError(error, 'updating the saved filter')
    }
  }

  async remove(id) {
    try {
      await api.delete(`/devices/saved-filters/${id}`)
    } catch (error) {
      throw handleApiError(error, 'deleting the saved filter')
    }
  }
}

export default new SavedFilterService()
