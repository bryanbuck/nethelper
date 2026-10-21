const deviceService = require('../services/device.service');
const deviceMerge = require('../services/device-merge.service');
const deviceCredentials = require('../services/device-credential.service');
const CloudProviderFactory = require('../services/cloud-providers/cloud-provider-factory');
const { getPrisma } = require('../config/database');
const devicePollerService = require('../services/device-poller.service');
const ArubaErrorHandler = require('../utils/aruba-error-handler');

class DeviceController {
  async getDevices(req, res, next) {
    try {
      const { type, status, location, search, platform, credential, page, limit, sortBy, sortOrder } = req.query;
      const filters = { type, status, location, search, platform, credential };

      // limit asks for one page (the Devices table); without it, every device
      if (limit) {
        const result = await deviceService.getDevices(filters, { page, limit, sortBy, sortOrder });
        return res.json({
          success: true,
          data: result.devices,
          count: result.total,
          page: page || 1,
          limit,
          summary: result.summary,
        });
      }

      const devices = await deviceService.getDevices(filters);

      res.json({
        success: true,
        data: devices,
        count: devices.length,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      
      const device = await deviceService.getDevice(deviceId);
      
      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
        });
      }
      
      res.json({
        success: true,
        data: device,
      });
    } catch (error) {
      next(error);
    }
  }

  async syncDevices(req, res, next) {
    try {
      // Optionally scope the sync to one cloud integration; by default every
      // active integration is synced.
      const { integrationId } = req.body || {};
      const job = await deviceService.queueDeviceSync(integrationId || null);

      res.json({
        success: true,
        message: 'Device synchronization started',
        jobId: job.id,
      });
    } catch (error) {
      // A cloud provider's error carries suggested actions for the user.
      if (error.isProviderError && error.actions) {
        const errorResponse = ArubaErrorHandler.createErrorResponse({
          type: error.type,
          userMessage: error.message,
          explanation: error.explanation,
          actions: error.actions,
          documentation: error.documentation,
          context: 'device_sync',
          details: { statusCode: error.statusCode },
          timestamp: new Date().toISOString()
        });
        return res.status(error.statusCode || 500).json(errorResponse);
      }
      next(error);
    }
  }

  /** Groups of devices that are probably the same hardware (see device-merge.service). */
  async getDuplicates(req, res, next) {
    try {
      const groups = await deviceMerge.findDuplicateGroups();
      res.json({ success: true, data: groups });
    } catch (error) {
      next(error);
    }
  }

  /** Fold sourceIds into targetId; the sources are deleted. */
  async mergeDevices(req, res, next) {
    try {
      const { targetId, sourceIds, identityFrom } = req.body;
      const device = await deviceMerge.merge(targetId, sourceIds, { identityFrom: identityFrom || null });
      res.json({ success: true, data: device });
    } catch (error) {
      if (error instanceof deviceMerge.MergeError) {
        return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
      }
      next(error);
    }
  }

  /** How a merge would settle serial/MAC (asks the cloud and/or device); changes nothing. */
  async previewMerge(req, res, next) {
    try {
      const { targetId, sourceIds } = req.body;
      const preview = await deviceMerge.preview(targetId, sourceIds);
      res.json({ success: true, data: preview });
    } catch (error) {
      if (error instanceof deviceMerge.MergeError) {
        return res.status(error.statusCode).json({ success: false, error: error.message, code: error.code });
      }
      next(error);
    }
  }

  /** What linking a credential to these devices would do; changes nothing. */
  async previewCredentialAssignment(req, res, next) {
    try {
      const { deviceIds, apiCredentialId } = req.body;
      const plan = await deviceCredentials.plan(deviceIds, apiCredentialId || null);
      res.json({ success: true, data: plan });
    } catch (error) {
      if (error instanceof deviceCredentials.CredentialAssignError) {
        return res.status(error.statusCode).json({ success: false, error: error.message });
      }
      next(error);
    }
  }

  /** Link apiCredentialId to deviceIds (null unlinks); skipped devices are reported. */
  async assignCredential(req, res, next) {
    try {
      const { deviceIds, apiCredentialId } = req.body;
      const result = await deviceCredentials.assign(deviceIds, apiCredentialId || null, { userId: req.user.id });
      res.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof deviceCredentials.CredentialAssignError) {
        return res.status(error.statusCode).json({ success: false, error: error.message });
      }
      next(error);
    }
  }

  /** Device row + its cloud provider for cloud-plane endpoints below. */
  async deviceProvider(deviceId) {
    const device = await getPrisma().device.findUnique({ where: { id: deviceId } });
    if (!device) {
      const error = new Error('Device not found');
      error.statusCode = 404;
      throw error;
    }
    return { device, provider: await CloudProviderFactory.forDevice(device) };
  }

  async getDeviceStats(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { metric, duration } = req.query;

      const { device, provider } = await deviceController.deviceProvider(deviceId);
      const stats = await provider.getDeviceStats(device.serial, metric, duration);
      
      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDeviceConfiguration(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { configuration } = req.body;

      const { device, provider } = await deviceController.deviceProvider(deviceId);
      const result = await provider.updateDeviceConfiguration(device.serial, configuration);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async backupDeviceConfiguration(req, res, next) {
    try {
      const { deviceId } = req.params;

      const { device, provider } = await deviceController.deviceProvider(deviceId);
      const backup = await provider.backupConfiguration(device.serial);
      
      res.json({
        success: true,
        data: backup,
      });
    } catch (error) {
      next(error);
    }
  }

  async executeCommand(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { command } = req.body;

      const { device, provider } = await deviceController.deviceProvider(deviceId);
      const result = await provider.executeCommand(device.serial, command);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }

  async createDevice(req, res, next) {
    try {
      // Only user-editable fields; status, metadata and the rest are system-owned.
      const device = await deviceService.createDevice(deviceService.editableFields(req.body));
      
      res.status(201).json({
        success: true,
        data: device,
        message: 'Device created successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const device = await deviceService.updateDevice(deviceId, deviceService.editableFields(req.body));
      
      res.json({
        success: true,
        data: device,
        message: 'Device updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      
      await deviceService.deleteDevice(deviceId);
      
      res.json({
        success: true,
        message: 'Device deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async getDeviceGroups(req, res, next) {
    try {
      const groups = await deviceService.getDeviceGroups();
      
      res.json({
        success: true,
        data: groups,
        count: groups.length,
      });
    } catch (error) {
      next(error);
    }
  }

  async createDeviceGroup(req, res, next) {
    try {
      const groupData = req.body;
      
      const group = await deviceService.createDeviceGroup(groupData);
      
      res.status(201).json({
        success: true,
        data: group,
        message: 'Device group created successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDeviceGroup(req, res, next) {
    try {
      const { groupId } = req.params;
      const updateData = req.body;
      
      const group = await deviceService.updateDeviceGroup(groupId, updateData);
      
      res.json({
        success: true,
        data: group,
        message: 'Device group updated successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteDeviceGroup(req, res, next) {
    try {
      const { groupId } = req.params;

      await deviceService.deleteDeviceGroup(groupId);

      res.json({
        success: true,
        message: 'Device group deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Poll devices for specific information
   * Supports bulk polling of multiple devices
   */
  async pollDevices(req, res, next) {
    try {
      const { poller, deviceIds } = req.body;

      // Validate input
      if (!poller) {
        return res.status(400).json({
          success: false,
          error: 'Poller name is required',
          availablePollers: devicePollerService.getAvailablePollers(),
        });
      }

      if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'deviceIds array is required and must contain at least one device ID',
        });
      }

      // Poll devices
      const results = await devicePollerService.pollDevices(poller, deviceIds);

      // Calculate summary statistics
      const summary = {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      };

      res.json({
        success: true,
        poller,
        summary,
        results,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get available device pollers
   */
  async getAvailablePollers(req, res, next) {
    try {
      const pollers = devicePollerService.getAvailablePollers();

      res.json({
        success: true,
        pollers,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Recent live-state events for a device, newest first.
   * Query: limit (1-200, default 50), before (ISO timestamp cursor),
   * type (comma-separated exact types or prefixes, e.g. "port.poe").
   */
  async getDeviceEvents(req, res, next) {
    try {
      const { deviceId } = req.params;
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
      const where = { deviceId };

      if (req.query.before) {
        const before = new Date(req.query.before);
        if (Number.isNaN(before.getTime())) {
          return res.status(400).json({ success: false, error: 'before must be an ISO timestamp' });
        }
        where.occurredAt = { lt: before };
      }
      if (req.query.type) {
        const types = String(req.query.type).split(',').map((t) => t.trim()).filter(Boolean);
        where.OR = types.map((t) => ({ type: { startsWith: t } }));
      }

      const events = await getPrisma().deviceEvent.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take: limit,
      });

      res.json({
        success: true,
        data: events,
        nextBefore: events.length === limit ? events[events.length - 1].occurredAt : null,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Turn always-on live state monitoring on or off. Body: { enabled: boolean }.
   * Enabling checks up front that the device can be watched, so the toggle
   * never claims monitoring that isn't happening.
   */
  async setLiveMonitoring(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { enabled } = req.body || {};
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'enabled must be true or false' });
      }

      const stateMonitor = require('../services/live/state-monitor.service');
      const prisma = getPrisma();
      const device = await prisma.device.findUnique({ where: { id: deviceId } });
      if (!device) {
        return res.status(404).json({ success: false, error: 'Device not found' });
      }

      if (enabled) {
        const reason = stateMonitor.unsupportedReason(device)
          || (device.apiCredentialId ? null : 'Link a device credential first; live state reads the device directly');
        if (reason) return res.status(400).json({ success: false, error: reason });
      }

      const updated = await prisma.device.update({ where: { id: deviceId }, data: { liveMonitoring: enabled } });
      try {
        await stateMonitor.setAlwaysOn(updated, enabled);
      } catch (error) {
        // e.g. LIVE_MAX_CONNECTIONS reached: don't leave the flag claiming otherwise.
        await prisma.device.update({ where: { id: deviceId }, data: { liveMonitoring: false } });
        return res.status(409).json({ success: false, error: error.message });
      }

      res.json({ success: true, data: { deviceId, liveMonitoring: enabled } });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Manually trigger ping check for specific device
   */
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
      await pingMonitorService.updateDeviceStatus(
        deviceId,
        device.name,
        result.alive,
        result.time,
        device.consecutiveFailures || 0,
        device.pingStatus
      );

      res.json({
        success: true,
        data: {
          deviceId,
          deviceName: device.name,
          ipAddress: device.ipAddress,
          alive: result.alive,
          responseTime: result.time,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Trigger ping check for all devices
   */
  async pingAllDevices(req, res, next) {
    try {
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

  /**
   * Get ping monitoring statistics
   */
  async getPingStats(req, res, next) {
    try {
      const pingMonitorService = require('../services/ping-monitor.service');
      const stats = pingMonitorService.getStats();

      res.json({
        success: true,
        data: stats,
      });
    } catch (error) {
      next(error);
    }
  }
}

// Handlers are passed to Express unbound, so helpers are reached through this
// module-level instance rather than `this`.
const deviceController = new DeviceController();
module.exports = deviceController;
