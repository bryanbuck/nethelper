# Device Polling API - Frontend Integration Guide

## Overview

The Device Polling API provides the capability to poll information directly from network devices using device-specific APIs, separate from Aruba Central. This is a modular system that currently supports firmware version polling from AOS-CX switches, with the architecture designed to easily add additional data collection capabilities in the future.

### Key Features

- **Direct Device Access**: Polls information directly from devices using their native APIs
- **Bulk Operations**: Support for polling multiple devices in a single request
- **Parallel Execution**: All device polls run in parallel for optimal performance
- **Modular Architecture**: Easy to extend with new polling capabilities
- **Robust Error Handling**: Graceful handling of device failures with per-device error reporting

## Authentication & Authorization

All endpoints require:
- **Authentication**: Valid JWT token
- **Authorization**: `admin` or `operator` role

Include the JWT token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## API Endpoints

### 1. Get Available Pollers

Retrieve a list of all available polling modules.

**Endpoint**: `GET /api/v1/devices/poll/pollers`

**Authorization**: Viewer, Operator, or Admin

**Response**:
```json
{
  "success": true,
  "pollers": ["firmware"]
}
```

---

### 2. Poll Devices

Poll one or more devices for specific information using a designated poller.

**Endpoint**: `POST /api/v1/devices/poll`

**Authorization**: Operator or Admin

**Request Body**:
```json
{
  "poller": "firmware",
  "deviceIds": [
    "uuid-of-device-1",
    "uuid-of-device-2",
    "uuid-of-device-3"
  ]
}
```

**Request Parameters**:
- `poller` (string, required): Name of the poller to use (e.g., "firmware")
- `deviceIds` (array, required): Array of device UUIDs to poll (minimum 1 device)

**Success Response** (200 OK):
```json
{
  "success": true,
  "poller": "firmware",
  "summary": {
    "total": 3,
    "successful": 2,
    "failed": 1
  },
  "results": [
    {
      "deviceId": "uuid-of-device-1",
      "success": true,
      "data": {
        "booted_image": "primary",
        "current_image": "primary",
        "default_image": "primary",
        "primary_version": "10.13.1010",
        "secondary_version": "10.12.1030"
      },
      "timestamp": "2025-10-03T14:30:00.000Z"
    },
    {
      "deviceId": "uuid-of-device-2",
      "success": true,
      "data": {
        "booted_image": "primary",
        "current_image": "primary",
        "default_image": "primary",
        "primary_version": "10.13.1010",
        "secondary_version": "10.11.1020"
      },
      "timestamp": "2025-10-03T14:30:00.000Z"
    },
    {
      "deviceId": "uuid-of-device-3",
      "success": false,
      "error": "Device unreachable: ETIMEDOUT",
      "timestamp": "2025-10-03T14:30:15.000Z"
    }
  ]
}
```

**Error Response** (400 Bad Request) - Missing Poller:
```json
{
  "success": false,
  "error": "Poller name is required",
  "availablePollers": ["firmware"]
}
```

**Error Response** (400 Bad Request) - Missing or Invalid Device IDs:
```json
{
  "success": false,
  "error": "deviceIds array is required and must contain at least one device ID"
}
```

**Error Response** (500 Internal Server Error) - Invalid Poller:
```json
{
  "success": false,
  "error": "Poller 'invalid-poller' not found. Available pollers: firmware"
}
```

## Firmware Poller

The `firmware` poller retrieves firmware version information from network devices.

### Supported Devices
- **AOS-CX Switches**: Uses REST API v10.15 endpoint `/rest/v10.15/firmware`

### Response Fields

When successful, the firmware poller returns the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `booted_image` | string \| null | The partition that was booted (e.g., "primary", "secondary") |
| `current_image` | string \| null | The currently active firmware image |
| `default_image` | string \| null | The default boot partition |
| `primary_version` | string \| null | Firmware version on the primary partition |
| `secondary_version` | string \| null | Firmware version on the secondary partition |

### Prerequisites

For the firmware poller to work:
1. Device must have an IP address configured in the database
2. Device must have valid API credentials configured in Settings
3. Device must be reachable on the network
4. Credentials must have API access permissions on the device

## Frontend Implementation Examples

### Example 1: Poll Firmware for Selected Devices

```javascript
async function pollDeviceFirmware(deviceIds) {
  try {
    const response = await fetch('/api/v1/devices/poll', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        poller: 'firmware',
        deviceIds: deviceIds
      })
    });

    const result = await response.json();

    if (!result.success) {
      console.error('Polling failed:', result.error);
      return;
    }

    // Process results
    console.log(`Polled ${result.summary.total} devices`);
    console.log(`Success: ${result.summary.successful}, Failed: ${result.summary.failed}`);

    result.results.forEach(deviceResult => {
      if (deviceResult.success) {
        console.log(`Device ${deviceResult.deviceId}:`, deviceResult.data);
        // Update UI with firmware info
      } else {
        console.error(`Device ${deviceResult.deviceId} failed:`, deviceResult.error);
        // Show error in UI
      }
    });

  } catch (error) {
    console.error('Network error:', error);
  }
}
```

### Example 2: Display Firmware Information in a Table

```javascript
function displayFirmwareResults(results) {
  return results.map(result => {
    if (!result.success) {
      return {
        deviceId: result.deviceId,
        status: 'Error',
        error: result.error,
        primary: '-',
        secondary: '-',
        booted: '-'
      };
    }

    return {
      deviceId: result.deviceId,
      status: 'Success',
      error: null,
      primary: result.data.primary_version || 'N/A',
      secondary: result.data.secondary_version || 'N/A',
      booted: result.data.booted_image || 'N/A',
      timestamp: new Date(result.timestamp).toLocaleString()
    };
  });
}
```

### Example 3: Check Available Pollers Before Polling

```javascript
async function getAvailablePollers() {
  try {
    const response = await fetch('/api/v1/devices/poll/pollers', {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const result = await response.json();

    if (result.success) {
      console.log('Available pollers:', result.pollers);
      return result.pollers;
    }
  } catch (error) {
    console.error('Failed to get pollers:', error);
  }
}
```

## Error Handling Best Practices

### 1. Handle Per-Device Errors

Since polling uses `Promise.allSettled()`, individual device failures don't abort the entire operation. Always check the `success` field for each device in the results array.

```javascript
const successfulDevices = results.filter(r => r.success);
const failedDevices = results.filter(r => !r.success);

// Handle successful devices
successfulDevices.forEach(device => {
  updateDeviceUI(device.deviceId, device.data);
});

// Show errors for failed devices
failedDevices.forEach(device => {
  showError(`${device.deviceId}: ${device.error}`);
});
```

### 2. Common Error Messages

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Device not found" | Device UUID doesn't exist in database | Verify device ID is correct |
| "Device has no IP address configured" | Device record missing IP address | Configure IP address in device settings |
| "No credentials found for device" | No API credentials configured | Add device credentials in Settings |
| "Device unreachable: ETIMEDOUT" | Network connectivity issue | Check device is online and accessible |
| "Device API error (401)" | Authentication failed | Verify credentials are correct |
| "Device API error (403)" | Authorization failed | Check credential permissions |
| "Firmware polling not yet implemented for device type: ap" | Device type not supported | Currently only switches are supported |

### 3. Timeout Handling

Device polls have a 15-second timeout. If devices are slow to respond, you may see timeout errors. Consider showing a loading indicator for at least 20 seconds.

## Future Pollers

The modular architecture supports adding new pollers. Future pollers might include:

- **config** - Retrieve device configuration
- **stats** - Get device statistics (CPU, memory, uptime)
- **interfaces** - Poll interface status and statistics
- **neighbors** - Get LLDP/CDP neighbor information
- **logs** - Retrieve recent device logs

When new pollers are added, they will automatically appear in the `/poll/pollers` endpoint response.

## Testing Recommendations

1. **Test with a single device first** before polling many devices
2. **Verify device has credentials** configured before polling
3. **Check device connectivity** to ensure it's reachable
4. **Handle partial failures gracefully** - some devices may succeed while others fail
5. **Show progress indicators** during polling operations (can take 5-15 seconds)
6. **Display timestamps** to show data freshness

## Rate Limiting

Currently there are no specific rate limits for device polling beyond the standard API rate limits. However:

- Avoid polling the same devices repeatedly in quick succession
- Consider implementing a minimum 30-second interval between polls
- The backend already uses parallel execution, so there's no performance benefit to splitting requests

## Support & Questions

For issues or questions about the Device Polling API:
- Check device and credential configuration in Settings
- Review backend logs for detailed error messages
- Verify network connectivity to devices
- Ensure devices support the required API endpoints (AOS-CX v10.15+)
