// The status bar's activity log, kept per browser tab so a reload doesn't lose
// it. sessionStorage dies with the tab; signing out clears it explicitly.
// Storage can be unavailable or hold junk, so every access is guarded.

export const ACTIVITY_LOG_KEY = 'nethelper.activity'

// Function actions can't be stored; only route actions ({ label, to }) survive.
const storableActions = (actions) =>
  (Array.isArray(actions) ? actions : []).filter((a) => a && a.label && a.to).map(({ label, to }) => ({ label, to }))

export function toStoredEntry (entry) {
  const { id, type, title, message, createdAt, seen, persistent, timeout, actions } = entry
  return { id, type, title, message, createdAt, seen, persistent, timeout, actions: storableActions(actions) }
}

export function readActivityLog () {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACTIVITY_LOG_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((e) => e && typeof e.id === 'string' && typeof e.createdAt === 'string')
      .map((e) => ({ ...e, actions: storableActions(e.actions) }))
  } catch {
    return []
  }
}

export function writeActivityLog (entries) {
  try {
    sessionStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(entries.map(toStoredEntry)))
  } catch {
    // Not persisted; the log still works for this page load.
  }
}

export function clearActivityLog () {
  try {
    sessionStorage.removeItem(ACTIVITY_LOG_KEY)
  } catch {
    // Nothing stored to clear.
  }
}
