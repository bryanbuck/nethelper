const ping = require('ping');
const { getPrisma } = require('../config/database');
const logger = require('../utils/logger');
const alertService = require('./alert.service');

class PingMonitorService {
  constructor() {
    this.config = {
      timeout: parseInt(process.env.PING_MONITOR_TIMEOUT) || 5, // seconds
      retries: 2,
      interval: parseInt(process.env.PING_MONITOR_INTERVAL) || 60000, // 60 seconds
      batchSize: parseInt(process.env.PING_MONITOR_BATCH_SIZE) || 20, // devices to check concurrently
      failureThreshold: parseInt(process.env.PING_MONITOR_FAILURE_THRESHOLD) || 3, // consecutive failures before marking offline
    };
    this.monitoringInterval = null;
    this.isMonitoring = false;
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
        },
      });

      if (devices.length === 0) {
        logger.debug('No devices with IP addresses found for ping monitoring');
        return;
      }

      logger.info(`Starting ping check for ${devices.length} devices`);

      // Reset stats
      this.lastCheckStats = {
        total: devices.length,
        successful: 0,
        failed: 0,
        timestamp: new Date(),
      };

      // Process devices in batches
      for (let i = 0; i < devices.length; i += this.config.batchSize) {
        const batch = devices.slice(i, i + this.config.batchSize);

        await Promise.all(
          batch.map(async (device) => {
            try {
              const result = await this.pingDeviceWithRetries(device.ipAddress);
              await this.updateDeviceStatus(device.id, device.name, result.alive, result.time, device.consecutiveFailures, device.pingStatus);

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
        if (i + this.config.batchSize < devices.length) {
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
   */
  async updateDeviceStatus(deviceId, deviceName, alive, responseTime, currentFailures, currentStatus) {
    const prisma = getPrisma();

    try {
      // Calculate new consecutive failures count
      const newConsecutiveFailures = alive ? 0 : currentFailures + 1;

      // Calculate new status
      const newStatus = this.calculateStatus(alive, newConsecutiveFailures);

      // Get current ping stats for success rate calculation
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { pingSuccessRate: true },
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
      }

      await prisma.device.update({
        where: { id: deviceId },
        data: updateData,
      });

      // Log status transitions
      if (currentStatus !== newStatus) {
        logger.info(`Device ${deviceName} status changed: ${currentStatus || 'unknown'} -> ${newStatus}`);

        // Emit WebSocket event for real-time UI updates
        this.emitStatusUpdate(deviceId, deviceName, newStatus, responseTime);

        if (newStatus === 'online') alertService.clear('device.offline', { subjectKey: deviceId, deviceId });
      }

      // Every offline check, not only the transition, so a device that was
      // already offline when alerting started still gets an alert. Repeats
      // of an open one are no-ops.
      if (newStatus === 'offline') {
        alertService.raise('device.offline', {
          subjectKey: deviceId,
          deviceId,
          title: `${deviceName} is offline`,
          message: `Stopped answering ping (${this.config.failureThreshold} or more missed checks in a row).`,
          data: { consecutiveFailures: newConsecutiveFailures },
        }, { bump: currentStatus !== 'offline' });
      }
    } catch (error) {
      logger.error(`Error updating device status for ${deviceName}:`, error);
      throw error;
    }
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
   */
  emitStatusUpdate(deviceId, deviceName, status, responseTime) {
    try {
      // Lazy load socket to avoid circular dependency issues
      const { getIO } = require('../websocket/socket.handler');
      const io = getIO();

      if (io) {
        io.emit('device:status:update', {
          deviceId,
          deviceName,
          status,
          pingStatus: status,
          pingResponseTime: responseTime,
          pingLastChecked: new Date(),
        });
      }
    } catch (error) {
      logger.error('Error emitting WebSocket event:', error);
      // Don't throw - WebSocket errors shouldn't break monitoring
    }
  }

  /**
   * Start continuous monitoring
   */
  startMonitoring() {
    if (this.isMonitoring) {
      logger.warn('Ping monitoring is already running');
      return;
    }

    const enabled = process.env.PING_MONITOR_ENABLED !== 'false';
    if (!enabled) {
      logger.info('Ping monitoring is disabled via PING_MONITOR_ENABLED environment variable');
      return;
    }

    logger.info(`Starting ping monitoring (interval: ${this.config.interval}ms, timeout: ${this.config.timeout}s, batch size: ${this.config.batchSize})`);

    this.isMonitoring = true;

    // Run initial check immediately
    this.checkAllDevices().catch(error => {
      logger.error('Error in initial ping check:', error);
    });

    // Set up recurring interval
    this.monitoringInterval = setInterval(() => {
      if (this.isMonitoring) {
        this.checkAllDevices().catch(error => {
          logger.error('Error in scheduled ping check:', error);
        });
      }
    }, this.config.interval);

    logger.info('Ping monitoring started successfully');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      logger.warn('Ping monitoring is not running');
      return;
    }

    logger.info('Stopping ping monitoring...');

    this.isMonitoring = false;

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    logger.info('Ping monitoring stopped');
  }

  /**
   * Get monitoring statistics
   * @returns {Object} Monitoring stats
   */
  getStats() {
    return {
      isMonitoring: this.isMonitoring,
      config: this.config,
      lastCheck: this.lastCheckStats,
    };
  }
}

module.exports = new PingMonitorService();
