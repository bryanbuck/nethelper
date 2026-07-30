# Backend Task: Track API Communication Success for Device Status

## Overview
Enhance the existing device polling infrastructure to track **any successful API communication** with devices, not just when a manual "test" is run. This will provide a more accurate view of device API connectivity by updating status fields whenever the application successfully communicates with a device.

## Current State Analysis

### Existing API Communication
**File**: `backend/src/services/device-poller.service.js`

You already have a robust device polling system with:
- ✅ **makeDeviceRequest()** method (line 142-188) - Makes authenticated API requests to devices
- ✅ **Multiple poller modules**: firmware, system, backup, login-sessions
- ✅ **Parallel bulk polling** support
- ✅ **Error handling and logging**

### Current API Test Tracking
**File**: `backend/src/services/settings.service.js`

API credential testing currently updates:
- `ApiCredential.lastTested` - Timestamp of last test
- `ApiCredential.lastTestStatus` - 'success' or 'failed'

**Problem**: These fields are only updated when a **manual test** is triggered via the Settings page. Actual device polling operations (firmware checks, system info, etc.) don't update these fields.

---

## Implementation Requirements

### 1. Database Schema Updates

**File**: `backend/prisma/schema.prisma`

**Add API Communication Tracking to Device Model**:
```prisma
model Device {
  // ... existing fields ...

  // API Communication Tracking
  apiLastCommunication   DateTime?     // Last successful API communication
  apiLastAttempt         DateTime?     // Last API attempt (success or failure)
  apiResponseTime        Int?          // Last response time in ms
  apiSuccessRate         Float?        // Success rate percentage (0-100)
  apiConsecutiveFailures Int @default(0) // Consecutive API failures
  apiError               String?       // Last error message if any

  // ... existing fields ...
}
```

**Migration**:
```bash
npx prisma migrate dev --name add_api_tracking
```

---

### 2. Update Device Poller Service

**File**: `backend/src/services/device-poller.service.js`

**Enhance makeDeviceRequest() method** to track communication metrics:

```javascript
async makeDeviceRequest(baseUrl, path, credentials, options = {}) {
  const startTime = Date.now();
  const deviceIp = baseUrl.match(/https?:\/\/([^:/]+)/)?.[1];

  try {
    const url = `${baseUrl}${path}`;

    // ... existing axios config setup ...

    const response = await axios(config);
    const responseTime = Date.now() - startTime;

    // Track successful API communication
    if (deviceIp) {
      await this.trackApiSuccess(deviceIp, responseTime);
    }

    return response.data;
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Track failed API communication
    if (deviceIp) {
      await this.trackApiFailure(deviceIp, error.message, responseTime);
    }

    // ... existing error handling ...
    throw error;
  }
}
```

**Add tracking methods to DevicePollerService**:

```javascript
/**
 * Track successful API communication
 * @param {string} ipAddress - Device IP address
 * @param {number} responseTime - Response time in milliseconds
 */
async trackApiSuccess(ipAddress, responseTime) {
  try {
    const prisma = getPrisma();

    // Find device by IP address
    const device = await prisma.device.findFirst({
      where: { ipAddress },
    });

    if (!device) {
      logger.warn(`Device not found for IP ${ipAddress}, skipping API tracking`);
      return;
    }

    // Calculate new success rate
    const currentSuccessRate = device.apiSuccessRate || 0;
    const newSuccessRate = Math.min(100, currentSuccessRate + 10); // Increase by 10%, max 100%

    // Update device API tracking fields
    await prisma.device.update({
      where: { id: device.id },
      data: {
        apiLastCommunication: new Date(),
        apiLastAttempt: new Date(),
        apiResponseTime: responseTime,
        apiSuccessRate: newSuccessRate,
        apiConsecutiveFailures: 0, // Reset failure counter
        apiError: null, // Clear previous error
        updatedAt: new Date(),
      },
    });

    logger.debug(`API success tracked for ${device.name}`, {
      responseTime: `${responseTime}ms`,
      successRate: `${newSuccessRate}%`,
    });

    // Emit WebSocket event for real-time UI updates
    this.emitApiStatusUpdate(device.id, {
      status: 'connected',
      lastCommunication: new Date(),
      responseTime,
      successRate: newSuccessRate,
    });
  } catch (error) {
    logger.error('Failed to track API success', { error: error.message, ipAddress });
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Track failed API communication
 * @param {string} ipAddress - Device IP address
 * @param {string} errorMessage - Error message
 * @param {number} responseTime - Time taken before failure
 */
async trackApiFailure(ipAddress, errorMessage, responseTime) {
  try {
    const prisma = getPrisma();

    // Find device by IP address
    const device = await prisma.device.findFirst({
      where: { ipAddress },
    });

    if (!device) {
      logger.warn(`Device not found for IP ${ipAddress}, skipping API tracking`);
      return;
    }

    const consecutiveFailures = (device.apiConsecutiveFailures || 0) + 1;

    // Calculate new success rate
    const currentSuccessRate = device.apiSuccessRate || 100;
    const newSuccessRate = Math.max(0, currentSuccessRate - 15); // Decrease by 15%, min 0%

    // Update device API tracking fields
    await prisma.device.update({
      where: { id: device.id },
      data: {
        apiLastAttempt: new Date(),
        apiSuccessRate: newSuccessRate,
        apiConsecutiveFailures: consecutiveFailures,
        apiError: errorMessage.substring(0, 500), // Limit error length
        updatedAt: new Date(),
      },
    });

    logger.warn(`API failure tracked for ${device.name}`, {
      consecutiveFailures,
      successRate: `${newSuccessRate}%`,
      error: errorMessage,
    });

    // Emit WebSocket event for real-time UI updates
    this.emitApiStatusUpdate(device.id, {
      status: 'failed',
      lastAttempt: new Date(),
      error: errorMessage,
      successRate: newSuccessRate,
      consecutiveFailures,
    });
  } catch (error) {
    logger.error('Failed to track API failure', { error: error.message, ipAddress });
    // Don't throw - this is a non-critical operation
  }
}

/**
 * Emit WebSocket event for API status updates
 * @param {string} deviceId - Device ID
 * @param {Object} statusData - Status data to emit
 */
emitApiStatusUpdate(deviceId, statusData) {
  try {
    const io = require('../websocket/socket').getIO();
    if (io) {
      io.emit('device:api:status', {
        deviceId,
        ...statusData,
        timestamp: new Date(),
      });
    }
  } catch (error) {
    logger.error('Failed to emit API status update', { error: error.message });
  }
}
```

---

### 3. Update Settings Service (API Credential Testing)

**File**: `backend/src/services/settings.service.js`

**Update the credential test method** to also update device API tracking:

```javascript
async testApiCredential(credentialId) {
  const startTime = Date.now();

  try {
    // ... existing credential retrieval ...
    // ... existing test logic ...

    const responseTime = Date.now() - startTime;

    // Update credential test status (existing behavior)
    await prisma.apiCredential.update({
      where: { id: credentialId },
      data: {
        lastTested: new Date(),
        lastTestStatus: 'success',
        updatedAt: new Date(),
      },
    });

    // NEW: Also update device API tracking if device is associated
    const devicesUsingCredential = await prisma.device.findMany({
      where: { apiCredentialId: credentialId },
    });

    for (const device of devicesUsingCredential) {
      if (device.ipAddress) {
        const devicePollerService = require('./device-poller.service');
        await devicePollerService.trackApiSuccess(device.ipAddress, responseTime);
      }
    }

    return { success: true, responseTime };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    // Update credential test status (existing behavior)
    await prisma.apiCredential.update({
      where: { id: credentialId },
      data: {
        lastTested: new Date(),
        lastTestStatus: 'failed',
        updatedAt: new Date(),
      },
    });

    // NEW: Also update device API tracking if device is associated
    const devicesUsingCredential = await prisma.device.findMany({
      where: { apiCredentialId: credentialId },
    });

    for (const device of devicesUsingCredential) {
      if (device.ipAddress) {
        const devicePollerService = require('./device-poller.service');
        await devicePollerService.trackApiFailure(device.ipAddress, error.message, responseTime);
      }
    }

    throw error;
  }
}
```

---

### 4. Update Device Service (GET Devices)

**File**: `backend/src/services/device.service.js`

**Include API tracking fields** in device queries:

```javascript
async getDevices(filters = {}) {
  // ... existing code ...

  const devices = await prisma.device.findMany({
    where,
    include: {
      apiCredential: {
        select: {
          id: true,
          name: true,
          type: true,
          lastTested: true,
          lastTestStatus: true,
        },
      },
      // ... existing includes ...
    },
    // ... existing orderBy ...
  });

  // Return devices with computed API status
  return devices.map(device => ({
    ...device,
    // Compute real-time API status based on tracking data
    apiStatus: this.computeApiStatus(device),
  }));
}

/**
 * Compute API status based on tracking data
 * @param {Object} device - Device object
 * @returns {string} - 'connected' | 'failed' | 'untested' | 'no-credentials'
 */
computeApiStatus(device) {
  if (!device.apiCredentialId) {
    return 'no-credentials';
  }

  if (!device.apiLastAttempt && !device.apiLastCommunication) {
    return 'untested';
  }

  // Check if last communication was recent and successful
  if (device.apiLastCommunication) {
    const timeSinceLastComm = Date.now() - new Date(device.apiLastCommunication).getTime();
    const fiveMinutes = 5 * 60 * 1000;

    if (timeSinceLastComm < fiveMinutes && device.apiConsecutiveFailures === 0) {
      return 'connected';
    }
  }

  // Check consecutive failures
  if (device.apiConsecutiveFailures >= 3) {
    return 'failed';
  }

  // Check success rate
  if (device.apiSuccessRate !== null && device.apiSuccessRate < 50) {
    return 'degraded';
  }

  return 'unknown';
}
```

---

### 5. Add API Status Endpoint

**File**: `backend/src/routes/device.routes.js`

**Add endpoint to get API status for devices**:

```javascript
// Get API communication status for device
router.get('/:deviceId/api-status', deviceController.getApiStatus);

// Get API communication history (optional, for detailed view)
router.get('/:deviceId/api-history', deviceController.getApiHistory);
```

**File**: `backend/src/controllers/device.controller.js`

**Add controller methods**:

```javascript
async getApiStatus(req, res, next) {
  try {
    const { deviceId } = req.params;

    const device = await deviceService.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    const apiStatus = deviceService.computeApiStatus(device);

    res.json({
      success: true,
      data: {
        deviceId,
        deviceName: device.name,
        ipAddress: device.ipAddress,
        status: apiStatus,
        lastCommunication: device.apiLastCommunication,
        lastAttempt: device.apiLastAttempt,
        responseTime: device.apiResponseTime,
        successRate: device.apiSuccessRate,
        consecutiveFailures: device.apiConsecutiveFailures,
        error: device.apiError,
        hasCredentials: !!device.apiCredentialId,
      },
    });
  } catch (error) {
    next(error);
  }
}
```

---

### 6. WebSocket Event Handling

**File**: `backend/src/websocket/socket.js`

Ensure WebSocket is configured to handle device API status events:

```javascript
// Existing device status updates
socket.on('device:subscribe', (deviceId) => {
  socket.join(`device:${deviceId}`);
});

// NEW: Subscribe to API status updates
socket.on('device:api:subscribe', (deviceId) => {
  socket.join(`device-api:${deviceId}`);
});
```

---

### 7. Background Cleanup Job (Optional)

**File**: `backend/src/jobs/api-tracking-cleanup.job.js`

**Create a job to periodically decay success rates** for devices that haven't been contacted recently:

```javascript
const { getPrisma } = require('../config/database');
const logger = require('../utils/logger');

module.exports = (queue) => {
  queue.process('decaySuccessRates', async (job) => {
    try {
      const prisma = getPrisma();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // Find devices with no recent API communication
      const staleDevices = await prisma.device.findMany({
        where: {
          apiLastAttempt: {
            lt: oneDayAgo,
          },
          apiSuccessRate: {
            gt: 0,
          },
        },
      });

      // Decay success rate by 5% per day
      for (const device of staleDevices) {
        await prisma.device.update({
          where: { id: device.id },
          data: {
            apiSuccessRate: Math.max(0, (device.apiSuccessRate || 0) - 5),
          },
        });
      }

      logger.info(`Decayed success rate for ${staleDevices.length} stale devices`);
    } catch (error) {
      logger.error('API tracking cleanup job failed:', error);
      throw error;
    }
  });

  // Run daily at 3 AM
  queue.add('decaySuccessRates', {}, {
    repeat: {
      cron: '0 3 * * *',
    },
    jobId: 'api-tracking-cleanup',
  });

  logger.info('API tracking cleanup job initialized');
};
```

**Update** `backend/src/config/bull.js`:
```javascript
async function initializeQueues() {
  // ... existing queues ...
  queues.apiTracking = createQueue('api-tracking');

  // ... existing imports ...
  require('../jobs/api-tracking-cleanup.job')(queues.apiTracking);

  logger.info('All job queues initialized');
}
```

---

## Integration Points

### Automatic Tracking Triggers
The following operations will now automatically update API tracking:

1. **Device Polling** (firmware, system, backup, login-sessions)
2. **API Credential Testing** (Settings page)
3. **Manual API Calls** (any future device API operations)

### Frontend Impact
**No frontend changes required** - the frontend already displays:
- `apiStatus` column in the device table
- API credential status in device edit dialog
- Last tested timestamps

The frontend will automatically benefit from:
- ✅ More accurate API status (updated on every poll, not just tests)
- ✅ Real-time WebSocket updates when API status changes
- ✅ Better visibility into API connectivity issues

---

## Testing Checklist

- [ ] Database migration adds new fields successfully
- [ ] API success tracking updates database correctly
- [ ] API failure tracking increments consecutive failures
- [ ] Success rate calculation works correctly
- [ ] WebSocket events are emitted on status changes
- [ ] Multiple devices can be tracked concurrently without issues
- [ ] Performance is acceptable with frequent API calls
- [ ] Credential testing updates both credential and device tracking
- [ ] Frontend displays updated API status in real-time
- [ ] Cleanup job decays stale success rates correctly

---

## Configuration

**Add to `.env`** (optional):
```env
API_TRACKING_ENABLED=true
API_SUCCESS_RATE_INCREMENT=10
API_SUCCESS_RATE_DECREMENT=15
API_FAILURE_THRESHOLD=3
API_TRACKING_DECAY_RATE=5
```

---

## Performance Considerations

1. **Non-blocking tracking**: Use `await` but don't fail the main operation if tracking fails
2. **Batch updates**: Consider batching database updates if polling many devices
3. **Error handling**: Wrap tracking in try-catch to prevent disrupting main operations
4. **Indexing**: Ensure `ipAddress` field is indexed for fast lookups
5. **WebSocket throttling**: Consider rate-limiting WebSocket emissions

---

## Benefits

1. **Real-time accuracy**: API status reflects actual device communication, not just manual tests
2. **Better monitoring**: Success rate provides historical perspective
3. **Proactive alerts**: Consecutive failures can trigger notifications
4. **No frontend changes**: Existing UI benefits immediately
5. **Comprehensive tracking**: All API operations contribute to status picture
