const DeviceAPIFactory = require('../services/device-api/device-api-factory');
const settingsService = require('../services/settings.service');
const { getPrisma } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Device API Test Controller
 *
 * Provides endpoints for testing device-specific API integrations.
 * These endpoints are useful for validating connectivity and credentials
 * for individual devices.
 */
class DeviceAPITestController {
  /**
   * Test connection to a device using stored credentials
   * POST /api/v1/device-api/test/:deviceId
   */
  async testDeviceConnection(req, res, next) {
    try {
      const { deviceId } = req.params;
      const userId = req.user.id;

      logger.info('Testing device connection', {
        deviceId,
        userId,
      });

      // Get device from database
      const prisma = getPrisma();
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
      });

      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
        });
      }

      // Get credentials for the device
      const credentials = await settingsService.getDeviceCredentialsForUse(deviceId);

      if (!credentials) {
        return res.status(400).json({
          success: false,
          error: 'No credentials configured for this device',
          message: 'Please add API credentials for this device in Settings > API Credentials',
        });
      }

      // Create device API instance
      const deviceAPI = DeviceAPIFactory.createDeviceAPI(device, credentials);

      // Test connection
      const result = await deviceAPI.testConnection();

      // Update credential test status
      if (device.apiCredentialId) {
        try {
          await prisma.apiCredential.update({
            where: { id: device.apiCredentialId },
            data: {
              lastTested: new Date(),
              lastTestStatus: result.success ? 'success' : 'failed',
            },
          });
        } catch (updateError) {
          logger.warn('Failed to update credential test status', {
            error: updateError.message,
            credentialId: device.apiCredentialId,
          });
          // Don't fail the request if we can't update the credential
        }
      }

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Device connection test failed', {
        error: error.message,
        stack: error.stack,
      });

      // Try to update credential status even on failure
      if (req.params.deviceId) {
        try {
          const prisma = getPrisma();
          const device = await prisma.device.findUnique({
            where: { id: req.params.deviceId },
          });

          if (device?.apiCredentialId) {
            await prisma.apiCredential.update({
              where: { id: device.apiCredentialId },
              data: {
                lastTested: new Date(),
                lastTestStatus: 'failed',
              },
            });
          }
        } catch (updateError) {
          logger.warn('Failed to update credential test status on error', {
            error: updateError.message,
          });
        }
      }

      if (error.message.includes('Unsupported device API type')) {
        return res.status(400).json({
          success: false,
          error: 'Device type not supported',
          message: error.message,
        });
      }

      next(error);
    }
  }

  /**
   * Get device information using device API
   * GET /api/v1/device-api/:deviceId/info
   */
  async getDeviceInfo(req, res, next) {
    try {
      const { deviceId } = req.params;

      logger.info('Getting device info via API', {
        deviceId,
      });

      // Get device and credentials
      const prisma = getPrisma();
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
      });

      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
        });
      }

      const credentials = await settingsService.getDeviceCredentialsForUse(deviceId);

      if (!credentials) {
        return res.status(400).json({
          success: false,
          error: 'No credentials configured for this device',
        });
      }

      // Create device API instance and get info
      const deviceAPI = DeviceAPIFactory.createDeviceAPI(device, credentials);

      // Login first
      await deviceAPI.login();

      // Get device info
      const deviceInfo = await deviceAPI.getDeviceInfo();

      // Logout
      await deviceAPI.logout();

      res.json({
        success: true,
        data: deviceInfo,
      });
    } catch (error) {
      logger.error('Failed to get device info', {
        error: error.message,
      });

      next(error);
    }
  }

  /**
   * Get firmware information using device API
   * GET /api/v1/device-api/:deviceId/firmware
   */
  async getFirmwareInfo(req, res, next) {
    try {
      const { deviceId } = req.params;

      logger.info('Getting firmware info via API', {
        deviceId,
      });

      // Get device and credentials
      const prisma = getPrisma();
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
      });

      if (!device) {
        return res.status(404).json({
          success: false,
          error: 'Device not found',
        });
      }

      const credentials = await settingsService.getDeviceCredentialsForUse(deviceId);

      if (!credentials) {
        return res.status(400).json({
          success: false,
          error: 'No credentials configured for this device',
        });
      }

      // Create device API instance
      const deviceAPI = DeviceAPIFactory.createDeviceAPI(device, credentials);

      // Login
      await deviceAPI.login();

      // Get firmware info
      const firmwareInfo = await deviceAPI.getFirmwareInfo();

      // Logout
      await deviceAPI.logout();

      res.json({
        success: true,
        data: firmwareInfo,
      });
    } catch (error) {
      logger.error('Failed to get firmware info', {
        error: error.message,
      });

      next(error);
    }
  }

  /**
   * Test with manual credentials (no storage)
   * POST /api/v1/device-api/test-manual
   *
   * Body: {
   *   deviceIp: "192.168.1.1",
   *   username: "admin",
   *   password: "password",
   *   deviceType: "cx_switch" (optional)
   * }
   */
  async testManualConnection(req, res, next) {
    try {
      const { deviceIp, username, password, deviceType } = req.body;

      logger.info('Testing manual device connection', {
        deviceIp,
        username,
        deviceType: deviceType || 'auto-detect',
      });

      // Validate required fields
      if (!deviceIp || !username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields',
          message: 'deviceIp, username, and password are required',
        });
      }

      // Create a temporary device object
      const tempDevice = {
        name: `Test Device ${deviceIp}`,
        ipAddress: deviceIp,
        type: 'switch',
        model: 'Unknown',
      };

      // Create temporary credentials object
      const tempCredentials = {
        username,
        password,
        type: deviceType || 'switch',
      };

      // Create device API instance
      const deviceAPI = DeviceAPIFactory.createDeviceAPI(
        tempDevice,
        tempCredentials,
        deviceType
      );

      // Test connection
      const result = await deviceAPI.testConnection();

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Manual connection test failed', {
        error: error.message,
      });

      if (error.message.includes('Unsupported device API type')) {
        return res.status(400).json({
          success: false,
          error: 'Device type not supported',
          message: error.message,
        });
      }

      res.json({
        success: false,
        error: error.message,
        message: 'Connection test failed',
      });
    }
  }

  /**
   * Get list of supported device types
   * GET /api/v1/device-api/supported-types
   */
  async getSupportedTypes(req, res, next) {
    try {
      const supportedTypes = DeviceAPIFactory.getSupportedDeviceTypes();

      res.json({
        success: true,
        data: supportedTypes,
      });
    } catch (error) {
      logger.error('Failed to get supported types', {
        error: error.message,
      });

      next(error);
    }
  }
}

module.exports = new DeviceAPITestController();
