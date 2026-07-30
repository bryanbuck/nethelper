# Frontend Testing UI Requirements

## Overview

This document outlines frontend features to implement for testing device API connectivity. These features align with the backend testing infrastructure and provide users with visual, interactive ways to validate device connections.

## User Stories

### As an Administrator
- I want to test device credentials before saving them
- I want to see real-time connection test results
- I want to validate that my switch is properly configured
- I want to see detailed device information from the API
- I want to troubleshoot connection issues with clear error messages

### As an Operator
- I want to quickly test if a device is reachable
- I want to verify credentials are working
- I want to see what information we can retrieve from devices

---

## Feature 1: API Credential Test Button

### Location
Settings > API Credentials > Add/Edit Credential Form

### UI Elements

**1. Test Connection Button**
- Position: Next to Save button in credential form
- Label: "Test Connection"
- Icon: 🔌 or connection icon
- State: Disabled until required fields filled

**2. Test Results Display**
- Component: Alert/Card below form
- Auto-dismiss: Yes (after 10 seconds) or manual close
- States: Loading, Success, Error

### Workflow

```
User fills in credential form:
├── Device IP: 192.168.1.1
├── Username: admin
├── Password: ••••••••
└── Device Type: CX Switch

User clicks "Test Connection"
├── Button shows loading spinner
├── Backend API called: POST /api/v1/settings/api-credentials/:id/test
└── Results displayed:

Success:
┌──────────────────────────────────────────────────┐
│ ✓ Connection Successful                          │
│                                                   │
│ Response Time: 234ms                              │
│ Device: core-switch-01 (Aruba 6300M)             │
│ Version: 10.10.1010                              │
│                                                   │
│ Last Tested: 2024-10-04 01:30 PM                 │
└──────────────────────────────────────────────────┘

Error:
┌──────────────────────────────────────────────────┐
│ ✗ Connection Failed                              │
│                                                   │
│ Error: Authentication failed                      │
│                                                   │
│ Troubleshooting:                                  │
│ • Verify username and password                   │
│ • Check user is in administrators group          │
│ • Verify HTTPS REST API is enabled               │
│                                                   │
│ [View Detailed Logs]                             │
└──────────────────────────────────────────────────┘
```

### API Integration

**Endpoint**: `POST /api/v1/settings/api-credentials/:id/test`

**For Existing Credentials**:
```javascript
// Test existing credential
const response = await api.post(`/api/v1/settings/api-credentials/${credentialId}/test`);
```

**For New Credentials (before saving)**:
```javascript
// Use manual test endpoint
const response = await api.post('/api/v1/device-api/test-manual', {
  deviceIp: form.deviceIp,
  username: form.username,
  password: form.password,
  deviceType: 'cx_switch'
});
```

### UI Mockup

```
┌─────────────────────────────────────────────────────────────┐
│ Edit API Credential                                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Name: *                                                      │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Core Switch Admin                                     │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Device Type: *                                               │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Switch                                         ▼     │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Device: (Optional)                                           │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Core Switch 1 - 192.168.1.1                   ▼     │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Username:                                                    │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ admin                                                 │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Password:                                                    │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ ••••••••••                                            │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ ┌─────────────────────────────────────────────────────┐    │
│ │ ✓ Connection Successful                             │    │
│ │                                                      │    │
│ │ Device: core-switch-01 (Aruba 6300M)                │    │
│ │ Version: 10.10.1010                                 │    │
│ │ Response Time: 234ms                                │    │
│ │ Tested: Just now                                    │    │
│ └─────────────────────────────────────────────────────┘    │
│                                                              │
│                   [Cancel]  [Test Connection]  [Save]       │
└─────────────────────────────────────────────────────────────┘
```

---

## Feature 2: Quick Device Connection Test

### Location
Devices > Device Detail View > Actions Menu

### UI Elements

**1. Test Connection Action**
- Location: Device detail page, actions dropdown
- Label: "Test API Connection"
- Requires: Device has stored credentials

**2. Test Modal/Drawer**

```
┌─────────────────────────────────────────────────────────────┐
│ Test Device Connection - Core Switch 1                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Device: Core Switch 1                                        │
│ IP Address: 192.168.1.1                                      │
│ Type: Switch (Aruba CX)                                      │
│                                                              │
│ Testing connection...                                        │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ [████████████████░░░░░░░░░░░] 60%                    │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ ✓ Authentication successful                                 │
│ ✓ Device information retrieved                              │
│ ⟳ Retrieving firmware information...                        │
│                                                              │
│                                              [Close]         │
└─────────────────────────────────────────────────────────────┘
```

### Workflow

```
User views device detail page
└── Clicks "Test API Connection" in actions menu
    ├── Modal opens
    ├── Test initiated automatically
    ├── Progress shown with steps
    └── Results displayed:

Success:
┌──────────────────────────────────────────────────────────────┐
│ ✓ Connection Test Successful                                │
│                                                              │
│ Connection Details:                                          │
│ • Response Time: 234ms                                       │
│ • Status: Connected                                          │
│ • Last Test: Just now                                        │
│                                                              │
│ Device Information:                                          │
│ • Hostname: core-switch-01                                  │
│ • Model: Aruba 6300M 48-port                                │
│ • Serial: SG1234567890                                      │
│ • MAC: 00:11:22:33:44:55                                    │
│                                                              │
│ Firmware Information:                                        │
│ • Current Version: 10.10.1010                               │
│ • Primary: 10.10.1010                                       │
│ • Secondary: 10.09.1000                                     │
│ • Booted Image: Primary                                     │
│                                                              │
│               [Copy Details]  [Close]                        │
└──────────────────────────────────────────────────────────────┘
```

### API Integration

**Endpoint 1**: `POST /api/v1/device-api/test/:deviceId`
```javascript
// Test connection using stored credentials
const testResult = await api.post(`/api/v1/device-api/test/${deviceId}`);
```

**Endpoint 2**: `GET /api/v1/device-api/:deviceId/info`
```javascript
// Get detailed device info
const deviceInfo = await api.get(`/api/v1/device-api/${deviceId}/info`);
```

**Endpoint 3**: `GET /api/v1/device-api/:deviceId/firmware`
```javascript
// Get firmware info
const firmwareInfo = await api.get(`/api/v1/device-api/${deviceId}/firmware`);
```

---

## Feature 3: Device API Diagnostics Page (Admin Only)

### Location
New page: Settings > Device API Testing

### Purpose
Dedicated page for testing device API connectivity without requiring devices to be in the database.

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Device API Testing                                  [Admin] │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Quick Connection Test                                        │
│ ┌──────────────────────────────────────────────────────┐   │
│ │                                                       │   │
│ │ Device IP Address: *                                  │   │
│ │ ┌──────────────────────────────────────────────┐     │   │
│ │ │ 192.168.1.1                                   │     │   │
│ │ └──────────────────────────────────────────────┘     │   │
│ │                                                       │   │
│ │ Username: *                                           │   │
│ │ ┌──────────────────────────────────────────────┐     │   │
│ │ │ admin                                         │     │   │
│ │ └──────────────────────────────────────────────┘     │   │
│ │                                                       │   │
│ │ Password: *                                           │   │
│ │ ┌──────────────────────────────────────────────┐     │   │
│ │ │ ••••••••••                                    │     │   │
│ │ └──────────────────────────────────────────────┘     │   │
│ │                                                       │   │
│ │ Device Type: *                                        │   │
│ │ ┌──────────────────────────────────────────────┐     │   │
│ │ │ CX Switch                              ▼     │     │   │
│ │ └──────────────────────────────────────────────┘     │   │
│ │                                                       │   │
│ │                            [Test Connection]         │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Supported Device Types                                      │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ ✓ CX Switch        Aruba CX switches (AOS-CX)        │   │
│ │ ✗ AOS Switch       Legacy Aruba switches (Planned)   │   │
│ │ ✗ Instant AP       Aruba Instant APs (Planned)       │   │
│ │ ✗ Controller       Aruba Controllers (Planned)       │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Recent Tests                                                 │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Time        Device IP      Status    Details          │   │
│ ├──────────────────────────────────────────────────────┤   │
│ │ 1 min ago   192.168.1.1   ✓ Success  [View]          │   │
│ │ 5 min ago   192.168.1.2   ✗ Failed   [View]          │   │
│ │ 10 min ago  192.168.1.1   ✓ Success  [View]          │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### API Integration

**Get Supported Types**: `GET /api/v1/device-api/supported-types`
```javascript
const supportedTypes = await api.get('/api/v1/device-api/supported-types');
// Returns list with implemented status
```

**Test Manual Connection**: `POST /api/v1/device-api/test-manual`
```javascript
const result = await api.post('/api/v1/device-api/test-manual', {
  deviceIp: '192.168.1.1',
  username: 'admin',
  password: 'password',
  deviceType: 'cx_switch'
});
```

---

## Feature 4: Connection Status Indicators

### Location
Multiple locations

### Device List View

Add connection status column/badge:

```
┌─────────────────────────────────────────────────────────────┐
│ Devices                                                      │
├─────────────────────────────────────────────────────────────┤
│ Name             Type      Location      API Status         │
├─────────────────────────────────────────────────────────────┤
│ Core Switch 1    Switch    DC-01        ✓ Connected (5m)   │
│ Core Switch 2    Switch    DC-01        ✗ Failed (2h)      │
│ Access Switch 1  Switch    Floor 1      ⚠ Untested         │
│ AP-Floor-2       AP        Floor 2      − No credentials   │
└─────────────────────────────────────────────────────────────┘
```

**Status Types**:
- `✓ Connected (Xm ago)` - Green - Last test successful
- `✗ Failed (Xh ago)` - Red - Last test failed
- `⚠ Untested` - Yellow - Has credentials, never tested
- `− No credentials` - Gray - No credentials configured

### Device Detail View

Add connection status card:

```
┌──────────────────────────────────────────────────┐
│ API Connection Status                            │
├──────────────────────────────────────────────────┤
│ Status: ✓ Connected                              │
│ Last Test: 5 minutes ago                         │
│ Response Time: 234ms                             │
│                                                   │
│ Credentials: Core Switch Admin (username/pass)  │
│                                                   │
│               [Test Now]  [View Credentials]     │
└──────────────────────────────────────────────────┘
```

---

## Feature 5: Credential Test History

### Location
Settings > API Credentials > Credential Detail/Edit

### UI Elements

Show test history for each credential:

```
┌─────────────────────────────────────────────────────────────┐
│ Test History - Core Switch Admin                           │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ Last 10 Tests                                                │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Time           Status      Response Time   Details    │   │
│ ├──────────────────────────────────────────────────────┤   │
│ │ 5 min ago     ✓ Success    234ms          [View]     │   │
│ │ 1 hour ago    ✓ Success    245ms          [View]     │   │
│ │ 3 hours ago   ✗ Failed     1200ms         [View]     │   │
│ │ 1 day ago     ✓ Success    230ms          [View]     │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ Statistics                                                   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ Total Tests: 156                                      │   │
│ │ Success Rate: 98.7%                                   │   │
│ │ Avg Response Time: 240ms                              │   │
│ │ Last Failure: 3 hours ago                             │   │
│ └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Note**: This requires backend enhancement to store test history. For now, just show last test status from `lastTested` and `lastTestStatus` fields.

---

## Component Specifications

### Component 1: DeviceConnectionTest.vue

**Purpose**: Reusable component for testing device connections

**Props**:
```typescript
interface Props {
  mode: 'manual' | 'stored';  // Manual = form input, Stored = use deviceId
  deviceId?: string;           // Required if mode='stored'
  autoTest?: boolean;          // Auto-test on mount
  showDeviceInfo?: boolean;    // Show detailed device info in results
  showFirmwareInfo?: boolean;  // Show firmware info in results
}
```

**Emits**:
```typescript
{
  'test-start': () => void;
  'test-complete': (result: TestResult) => void;
  'test-error': (error: Error) => void;
}
```

**Example Usage**:
```vue
<DeviceConnectionTest
  mode="manual"
  :show-device-info="true"
  :show-firmware-info="true"
  @test-complete="handleTestComplete"
/>
```

### Component 2: ConnectionStatusBadge.vue

**Purpose**: Display connection status with tooltip

**Props**:
```typescript
interface Props {
  status: 'connected' | 'failed' | 'untested' | 'no-credentials';
  lastTested?: Date;
  responseTime?: number;
  compact?: boolean;  // Show icon only
}
```

**Example**:
```vue
<ConnectionStatusBadge
  status="connected"
  :last-tested="device.lastTested"
  :response-time="234"
/>
```

### Component 3: DeviceInfoDisplay.vue

**Purpose**: Display formatted device information from API

**Props**:
```typescript
interface Props {
  deviceInfo: DeviceInfo;
  firmwareInfo?: FirmwareInfo;
  loading?: boolean;
}
```

**Example**:
```vue
<DeviceInfoDisplay
  :device-info="deviceInfo"
  :firmware-info="firmwareInfo"
/>
```

---

## API Service Methods

Add these methods to your device/settings services:

```typescript
// Device API Service
class DeviceAPIService {
  // Test manual connection
  async testManualConnection(params: ManualTestParams): Promise<TestResult> {
    return await api.post('/api/v1/device-api/test-manual', params);
  }

  // Test device with stored credentials
  async testDeviceConnection(deviceId: string): Promise<TestResult> {
    return await api.post(`/api/v1/device-api/test/${deviceId}`);
  }

  // Get device info via API
  async getDeviceInfo(deviceId: string): Promise<DeviceInfo> {
    return await api.get(`/api/v1/device-api/${deviceId}/info`);
  }

  // Get firmware info via API
  async getFirmwareInfo(deviceId: string): Promise<FirmwareInfo> {
    return await api.get(`/api/v1/device-api/${deviceId}/firmware`);
  }

  // Get supported device types
  async getSupportedTypes(): Promise<SupportedType[]> {
    return await api.get('/api/v1/device-api/supported-types');
  }
}

// Settings Service (enhanced)
class SettingsService {
  // Test credential
  async testCredential(credentialId: string): Promise<TestResult> {
    return await api.post(`/api/v1/settings/api-credentials/${credentialId}/test`);
  }

  // ... existing methods
}
```

---

## TypeScript Interfaces

```typescript
interface ManualTestParams {
  deviceIp: string;
  username: string;
  password: string;
  deviceType?: 'cx_switch' | 'aos_switch' | 'instant_ap' | 'aruba_controller';
}

interface TestResult {
  success: boolean;
  message: string;
  testedAt: string;
  responseTime: number;
  deviceInfo?: {
    hostname: string;
    model: string;
    version: string;
  };
}

interface DeviceInfo {
  hostname: string;
  model: string;
  version: string;
  serialNumber: string;
  macAddress: string;
  uptime: string;
  timezone: string;
  fullData: any;
}

interface FirmwareInfo {
  currentVersion: string;
  primaryVersion: string;
  secondaryVersion: string;
  bootedImage: 'primary' | 'secondary';
  fullData: any;
}

interface SupportedType {
  type: string;
  name: string;
  description: string;
  implemented: boolean;
}
```

---

## Error Handling

### Display User-Friendly Errors

Map backend errors to user-friendly messages:

```typescript
const errorMessages = {
  'ECONNREFUSED': {
    title: 'Connection Refused',
    message: 'Could not connect to device. Check IP address and network connectivity.',
    actions: [
      'Verify device IP address is correct',
      'Check device is powered on and reachable',
      'Verify backend server can reach device network'
    ]
  },
  'ETIMEDOUT': {
    title: 'Connection Timeout',
    message: 'Device did not respond in time.',
    actions: [
      'Check network connectivity',
      'Verify device is not overloaded',
      'Try again in a few moments'
    ]
  },
  'Authentication failed': {
    title: 'Authentication Failed',
    message: 'Invalid username or password.',
    actions: [
      'Verify username and password are correct',
      'Check user is in administrators group',
      'Ensure password is set on device'
    ]
  },
  'No credentials configured': {
    title: 'No Credentials Found',
    message: 'This device does not have API credentials configured.',
    actions: [
      'Go to Settings > API Credentials',
      'Click "Add Credential"',
      'Link credential to this device'
    ]
  }
};

function formatError(error: any): FormattedError {
  const message = error.response?.data?.error || error.message;
  const errorConfig = errorMessages[message] || {
    title: 'Connection Failed',
    message: message,
    actions: ['Check device configuration', 'Review logs for details']
  };
  return errorConfig;
}
```

---

## Progressive Enhancement

### Phase 1: Basic Testing (MVP)
- ✅ Test button in credential form
- ✅ Manual connection test page
- ✅ Basic success/error display

### Phase 2: Enhanced UX
- ✅ Connection status badges in device list
- ✅ Device detail connection status card
- ✅ Detailed device info display
- ✅ Firmware info display

### Phase 3: Advanced Features
- ✅ Test history tracking
- ✅ Automatic periodic testing
- ✅ Connection health dashboard
- ✅ Bulk device testing

---

## Implementation Priority

### High Priority (Implement First)
1. **Test button in credential form** - Users need this immediately when adding credentials
2. **Basic test results display** - Show success/failure clearly
3. **Manual connection test (diagnostics page)** - For quick validation

### Medium Priority
4. **Connection status in device list** - Visual indicator of device health
5. **Device info retrieval** - Show what we can get from API
6. **Firmware info retrieval** - Important for device management

### Low Priority (Nice to Have)
7. **Test history** - Requires backend enhancement
8. **Bulk testing** - Test multiple devices at once
9. **Auto-refresh** - Periodic background testing

---

## User Flows

### Flow 1: Adding New Credentials

```
User: Settings > API Credentials > Add Credential
├── Fills in form (name, type, device, username, password)
├── Clicks "Test Connection" (optional, before saving)
│   ├── Backend tests connection
│   ├── Success: Green alert with device info
│   └── Error: Red alert with troubleshooting steps
├── Clicks "Save"
└── Credential saved with test status
```

### Flow 2: Testing Existing Device

```
User: Devices > Device Detail > Actions > Test API Connection
├── Modal opens
├── Auto-initiates test
├── Shows progress
├── Displays results:
│   ├── Connection status
│   ├── Device information
│   └── Firmware information
└── User closes modal
```

### Flow 3: Quick Diagnostic Test

```
User: Settings > Device API Testing
├── Enters device IP, username, password
├── Selects device type
├── Clicks "Test Connection"
├── Results displayed immediately
└── Can copy details or adjust parameters and re-test
```

---

## Testing Checklist for Frontend

- [ ] Test button in credential form works
- [ ] Manual test shows loading state
- [ ] Success message displays device info
- [ ] Error message displays troubleshooting steps
- [ ] Connection test in device detail works
- [ ] Device info displays correctly
- [ ] Firmware info displays correctly
- [ ] Diagnostic page accessible to admins only
- [ ] Supported types list displays correctly
- [ ] Error handling for network failures
- [ ] Error handling for authentication failures
- [ ] Responsive design on mobile
- [ ] Accessibility (keyboard navigation, screen readers)

---

## Example Screenshots/Wireframes Needed

1. Credential form with test button and results
2. Device detail with connection status card
3. Diagnostic testing page
4. Device list with status badges
5. Error states with troubleshooting
6. Success states with device info

---

## Questions for Frontend Team

1. Which UI component library are you using? (Vuetify, Element+, etc.)
2. Preferred state management for test results? (Pinia store vs local state)
3. Should test history be cached locally or always fetch fresh?
4. Real-time testing progress updates needed? (WebSocket vs polling)
5. Mobile-first design priority?

---

## Summary

The frontend should implement:

1. **Test functionality** in credential forms
2. **Visual status indicators** for device connectivity
3. **Detailed information displays** for device/firmware data
4. **Diagnostic testing page** for admins
5. **Clear error messaging** with actionable troubleshooting

All features map directly to existing backend endpoints and require no additional backend work beyond what's already implemented.
