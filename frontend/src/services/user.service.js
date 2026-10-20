import api from './api'
import { handleApiError } from '@/utils/apiError'

/** User administration (admin only). Creating a user goes through /auth/register. */
class UserService {
  async getUsers() {
    try {
      const response = await api.get('/users')
      return response.data
    } catch (error) {
      throw handleApiError(error, 'fetching users')
    }
  }

  /** @param {Object} data - { email, name, password, role } */
  async createUser(data) {
    try {
      const response = await api.post('/auth/register', data)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'creating user')
    }
  }

  /** @param {Object} data - { name?, role? } */
  async updateUser(userId, data) {
    try {
      const response = await api.put(`/users/${userId}`, data)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'updating user')
    }
  }

  async resetPassword(userId, password) {
    try {
      const response = await api.post(`/users/${userId}/reset-password`, { password })
      return response.data
    } catch (error) {
      throw handleApiError(error, 'resetting password')
    }
  }

  async deleteUser(userId) {
    try {
      const response = await api.delete(`/users/${userId}`)
      return response.data
    } catch (error) {
      throw handleApiError(error, 'deleting user')
    }
  }
}

export default new UserService()
