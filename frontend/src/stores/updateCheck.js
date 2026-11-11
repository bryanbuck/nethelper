/**
 * Is a newer NetHelper release out? (admins)
 *
 * The server checks GitHub's public release list once a day and keeps the
 * answer; this store only reads it (`GET /system/update`), on sign-in and
 * every few hours while the app stays open. The status bar's version
 * indicator and the System Status page show it. Upgrading is a command on
 * the server, never something the app does.
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import systemService from '@/services/system.service'

const REFRESH_MS = 6 * 60 * 60 * 1000

export const useUpdateCheckStore = defineStore('updateCheck', () => {
  const status = ref(null) // { enabled, current, latest, updateAvailable, checkedAt, error }
  const checking = ref(false)
  const error = ref(null) // reading the status from this server failed

  const updateAvailable = computed(() => Boolean(status.value?.updateAvailable && status.value?.latest))
  const latestVersion = computed(() => status.value?.latest?.version || null)

  let timer = null

  // Background reads stay quiet: a failure shows on the System Status page only.
  async function load() {
    try {
      status.value = await systemService.getUpdateStatus()
      error.value = null
    } catch (err) {
      error.value = err.message
    }
  }

  async function checkNow() {
    if (checking.value) return
    checking.value = true
    try {
      status.value = await systemService.checkForUpdate()
      error.value = null
    } catch (err) {
      error.value = err.message
    } finally {
      checking.value = false
    }
  }

  function start() {
    if (timer) return
    load()
    timer = setInterval(load, REFRESH_MS)
  }

  function stop() {
    clearInterval(timer)
    timer = null
    status.value = null
    error.value = null
  }

  return { status, checking, error, updateAvailable, latestVersion, load, checkNow, start, stop }
})
