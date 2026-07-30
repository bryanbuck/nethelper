# Backend Task: Implement ICMP Ping Monitoring for Device Status

## Overview
Implement a real-time ICMP ping monitoring system to become the **source of truth** for device status. This will replace the current reliance on Aruba Central's status information, providing more accurate and up-to-date reachability information since the NetHelper platform runs on-premises with direct network access to devices.

## Current State Analysis

### Existing Status Flow
- **Current Source**: Aruba Central API (`/monitoring/v2/aps`, `/monitoring/v1/switches`, `/monitoring/v1/gateways`)
- **Update Frequency**: Only during manual or scheduled device sync operations
- **Status Mapping**: `device.service.js:293-302` maps Aruba statuses ("Up", "Down", "Warning", "Maintenance") to internal enums
- **Database Field**: `Device.status` (enum: online, offline, warning, maintenance)
- **Last Seen Field**: Currently populated from Aruba Central's `last_modified` timestamp

### Required Changes
Need to add independent ICMP monitoring that continuously checks device reachability and updates status in real-time.

---

## Implementation Requirements

### 1. Install ICMP Ping Package

**Action**: Add a reliable Node.js ping library to `package.json`

**Recommended Package**: `ping` (https://www.npmjs.com/package/ping)
```bash
npm install ping
```

**Alternative**: `node-ping` or `tcp-ping` if ICMP is restricted

---

### 2. Database Schema Updates

**File**: `backend/prisma/schema.prisma`

**Add New Fields to Device Model**:
```prisma
model Device {
  // ... existing fields ...

  // ICMP Monitoring Fields
  pingStatus        DeviceStatus?  // Real-time ping-based status (nullable for new implementation)
  pingLastChecked   DateTime?      // Last time ping check was performed
  pingResponseTime  Int?           // Last successful ping response time in ms
  pingSuccessRate   Float?         // Success rate percentage (0-100)
  consecutiveFailures Int @default(0) // Count of consecutive ping failures

  // Keep existing for Aruba Central data
  centralStatus     DeviceStatus?  // Status from Aruba Central (rename existing 'status')
  lastSeen          DateTime?      // Keep as-is from Aruba Central

  // ... rest of existing fields ...
}
```

**Migration Steps**:
1. Rename existing `status` field to `centralStatus`
2. Add new `pingStatus` field as the primary status
3. Add monitoring metadata fields
4. Create migration: `npx prisma migrate dev --name add_ping_monitoring`

---

### 3. Create Ping Monitoring Service

**File**: `backend/src/services/ping-monitor.service.js`

**Required Functionality**:

```javascript
const ping = require('ping');
const { getPrisma } = require('../config/database');
const { debugLog, Services } = require('../utils/debug-logger');

class PingMonitorService {
  constructor() {
    this.logger = debugLog.createLogger('PING_MONITOR');
    this.config = {
      timeout: 5, // seconds
      retries: 2,
      interval: 60000, // 60 seconds between checks
      batchSize: 20, // devices to check concurrently
      failureThreshold: 3 // consecutive failures before marking offline
    };
  }

  /**
   * Ping a single device
   * @param {string} ipAddress - Device IP address
   * @returns {Promise<{alive: boolean, time: number|null}>}
   */
  async pingDevice(ipAddress) {
    // Implement ping logic with timeout and retries
    // Return { alive: boolean, time: number|null }
  }

  /**
   * Check all devices that need monitoring
   * @returns {Promise<void>}
   */
  async checkAllDevices() {
    // 1. Fetch all devices with IP addresses
    // 2. Batch ping checks (avoid overwhelming network)
    // 3. Update database with results
    // 4. Handle status transitions with proper logging
  }

  /**
   * Update device ping status in database
   * @param {string} deviceId - Device ID
   * @param {boolean} alive - Ping result
   * @param {number|null} responseTime - Response time in ms
   */
  async updateDeviceStatus(deviceId, alive, responseTime) {
    // 1. Calculate new status based on consecutive failures
    // 2. Update pingStatus, pingLastChecked, pingResponseTime
    // 3. Calculate success rate from historical data
    // 4. Emit WebSocket event for real-time UI updates
  }

  /**
   * Calculate device status based on ping results
   * @param {boolean} alive - Current ping result
   * @param {number} consecutiveFailures - Current failure count
   * @returns {string} - 'online' | 'offline' | 'warning'
   */
  calculateStatus(alive, consecutiveFailures) {
    // Logic:
    // - alive = 'online'
    // - consecutiveFailures >= threshold = 'offline'
    // - 1-2 failures = 'warning'
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring() {
    // Set up interval to run checkAllDevices()
    // Handle graceful shutdown
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    // Clean up intervals
  }
}

module.exports = new PingMonitorService();
```

---

### 4. Create Background Job for Ping Monitoring

**File**: `backend/src/jobs/ping-monitor.job.js`

**Implementation**:
```javascript
const pingMonitorService = require('../services/ping-monitor.service');
const logger = require('../utils/logger');

module.exports = (queue) => {
  // Process ping monitoring jobs
  queue.process('checkDevices', async (job) => {
    try {
      logger.info('Starting device ping check job');
      await pingMonitorService.checkAllDevices();
      logger.info('Device ping check completed');
    } catch (error) {
      logger.error('Ping check job failed:', error);
      throw error;
    }
  });

  // Schedule recurring job (every 60 seconds)
  queue.add('checkDevices', {}, {
    repeat: {
      every: 60000, // 60 seconds
    },
    jobId: 'ping-monitor-recurring',
  });

  logger.info('Ping monitor job initialized');
};
```

---

### 5. Update Bull Queue Configuration

**File**: `backend/src/config/bull.js`

**Changes**:
```javascript
async function initializeQueues() {
  // ... existing queues ...
  queues.pingMonitor = createQueue('ping-monitor');

  // ... existing imports ...
  require('../jobs/ping-monitor.job')(queues.pingMonitor);

  logger.info('All job queues initialized');
}
```

---

### 6. Update Device Service

**File**: `backend/src/services/device.service.js`

**Changes Needed**:

1. **Update `getDevices()` method** to return `pingStatus` as the primary `status` field:
```javascript
async getDevices(filters = {}) {
  const devices = await prisma.device.findMany({
    where,
    include: { /* existing includes */ },
    orderBy: [
      { pingStatus: 'asc' }, // Sort by ping status instead of centralStatus
      { name: 'asc' },
    ],
  });

  // Map pingStatus to status for frontend compatibility
  return devices.map(device => ({
    ...device,
    status: device.pingStatus || device.centralStatus || 'offline',
    // Include both statuses for frontend
    pingStatus: device.pingStatus,
    centralStatus: device.centralStatus,
  }));
}
```

2. **Update `syncDevicesFromAruba()` method** to preserve ping monitoring data:
```javascript
async syncDevicesFromAruba() {
  // ... existing sync logic ...

  const deviceData = {
    name: arubaDevice.name || arubaDevice.serial,
    type: this.mapDeviceType(arubaDevice.device_type),
    model: arubaDevice.model,
    ipAddress: arubaDevice.ip_address,
    macAddress: arubaDevice.mac_address,
    location: arubaDevice.site,
    centralStatus: this.mapDeviceStatus(arubaDevice.status), // NEW: use centralStatus
    firmwareVersion: arubaDevice.firmware_version,
    lastSeen: arubaDevice.last_modified ? new Date(arubaDevice.last_modified * 1000) : null,
    // DO NOT update pingStatus here - let ping monitor handle it
  };

  // ... rest of sync logic ...
}
```

---

### 7. WebSocket Event Emission

**File**: `backend/src/services/ping-monitor.service.js`

**Add WebSocket Support**:
```javascript
async updateDeviceStatus(deviceId, alive, responseTime) {
  // ... update database ...

  // Emit real-time update to connected clients
  const io = require('../websocket/socket').getIO();
  if (io) {
    io.emit('device:status:update', {
      deviceId,
      status: newStatus,
      pingStatus: newStatus,
      pingResponseTime: responseTime,
      pingLastChecked: new Date(),
    });
  }
}
```

---

### 8. API Endpoint for Manual Ping Check

**File**: `backend/src/routes/device.routes.js`

**Add New Route**:
```javascript
// Manually trigger ping check for specific device
router.post('/:deviceId/ping',
  authorize('admin', 'operator'),
  deviceController.pingDevice
);

// Trigger ping check for all devices
router.post('/ping/all',
  authorize('admin', 'operator'),
  deviceController.pingAllDevices
);
```

**File**: `backend/src/controllers/device.controller.js`

**Add Methods**:
```javascript
async pingDevice(req, res, next) {
  try {
    const { deviceId } = req.params;
    const pingMonitorService = require('../services/ping-monitor.service');

    const device = await deviceService.getDevice(deviceId);
    if (!device) {
      return res.status(404).json({
        success: false,
        error: 'Device not found',
      });
    }

    if (!device.ipAddress) {
      return res.status(400).json({
        success: false,
        error: 'Device does not have an IP address configured',
      });
    }

    const result = await pingMonitorService.pingDevice(device.ipAddress);
    await pingMonitorService.updateDeviceStatus(deviceId, result.alive, result.time);

    res.json({
      success: true,
      data: {
        deviceId,
        ipAddress: device.ipAddress,
        alive: result.alive,
        responseTime: result.time,
      },
    });
  } catch (error) {
    next(error);
  }
}

async pingAllDevices(req, res, next) {
  try {
    const pingMonitorService = require('../services/ping-monitor.service');

    // Queue the job instead of running synchronously
    const { getQueue } = require('../config/bull');
    const pingMonitorQueue = getQueue('pingMonitor');

    const job = await pingMonitorQueue.add('checkDevices', {
      triggeredBy: req.user.id,
      manual: true,
    });

    res.json({
      success: true,
      message: 'Ping check for all devices has been queued',
      jobId: job.id,
    });
  } catch (error) {
    next(error);
  }
}
```

---

### 9. Startup Integration

**File**: `backend/server.js` or `backend/src/app.js`

**Add Monitoring Startup**:
```javascript
const pingMonitorService = require('./services/ping-monitor.service');

// After database connection and queue initialization
async function startServer() {
  // ... existing startup code ...

  // Start ping monitoring
  pingMonitorService.startMonitoring();
  logger.info('Ping monitoring started');

  // ... rest of startup ...
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  pingMonitorService.stopMonitoring();
  // ... other cleanup ...
});
```

---

## Frontend Integration Points

**The frontend will need to**:
1. Use `pingStatus` field as the primary device status
2. Display `centralStatus` in a new "Central Status" column
3. Show ping metadata (response time, last checked) in device details
4. Listen for WebSocket `device:status:update` events for real-time updates

---

## Testing Checklist

- [ ] Database migration completes successfully
- [ ] Ping monitoring service can ping devices with various network conditions
- [ ] Background job runs on schedule without errors
- [ ] Device status updates correctly based on ping results
- [ ] WebSocket events are emitted on status changes
- [ ] API endpoints for manual ping checks work correctly
- [ ] Graceful shutdown stops monitoring cleanly
- [ ] Performance is acceptable with 100+ devices
- [ ] Consecutive failure threshold logic works correctly
- [ ] Frontend receives and displays updated status in real-time

---

## Performance Considerations

1. **Batch Processing**: Check devices in batches to avoid overwhelming the network
2. **Configurable Intervals**: Allow adjustment of ping check frequency
3. **Database Indexing**: Ensure `pingStatus` and `pingLastChecked` fields are indexed
4. **Error Handling**: Handle network timeouts gracefully
5. **Logging**: Use appropriate log levels to avoid log spam

---

## Configuration

**Add to `.env`**:
```env
PING_MONITOR_ENABLED=true
PING_MONITOR_INTERVAL=60000
PING_MONITOR_TIMEOUT=5
PING_MONITOR_BATCH_SIZE=20
PING_MONITOR_FAILURE_THRESHOLD=3
```

---

## Rollback Plan

If issues arise, the system can fall back to `centralStatus` by:
1. Setting `PING_MONITOR_ENABLED=false`
2. Updating frontend to use `centralStatus` instead of `pingStatus`
3. No data loss occurs since both statuses are maintained
