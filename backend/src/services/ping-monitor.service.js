const ping = require('ping');
const { getPrisma } = require('../config/database');
const logger = require('../utils/logger');
const alertService = require('./alert.service');
const deviceEvents = require('./device-events.service');
const { effectiveStatus } = require('../utils/device-status');

// Could be what answers its address: directly managed, or its cloud sees it.
const canAnswer = (d) => d.managementMode !== 'cloud' || d.cloudStatus === 'online';

/**
 * Split a sweep's devices into those to ping and those that step aside
 * because another device holds their address. A cloud-managed device its
 * cloud reports offline, sharing its IP with a device that can be answering
 * (directly managed, or its cloud reports it online), isn't pinged: the reply
 * belongs to the other one (a cloud keeps an offline device's last IP after
 * another device took it). Its ping result is cleared instead, so its status
 * is the cloud's `offline` rather than `warning`. Any other shared address
 * (every holder offline, or plain duplicates) is pinged for each device as
 * before.
 * @returns {{ toPing: Object[], stepAside: Array<{ device: Object, answeredBy: Object }> }}
 */
function splitSharedAddresses(devices) {
  const byIp = new Map();
  for (const d of devices) byIp.set(d.ipAddress, [...(byIp.get(d.ipAddress) || []), d]);
  const toPing = [];
  const stepAside = [];
  for (const group of byIp.values()) {
    const answering = group.find((d) => d.managementMode === 'cloud' && d.cloudStatus === 'online')
      || group.find(canAnswer);
    for (const d of group) {
      if (answering && d.managementMode === 'cloud' && d.cloudStatus === 'offline') {
        stepAside.push({ device: d, answeredBy: { id: answering.id, name: answering.name } });
      } else {
        toPing.push(d);
      }
    }
  }
  return { toPing, stepAside };
}

class PingMonitorService {
  constructor() {
    this.config = {
      timeout: parseInt(process.env.PING_MONITOR_TIMEOUT) || 5, // seconds
      retries: 2,
      interval: parseInt(process.env.PING_MONITOR_INTERVAL) || 60000, // 60 seconds
      batchSize: parseInt(process.env.PING_MONITOR_BATCH_SIZE) || 20, // devices to check concurrently
      failureThreshold: parseInt(process.env.PING_MONITOR_FAILURE_THRESHOLD) || 3, // consecutive failures before marking offline
    };
    // Sweeps are scheduled only by the Bull repeatable job (jobs/ping-monitor.job.js).
    // A second scheduler here once pinged every device twice a minute, with the
    // two sweeps sharing these stats and both counting consecutive failures.
    this.lastCheckStats = {
      total: 0,
      successful: 0,
      failed: 0,
      timestamp: null,
    };
  }

  /**
   * Ping a single device
   * @param {string} ipAddress - Device IP address
   * @returns {Promise<{alive: boolean, time: number|null}>}
   */
  async pingDevice(ipAddress) {
    try {
      const config = {
        timeout: this.config.timeout,
        extra: ['-c', '1'], // Send only 1 packet
      };

      const result = await ping.promise.probe(ipAddress, config);

      return {
        alive: result.alive,
        time: result.alive && result.time !== 'unknown' ? Math.round(parseFloat(result.time)) : null,
      };
    } catch (error) {
      logger.error(`Error pinging device ${ipAddress}:`, error);
      return {
        alive: false,
        time: null,
      };
    }
  }

  /**
   * Ping device with retries
   * @param {string} ipAddress - Device IP address
   * @returns {Promise<{alive: boolean, time: number|null}>}
   */
  async pingDeviceWithRetries(ipAddress) {
    let lastResult = { alive: false, time: null };

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      lastResult = await this.pingDevice(ipAddress);

      if (lastResult.alive) {
        return lastResult;
      }

      // Wait 1 second between retries
      if (attempt < this.config.retries) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return lastResult;
  }

  /**
   * Check all devices that need monitoring
   * @returns {Promise<void>}
   */
  async checkAllDevices() {
    const prisma = getPrisma();

    try {
      // Fetch all devices with IP addresses
      const devices = await prisma.device.findMany({
        where: {
          ipAddress: {
            not: null,
          },
        },
        select: {
          id: true,
          name: true,
          ipAddress: true,
          consecutiveFailures: true,
          pingStatus: true,
          // The cloud's view, so a device it reports online reads as "unreachable from here"
          managementMode: true,
          cloudStatus: true,
          cloudIntegration: { select: { name: true } },
        },
      });

      if (devices.length === 0) {
        logger.debug('No devices with IP addresses found for ping monitoring');
        return;
      }

      const { toPing, stepAside } = splitSharedAddresses(devices);
      for (const { device, answeredBy } of stepAside) {
        await this.stepAside(device, answeredBy).catch((error) => {
          logger.error(`Error clearing the ping result of ${device.name}:`, error);
        });
      }

      logger.info(`Starting ping check for ${toPing.length} devices${stepAside.length ? ` (${stepAside.length} not pinged: another device holds their address)` : ''}`);

      // Reset stats
      this.lastCheckStats = {
        total: toPing.length,
        successful: 0,
        failed: 0,
        notPinged: stepAside.length,
        timestamp: new Date(),
      };

      // Process devices in batches
      for (let i = 0; i < toPing.length; i += this.config.batchSize) {
        const batch = toPing.slice(i, i + this.config.batchSize);

        await Promise.all(
          batch.map(async (device) => {
            try {
              const result = await this.pingDeviceWithRetries(device.ipAddress);
              await this.updateDeviceStatus(device.id, device.name, result.alive, result.time, device.consecutiveFailures, device.pingStatus, device);

              if (result.alive) {
                this.lastCheckStats.successful++;
              } else {
                this.lastCheckStats.failed++;
              }
            } catch (error) {
              logger.error(`Error checking device ${device.name} (${device.ipAddress}):`, error);
              this.lastCheckStats.failed++;
            }
          })
        );

        // Small delay between batches to avoid overwhelming the network
        if (i + this.config.batchSize < toPing.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info(`Ping check completed: ${this.lastCheckStats.successful} successful, ${this.lastCheckStats.failed} failed out of ${this.lastCheckStats.total} devices`);
    } catch (error) {
      logger.error('Error in checkAllDevices:', error);
      throw error;
    }
  }

  /**
   * Update device ping status in database
   * @param {string} deviceId - Device ID
   * @param {string} deviceName - Device name for logging
   * @param {boolean} alive - Ping result
   * @param {number|null} responseTime - Response time in ms
   * @param {number} currentFailures - Current consecutive failures count
   * @param {string|null} currentStatus - Current ping status
   * @param {Object} [cloud] - { managementMode, cloudStatus, cloudIntegration: { name } }
   */
  async updateDeviceStatus(deviceId, deviceName, alive, responseTime, currentFailures, currentStatus, cloud = {}) {
    const prisma = getPrisma();

    try {
      // Calculate new consecutive failures count
      const newConsecutiveFailures = alive ? 0 : currentFailures + 1;

      // Calculate new status
      const newStatus = this.calculateStatus(alive, newConsecutiveFailures);

      // Get current ping stats for success rate calculation
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { pingSuccessRate: true, pingLastSeen: true },
      });

      // Calculate new success rate (exponential moving average)
      let newSuccessRate = device.pingSuccessRate || 50; // Start at 50% if no data
      const weight = 0.2; // Weight for new measurement
      const successValue = alive ? 100 : 0;
      newSuccessRate = (weight * successValue) + ((1 - weight) * newSuccessRate);

      // Update database - include lastSeen when device responds successfully
      const updateData = {
        pingStatus: newStatus,
        pingLastChecked: new Date(),
        pingResponseTime: responseTime,
        pingSuccessRate: Math.round(newSuccessRate * 100) / 100, // Round to 2 decimals
        consecutiveFailures: newConsecutiveFailures,
      };

      // Update lastSeen timestamp when device is alive (successful ping)
      if (alive) {
        updateData.lastSeen = new Date();
        updateData.pingLastSeen = updateData.lastSeen;
      }

      await prisma.device.update({
        where: { id: deviceId },
        data: updateData,
      });

      // Log status transitions
      if (currentStatus !== newStatus) {
        logger.info(`Device ${deviceName} status changed: ${currentStatus || 'unknown'} -> ${newStatus}`);

        // Emit WebSocket event for real-time UI updates
        this.emitStatusUpdate(deviceId, deviceName, newStatus, responseTime, cloud, updateData.pingLastSeen);

        if (newStatus === 'online') alertService.clear('device.offline', { subjectKey: deviceId, deviceId });
      }
      await this.recordPingState(deviceId, deviceName, newStatus, currentStatus !== newStatus, device.pingLastSeen);

      // Every offline check, not only the transition, so a device that was
      // already offline when alerting started still gets an alert. Repeats
      // of an open one are no-ops.
      if (newStatus === 'offline') {
        // Its cloud still hearing from it means the device is up and
        // NetHelper can't reach it (no route, ICMP filtered): say so.
        const cloudUp = effectiveStatus({ ...cloud, pingStatus: newStatus }) === 'warning';
        const cloudName = cloud.cloudIntegration?.name || 'Its cloud';
        alertService.raise('device.offline', {
          subjectKey: deviceId,
          deviceId,
          title: cloudUp ? `${deviceName} is not answering ping` : `${deviceName} is offline`,
          message: cloudUp
            ? `Stopped answering ping from NetHelper, but ${cloudName} reports it online. NetHelper probably has no route to it, or ICMP is filtered.`
            : `Stopped answering ping (${this.config.failureThreshold} or more missed checks in a row).`,
          data: { consecutiveFailures: newConsecutiveFailures, ...(cloudUp && { cloudStatus: 'online' }) },
        }, { bump: currentStatus !== 'offline' });
      }
    } catch (error) {
      logger.error(`Error updating device status for ${deviceName}:`, error);
      throw error;
    }
  }

  /**
   * A device another one holds the address of (splitSharedAddresses): clear
   * its ping result, once, so its displayed status is its cloud's. Its ping
   * alert is moot (the cloud-offline rule covers it), and the History tab's
   * ping lane shows "no data" from here on (`ping.unknown`, naming the device
   * that answers).
   */
  async stepAside(device, answeredBy) {
    if (device.pingStatus === null && !device.consecutiveFailures) return;
    await getPrisma().device.update({
      where: { id: device.id },
      data: { pingStatus: null, pingResponseTime: null, consecutiveFailures: 0, pingLastChecked: new Date() },
    });
    logger.info(`Device ${device.name} not pinged: ${answeredBy.name} holds its address ${device.ipAddress}`);
    this.emitStatusUpdate(device.id, device.name, null, null, device);
    alertService.clear('device.offline', { subjectKey: device.id, deviceId: device.id });
    await deviceEvents.recordStateIfChanged({ id: device.id, name: device.name }, 'ping.', 'unknown', 'ping', { answeredBy });
  }

  /**
   * Record a settled ping state (online/offline) as a DeviceEvent for the
   * device's history: on every change, and once per device per process.
   * 'warning' (a missed check or two) is not one, so a blip that recovers
   * records nothing.
   */
  async recordPingState(deviceId, deviceName, status, changed, lastReply) {
    if (status !== 'online' && status !== 'offline') return;
    const device = { id: deviceId, name: deviceName };
    const data = status === 'offline' && lastReply ? { lastReply } : {};
    if (changed) await deviceEvents.recordStateIfChanged(device, 'ping.', status, 'ping', data);
    else await deviceEvents.recordStateOnce(device, 'ping.', status, 'ping', data);
  }

  /**
   * Calculate device status based on ping results
   * @param {boolean} alive - Current ping result
   * @param {number} consecutiveFailures - Current failure count
   * @returns {string} - 'online' | 'offline' | 'warning'
   */
  calculateStatus(alive, consecutiveFailures) {
    if (alive) {
      return 'online';
    }

    if (consecutiveFailures >= this.config.failureThreshold) {
      return 'offline';
    }

    // 1-2 failures = warning
    return 'warning';
  }

  /**
   * Emit WebSocket event for status update
   * @param {string} deviceId - Device ID
   * @param {string} deviceName - Device name
   * @param {string} status - New status
   * @param {number|null} responseTime - Response time
   * @param {Object} [cloud] - { managementMode, cloudStatus }, for the displayed status
   * @param {Date} [pingLastSeen] - set when this check got a reply
   */
  emitStatusUpdate(deviceId, deviceName, status, responseTime, cloud = {}, pingLastSeen = undefined) {
    try {
      // Lazy load socket to avoid circular dependency issues
      const { getIO } = require('../websocket/socket.handler');
      const io = getIO();

      if (io) {
        io.emit('device:status:update', {
          deviceId,
          deviceName,
          // What the device list shows (utils/device-status.js); pingStatus is the raw result.
          status: effectiveStatus({ ...cloud, pingStatus: status }),
          pingStatus: status,
          pingResponseTime: responseTime,
          pingLastChecked: new Date(),
          ...(pingLastSeen && { pingLastSeen }),
        });
      }
    } catch (error) {
      logger.error('Error emitting WebSocket event:', error);
      // Don't throw - WebSocket errors shouldn't break monitoring
    }
  }

  /**
   * Get monitoring statistics
   * @returns {Object} Monitoring stats
   */
  getStats() {
    return {
      isMonitoring: process.env.PING_MONITOR_ENABLED !== 'false',
      config: this.config,
      lastCheck: this.lastCheckStats,
    };
  }
}

module.exports = new PingMonitorService();
module.exports.splitSharedAddresses = splitSharedAddresses;
