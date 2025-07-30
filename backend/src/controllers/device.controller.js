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

  async createDevice(req, res, next) {
    try {
      const deviceData = req.body;
      
      const device = await deviceService.createDevice(deviceData);
      
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
      const updateData = req.body;
      
      const device = await deviceService.updateDevice(deviceId, updateData);
      
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
}

module.exports = new DeviceController();
