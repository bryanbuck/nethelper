const DeviceAPIFactory = require('../services/device-api/device-api-factory');
const settingsService = require('../services/settings.service');
const sshDeviceService = require('../services/ssh-device.service');
const devicePollerService = require('../services/device-poller.service');
const NetconfClient = require('../services/device-api/netconf-client');
const { isCxRestCapable } = require('../utils/device-platform');
const { resolveTransport } = require('../utils/transport-router');
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

      // Route the test the same way a real operation would: through the
      // transport matrix. AOS-CX has a REST API and Junos has NETCONF (both the
      // 'device-rest' slot, dispatched by the factory); everything else is
      // tested over the SSH CLI. Junos additionally falls back to SSH when the
      // device has not enabled the NETCONF subsystem.
      let result;
      const transports = resolveTransport(device, 'test');

      for (const transport of transports) {
        if (transport === 'device-rest') {
          let deviceAPI;
          try {
            deviceAPI = DeviceAPIFactory.createDeviceAPI(device, credentials);
          } catch (error) {
            // No device API client for this platform — try the next transport.
            logger.debug(`No device API for ${device.name}: ${error.message}`);
            continue;
          }

          result = await deviceAPI.testConnection();

          // NETCONF is off on this Junos device: not a failure, just means the
          // CLI is the way in. Try the next transport instead of reporting it.
          if (!result.success && result.code === NetconfClient.NETCONF_UNAVAILABLE) {
            logger.info(`NETCONF unavailable on ${device.name}; testing over the SSH CLI instead`);
            result = null;
            continue;
          }

          // While we have working REST access to a CX switch, refresh its
          // switch-reported Central state (best-effort, never fails the test).
          if (result.success && isCxRestCapable(device)) {
            const centralStatus = await devicePollerService.refreshCentralStatus(device, credentials);
            if (centralStatus) {
              result.centralStatus = {
                centralManaged: centralStatus.centralManaged,
                connectionStatus: centralStatus.connectionStatus,
                mode: centralStatus.mode,
              };
            }
          }
          break;
        }

        if (transport === 'ssh') {
          result = await sshDeviceService.testConnection(device, credentials);
          break;
        }
      }

      if (!result) {
        result = {
          success: false,
          message: `No usable transport for "${device.name}" (tried: ${transports.join(', ') || 'none'})`,
          testedAt: new Date().toISOString(),
        };
      }

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
