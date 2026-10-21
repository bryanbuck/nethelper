const settingsService = require('../services/settings.service');
const {
  testDeviceConnection, cloudView, recordDeviceTest, manualTestPlatforms, manualTestDevice,
} = require('../services/connection-test.service');
const { usesDeviceCredential } = require('../services/device-credential.service');
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

      // Nothing reaches a cloud-only device directly (a Mist or Central AP), so
      // no credential can help: say so and show the cloud's view instead of
      // asking for one. Not a pass: NetHelper didn't contact the device.
      if (!usesDeviceCredential(device)) {
        const cloudStatus = await cloudView(device);
        const via = cloudStatus?.provider || 'its cloud';
        return res.json({
          success: true,
          data: {
            success: false,
            cloudOnly: true,
            transport: 'cloud',
            message: `NetHelper reaches ${device.name} only through ${via}, so there is no direct connection to test.`
              + (cloudStatus ? ` ${cloudStatus.provider} reports it ${cloudStatus.status}.` : ''),
            ...(cloudStatus && { cloudStatus }),
            testedAt: new Date(),
          },
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

      // Same transport routing as a real operation (connection-test.service).
      const startTime = Date.now();
      const result = await testDeviceConnection(device, credentials);
      await recordDeviceTest(deviceId, result, Date.now() - startTime);

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

          if (device) {
            await recordDeviceTest(device.id, { success: false, message: error.message });
          }
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
   * Test with manual credentials (no storage)
   * POST /api/v1/device-api/test-manual
   *
   * Body: { deviceIp, username, password, platform } (platform: one of
   * GET /device-api/supported-types with testable true; default aos-cx).
   * Routed like a direct device of that platform (connection-test.service),
   * so SSH-only platforms are tested over the CLI.
   */
  async testManualConnection(req, res, _next) {
    try {
      const { deviceIp, username, password, platform = 'aos-cx' } = req.body;

      logger.info('Testing manual device connection', { deviceIp, username, platform });

      const result = await testDeviceConnection(manualTestDevice(deviceIp, platform), { username, password });

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Manual connection test failed', {
        error: error.message,
      });

      res.json({
        success: true,
        data: { success: false, message: error.message, testedAt: new Date().toISOString() },
      });
    }
  }

  /**
   * Platforms the manual test can reach, and over which transports
   * GET /api/v1/device-api/supported-types
   */
  async getSupportedTypes(req, res, next) {
    try {
      res.json({
        success: true,
        data: manualTestPlatforms(),
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
