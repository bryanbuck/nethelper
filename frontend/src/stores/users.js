import { defineStore } from 'pinia'
import { ref } from 'vue'
import userService from '@/services/user.service'

export const useUsersStore = defineStore('users', () => {
  const users = ref([])
  const loading = ref(false)
  const error = ref(null)

  async function fetchUsers() {
    loading.value = true
    error.value = null
    try {
      const response = await userService.getUsers()
      users.value = response.data || []
      return users.value
    } catch (err) {
      error.value = err
      throw err
    } finally {
      loading.value = false
    }
  }

  async function createUser(data) {
    const response = await userService.createUser(data)
    const user = response.data.user
    users.value.push(user)
    return user
  }

  async function updateUser(userId, data) {
    const response = await userService.updateUser(userId, data)
    const index = users.value.findIndex((u) => u.id === userId)
    if (index > -1) users.value[index] = response.data
    return response.data
  }

  async function resetPassword(userId, password) {
    await userService.resetPassword(userId, password)
  }

  /** @returns {Object} counts of shared records transferred to the caller */
  async function deleteUser(userId) {
    const response = await userService.deleteUser(userId)
    users.value = users.value.filter((u) => u.id !== userId)
    return response.data?.reassigned || {}
  }

  return { users, loading, error, fetchUsers, createUser, updateUser, resetPassword, deleteUser }
})
