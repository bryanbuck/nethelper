const deviceService = require('../services/device.service');
const arubaCentralService = require('../services/aruba-central.service');
const logger = require('../utils/logger');

class DeviceController {
  async getDevices(req, res, next) {
    try {
      const { type, status, location, search } = req.query;
      const filters = { type, status, location, search };
      
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
      // Queue device sync job
      const job = await deviceService.queueDeviceSync();
      
      res.json({
        success: true,
        message: 'Device synchronization started',
        jobId: job.id,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDeviceStats(req, res, next) {
    try {
      const { deviceId } = req.params;
      const { metric, duration } = req.query;
      
      const stats = await arubaCentralService.getDeviceStats(deviceId, metric, duration);
      
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
      
      const result = await arubaCentralService.updateDeviceConfiguration(deviceId, configuration);
      
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
      
      const backup = await arubaCentralService.backupConfiguration(deviceId);
      
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
      
      const result = await arubaCentralService.executeCommand(deviceId, command);
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DeviceController();
