# Frontend Testing Features - Quick Reference

## What We Built (Backend)

✅ Manual connection testing (no database required)
✅ Stored credential testing (database integration)
✅ Device information retrieval
✅ Firmware information retrieval
✅ Device type detection
✅ Comprehensive error handling

## What Frontend Should Build

### 1. Test Button in Credential Form ⭐ HIGH PRIORITY

**Where**: Settings > API Credentials > Add/Edit Form

**What**:
- "Test Connection" button next to Save
- Shows loading spinner during test
- Displays results inline (green success / red error)
- Works BEFORE saving (using manual test endpoint)

**API Calls**:
```javascript
// For new credentials (not saved yet)
POST /api/v1/device-api/test-manual
Body: { deviceIp, username, password, deviceType: 'cx_switch' }

// For existing credentials (already saved)
POST /api/v1/settings/api-credentials/:id/test
```

**User Experience**:
```
[Name: Core Switch Admin]
[Type: Switch ▼]
[Username: admin]
[Password: ••••••]

[Test Connection] [Save]

✓ Connection Successful
  Device: core-switch-01 (Aruba 6300M)
  Version: 10.10.1010
  Response: 234ms
```

---

### 2. Device Connection Test ⭐ HIGH PRIORITY

**Where**: Devices > Device Detail > Actions Menu

**What**:
- "Test API Connection" action button
- Opens modal/drawer
- Shows step-by-step progress
- Displays device info and firmware info on success

**API Calls**:
```javascript
// Test connection
POST /api/v1/device-api/test/:deviceId

// Get detailed info (optional, if test passes)
GET /api/v1/device-api/:deviceId/info
GET /api/v1/device-api/:deviceId/firmware
```

**User Experience**:
```
User clicks "Test API Connection"
↓
Modal shows:
⟳ Testing connection...
✓ Authentication successful
✓ Device information retrieved
✓ Firmware information retrieved

Results:
Device: core-switch-01
Model: Aruba 6300M
Version: 10.10.1010
Serial: SG1234567890
...
```

---

### 3. Quick Diagnostic Page (Admin) ⭐ MEDIUM PRIORITY

**Where**: New page - Settings > Device API Testing

**What**:
- Form with: IP, Username, Password, Device Type
- "Test Connection" button
- Results display with device info
- List of supported device types
- Recent test history (client-side only)

**API Calls**:
```javascript
// Get supported types (on page load)
GET /api/v1/device-api/supported-types

// Test connection
POST /api/v1/device-api/test-manual
Body: { deviceIp, username, password, deviceType }
```

**User Experience**:
```
Quick Connection Test
[IP: 192.168.1.1]
[Username: admin]
[Password: ••••••]
[Type: CX Switch ▼]
[Test Connection]

Supported Device Types:
✓ CX Switch - Implemented
✗ AOS Switch - Planned
✗ Instant AP - Planned

Recent Tests:
1 min ago | 192.168.1.1 | ✓ Success | [View]
```

---

### 4. Connection Status Badges ⭐ MEDIUM PRIORITY

**Where**: Device List, Device Detail

**What**:
- Visual badges showing connection status
- Tooltip with last test time and result
- Color-coded: Green (success), Red (failed), Yellow (untested), Gray (no creds)

**Data Source**:
```javascript
// From credential object
credential.lastTested      // DateTime
credential.lastTestStatus  // 'success' | 'failed'
```

**Visual**:
```
Device List:
Core Switch 1  | Switch | DC-01 | ✓ Connected (5m)
Core Switch 2  | Switch | DC-01 | ✗ Failed (2h)
Access Switch  | Switch | Floor | ⚠ Untested
AP-Floor-2     | AP     | Floor | − No credentials
```

---

### 5. Device Info Display Component ⭐ LOW PRIORITY

**Where**: Reusable component

**What**:
- Formatted display of device information
- Tabs or sections for: System Info, Firmware Info, Network Info
- Copy to clipboard functionality

**Data Structure**:
```typescript
interface DeviceInfo {
  hostname: string;
  model: string;
  version: string;
  serialNumber: string;
  macAddress: string;
  uptime: string;
  timezone: string;
}

interface FirmwareInfo {
  currentVersion: string;
  primaryVersion: string;
  secondaryVersion: string;
  bootedImage: 'primary' | 'secondary';
}
```

---

## Required API Service Methods

Add to your `deviceApi.service.js` or similar:

```javascript
export const deviceApiService = {
  // Test manual connection (no storage)
  testManualConnection(deviceIp, username, password, deviceType = 'cx_switch') {
    return api.post('/api/v1/device-api/test-manual', {
      deviceIp,
      username,
      password,
      deviceType
    });
  },

  // Test device with stored credentials
  testDeviceConnection(deviceId) {
    return api.post(`/api/v1/device-api/test/${deviceId}`);
  },

  // Get device info via API
  getDeviceInfo(deviceId) {
    return api.get(`/api/v1/device-api/${deviceId}/info`);
  },

  // Get firmware info via API
  getFirmwareInfo(deviceId) {
    return api.get(`/api/v1/device-api/${deviceId}/firmware`);
  },

  // Get supported device types
  getSupportedTypes() {
    return api.get('/api/v1/device-api/supported-types');
  }
};

export const settingsService = {
  // Test existing credential
  testCredential(credentialId) {
    return api.post(`/api/v1/settings/api-credentials/${credentialId}/test`);
  },

  // ... your existing methods
};
```

---

## Recommended Components

### Component 1: `DeviceConnectionTest.vue`
Reusable connection testing component

**Props**: `mode` (manual/stored), `deviceId`, `autoTest`, `showDetails`
**Emits**: `test-start`, `test-complete`, `test-error`

### Component 2: `ConnectionStatusBadge.vue`
Status indicator badge

**Props**: `status`, `lastTested`, `responseTime`, `compact`

### Component 3: `DeviceInfoDisplay.vue`
Formatted device information display

**Props**: `deviceInfo`, `firmwareInfo`, `loading`

---

## Error Handling Examples

```javascript
async function testConnection() {
  try {
    loading.value = true;
    const result = await deviceApiService.testManualConnection(
      form.deviceIp,
      form.username,
      form.password,
      'cx_switch'
    );

    if (result.data.success) {
      showSuccess({
        title: 'Connection Successful',
        message: `Connected to ${result.data.deviceInfo.hostname}`,
        details: result.data.deviceInfo
      });
    } else {
      showError({
        title: 'Connection Failed',
        message: result.data.message,
        troubleshooting: getTroubleshootingSteps(result.data.message)
      });
    }
  } catch (error) {
    showError({
      title: 'Connection Error',
      message: error.response?.data?.error || error.message,
      troubleshooting: [
        'Check device IP address',
        'Verify network connectivity',
        'Check device configuration'
      ]
    });
  } finally {
    loading.value = false;
  }
}
```

---

## Implementation Phases

### Phase 1: MVP (Do First)
1. Test button in credential form
2. Basic success/error display
3. Manual connection test page

### Phase 2: Enhanced
4. Connection test in device detail
5. Device info display
6. Firmware info display

### Phase 3: Polish
7. Status badges in device list
8. Connection status cards
9. Error troubleshooting helpers

---

## Testing Checklist

Frontend developer should test:

- [ ] Test button appears in credential form
- [ ] Test works for new credentials (before saving)
- [ ] Test works for existing credentials
- [ ] Loading state shows during test
- [ ] Success shows device information
- [ ] Errors show helpful troubleshooting
- [ ] Manual test page works
- [ ] Device test from detail page works
- [ ] Supported types list displays
- [ ] All components are accessible
- [ ] Mobile responsive design

---

## Quick Start for Frontend Developer

1. **Add service methods** (see above)
2. **Create `DeviceConnectionTest.vue`** component
3. **Add test button** to credential form using component
4. **Test with real CX switch** (get credentials from backend team)
5. **Handle errors gracefully** with user-friendly messages
6. **Add to other pages** (device detail, diagnostics)

---

## Backend Endpoints Reference

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/api/v1/device-api/supported-types` | GET | List device types | Yes |
| `/api/v1/device-api/test-manual` | POST | Quick test | Admin/Op |
| `/api/v1/device-api/test/:deviceId` | POST | Test stored | Admin/Op |
| `/api/v1/device-api/:deviceId/info` | GET | Device info | Yes |
| `/api/v1/device-api/:deviceId/firmware` | GET | Firmware info | Yes |
| `/api/v1/settings/api-credentials/:id/test` | POST | Test credential | Admin/Op |

All require JWT in `Authorization: Bearer <token>` header.

---

## Example Request/Response

### Test Manual Connection

**Request**:
```http
POST /api/v1/device-api/test-manual
Authorization: Bearer <token>
Content-Type: application/json

{
  "deviceIp": "192.168.1.1",
  "username": "admin",
  "password": "password",
  "deviceType": "cx_switch"
}
```

**Success Response**:
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Connection successful",
    "testedAt": "2024-10-04T01:30:00.000Z",
    "responseTime": 234,
    "deviceInfo": {
      "hostname": "core-switch-01",
      "model": "Aruba 6300M",
      "version": "10.10.1010"
    }
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "CX login failed: Authentication failed"
}
```

---

## Questions to Ask Backend Team

1. What's the typical response time for tests? (for setting timeouts)
2. Should we poll for status or is it immediate response?
3. Any rate limiting on test endpoints?
4. What's the timeout for tests on backend?
5. Should we cache test results? For how long?

---

## Documentation

- **Full requirements**: `FRONTEND_TESTING_REQUIREMENTS.md`
- **Test plan**: `CX_API_TEST_PLAN.md`
- **Architecture**: `CX_API_INTEGRATION_SUMMARY.md`
