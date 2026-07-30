# Settings Page Troubleshooting & Error Handling

## Issues Fixed

### 1. Blank Page Issue - SettingsView.vue
**Problem:** The settings page was rendering blank due to a Vue import error.

**Root Cause:** The `watch` function was being used in the `<script setup>` block but was only imported in a second separate `<script>` block. This caused a runtime error that prevented the component from rendering.

**Fix:** Moved the `watch` import to the main `<script setup>` block and removed the duplicate `<script>` block.

```javascript
// Before (BROKEN)
<script setup>
import { ref, onMounted } from 'vue'  // Missing watch!
// ... watch() used here
</script>

<script>
import { watch } from 'vue'  // Wrong location
</script>

// After (FIXED)
<script setup>
import { ref, watch, onMounted } from 'vue'  // All imports together
</script>
```

**File:** `/home/bryan/nethelper/frontend/src/views/settings/SettingsView.vue`

---

## Error Handling Improvements

### 2. ErrorBoundary Component
**Purpose:** Provide a robust error boundary that catches component errors and displays user-friendly messages.

**Features:**
- Catches errors from child components using `onErrorCaptured`
- Displays user-friendly messages instead of technical errors
- Provides retry functionality
- Shows technical details in development mode
- Handles common error scenarios (network, auth, permissions, server errors)

**Usage:**
```vue
<ErrorBoundary :show-details="isDevelopment">
  <YourComponent />
</ErrorBoundary>
```

**File:** `/home/bryan/nethelper/frontend/src/components/common/ErrorBoundary.vue`

**Integrated in:**
- SettingsView (wraps entire view)
- ApiCredentials component (isolated error handling)

---

### 3. NotificationDisplay Component
**Purpose:** Display toast-style notifications to users for feedback on actions.

**Features:**
- Snackbar notifications with customizable colors
- Auto-dismiss with configurable timeout
- Support for success, error, warning, info, and alert types
- Multiple concurrent notifications
- Icon indicators for each notification type

**File:** `/home/bryan/nethelper/frontend/src/components/common/NotificationDisplay.vue`

**Integrated in:** App.vue (global)

---

### 4. Enhanced Notifications Store
**Purpose:** Added convenience methods for common notification patterns.

**New Methods:**
- `showSuccess(message, title)` - Quick success notifications
- `showError(message, title)` - Quick error notifications
- `showWarning(message, title)` - Quick warning notifications
- `showInfo(message, title)` - Quick info notifications

**Usage:**
```javascript
import { useNotificationsStore } from '@/stores/notifications'

const notificationStore = useNotificationsStore()

// Success
notificationStore.showSuccess('Settings saved successfully')

// Error
notificationStore.showError('Failed to save settings')

// Warning
notificationStore.showWarning('Some fields are missing')

// Info
notificationStore.showInfo('Loading data...')
```

**File:** `/home/bryan/nethelper/frontend/src/stores/notifications.js`

---

### 5. ApiCredentials Error Handling
**Purpose:** Gracefully handle API failures when loading credentials.

**Implementation:**
- Try/catch block in `onMounted`
- User-friendly error messages based on error type
- Special handling for 404 errors (backend not configured)
- Fallback error message for unexpected failures

**Code:**
```javascript
try {
  await settingsStore.fetchApiCredentials()
  await devicesStore.fetchDevices()
} catch (error) {
  const errorMessage = error.response?.status === 404
    ? 'Settings endpoint not found. Please ensure the backend is configured correctly.'
    : 'Failed to load settings. Please try refreshing the page.'

  notificationStore.showError(errorMessage)
}
```

**File:** `/home/bryan/nethelper/frontend/src/components/settings/ApiCredentials.vue`

---

## User Experience Improvements

### What Users See Now

**Before:**
- Blank white page with no feedback
- Technical console errors only visible to developers
- No way to recover without refreshing

**After:**
- Clear error messages explaining what went wrong
- Visual feedback with icons and colors
- "Try Again" button for easy retry
- "Go Home" button to navigate away
- Toast notifications for all actions (create, update, delete, test)
- Technical details available in development mode only

---

## Error Scenarios Covered

### Network Errors
- **Symptoms:** `Failed to fetch`, `Network Error`
- **User Message:** "Unable to connect to the server. Please check your internet connection and try again."
- **Actions:** Retry, Go Home

### Authentication Errors (401)
- **Symptoms:** `401 Unauthorized`
- **User Message:** "Your session has expired. Please sign in again."
- **Actions:** Auto-redirect to login after 2 seconds

### Permission Errors (403)
- **Symptoms:** `403 Forbidden`
- **User Message:** "You do not have permission to access this resource."
- **Actions:** Go Home

### Not Found Errors (404)
- **Symptoms:** `404 Not Found`
- **User Message:** "The requested resource could not be found."
- **Special Case:** When loading settings - "Settings endpoint not found. Please ensure the backend is configured correctly."
- **Actions:** Retry, Go Home

### Server Errors (500+)
- **Symptoms:** `500 Internal Server Error`
- **User Message:** "The server encountered an error. Please try again later."
- **Actions:** Retry, Go Home

### Component Errors
- **Symptoms:** Vue component rendering errors
- **User Message:** "An unexpected error occurred. Please try again or contact support if the issue persists."
- **Actions:** Retry, Go Home

---

## Testing the Settings Page

### Check the Browser Console
Open Developer Tools (F12) and check for:
1. **Import/Export errors** - These indicate module loading issues
2. **Network errors** - Check the Network tab for failed API calls
3. **Vue warnings** - Look for component lifecycle or prop validation issues

### Common Issues and Solutions

#### Issue: "Cannot read property of undefined"
**Likely Cause:** Store not initialized or API returning unexpected data structure
**Solution:** Check that stores are properly initialized and API responses match expected schema

#### Issue: "Failed to fetch" or "Network Error"
**Likely Cause:** Backend not running or CORS issues
**Solution:**
1. Verify backend is running: `http://localhost:3000/api/v1/settings/api-credentials`
2. Check CORS configuration in backend
3. Verify `VITE_API_URL` in `.env` file

#### Issue: 404 on API calls
**Likely Cause:** Backend routes not implemented yet
**Solution:** Implement backend routes as documented in `SETTINGS_BACKEND_REQUIREMENTS.md`

#### Issue: Component not rendering
**Likely Cause:** Import errors or missing dependencies
**Solution:**
1. Check all imports are correct
2. Verify component is registered
3. Check browser console for specific error

---

## Development vs Production

### Development Mode
- Shows technical error details
- Displays stack traces
- More verbose logging
- ErrorBoundary shows "Technical Details" expansion panel

### Production Mode
- Hides technical details from users
- User-friendly messages only
- Minimal logging
- Focus on recovery options

**Toggle:** Controlled by `import.meta.env.DEV`

---

## Future Enhancements

1. **Error Logging Service**
   - Send errors to logging service (e.g., Sentry)
   - Track error frequency and patterns
   - Alert on critical errors

2. **Offline Support**
   - Detect offline state
   - Queue actions for retry
   - Show offline indicator

3. **Better Recovery**
   - Auto-retry with exponential backoff
   - Partial data loading (load what works)
   - Cached data fallback

4. **User Feedback**
   - "Report Bug" button in error boundary
   - Include error context in bug reports
   - Link to support resources

---

## Quick Reference

### Adding Error Handling to a New Component

```vue
<template>
  <ErrorBoundary :show-details="isDev">
    <YourComponent />
  </ErrorBoundary>
</template>

<script setup>
import { computed } from 'vue'
import ErrorBoundary from '@/components/common/ErrorBoundary.vue'
import YourComponent from './YourComponent.vue'

const isDev = computed(() => import.meta.env.DEV)
</script>
```

### Showing Notifications

```javascript
import { useNotificationsStore } from '@/stores/notifications'

const notifications = useNotificationsStore()

try {
  await someApiCall()
  notifications.showSuccess('Operation completed successfully')
} catch (error) {
  notifications.showError(
    error.response?.data?.message || 'Operation failed'
  )
}
```

### Debugging Tips

1. **Check Vue DevTools** - Inspect component state and props
2. **Network Tab** - Verify API calls and responses
3. **Console Errors** - Look for specific error messages
4. **Debug Logging** - Use `debugLog` utility with SETTINGS category
5. **Enable Debug Mode** - Set `VITE_DEBUG_LOGGING=true` in `.env`
