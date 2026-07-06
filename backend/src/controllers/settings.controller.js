const settingsService = require('../services/settings.service');
const logger = require('../utils/logger');

class SettingsController {
  /**
   * Get all API credentials for the authenticated user
   * GET /api/v1/settings/api-credentials
   */
  async getApiCredentials(req, res, next) {
    try {
      const userId = req.user.id;

      const credentials = await settingsService.getApiCredentials(userId);

      res.json({
        success: true,
        data: credentials,
      });
    } catch (error) {
      logger.error('Get API credentials error:', error);
      next(error);
    }
  }

  /**
   * Get a single API credential by ID
   * GET /api/v1/settings/api-credentials/:id
   */
  async getApiCredential(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const credential = await settingsService.getApiCredential(id, userId);

      if (!credential) {
        return res.status(404).json({
          success: false,
          error: 'API credential not found',
        });
      }

      res.json({
        success: true,
        data: credential,
      });
    } catch (error) {
      logger.error('Get API credential error:', error);
      next(error);
    }
  }

  /**
   * Get API credential associated with a specific device
   * GET /api/v1/settings/api-credentials/device/:deviceId
   */
  async getApiCredentialByDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const userId = req.user.id;

      const credential = await settingsService.getApiCredentialByDevice(deviceId, userId);

      res.json({
        success: true,
        data: credential,
      });
    } catch (error) {
      logger.error('Get API credential by device error:', error);
      next(error);
    }
  }

  /**
   * Create a new API credential
   * POST /api/v1/settings/api-credentials
   */
  async createApiCredential(req, res, next) {
    try {
      const userId = req.user.id;
      const credentialData = req.body;

      const credential = await settingsService.createApiCredential(credentialData, userId);

      res.status(201).json({
        success: true,
        data: credential,
      });
    } catch (error) {
      logger.error('Create API credential error:', error);

      if (error.message === 'Device not found' ||
          error.message.includes('authentication method')) {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      next(error);
    }
  }

  /**
   * Update an API credential
   * PUT /api/v1/settings/api-credentials/:id
   */
  async updateApiCredential(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const updateData = req.body;

      const credential = await settingsService.updateApiCredential(id, updateData, userId);

      res.json({
        success: true,
        data: credential,
      });
    } catch (error) {
      logger.error('Update API credential error:', error);

      if (error.message === 'API credential not found') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      if (error.message === 'Device not found') {
        return res.status(400).json({
          success: false,
          error: error.message,
        });
      }

      next(error);
    }
  }

  /**
   * Delete an API credential
   * DELETE /api/v1/settings/api-credentials/:id
   */
  async deleteApiCredential(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      await settingsService.deleteApiCredential(id, userId);

      res.json({
        success: true,
        message: 'API credential deleted successfully',
      });
    } catch (error) {
      logger.error('Delete API credential error:', error);

      if (error.message === 'API credential not found') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      next(error);
    }
  }

  /**
   * Test an API credential
   * POST /api/v1/settings/api-credentials/:id/test
   * Optional body: { deviceId: "device-uuid" }
   */
  async testApiCredential(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;
      const { deviceId } = req.body || {};

      const testResult = await settingsService.testApiCredential(id, userId, deviceId);

      res.json({
        success: true,
        data: testResult,
      });
    } catch (error) {
      logger.error('Test API credential error:', error);

      if (error.message === 'API credential not found' || error.message === 'Device not found') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      next(error);
    }
  }

  /**
   * Get Aruba Central configuration
   * GET /api/v1/settings/aruba-central
   */
  async getArubaCentralConfig(req, res, next) {
    try {
      const userId = req.user.id;

      const config = await settingsService.getArubaCentralConfig(userId);

      res.json({
        success: true,
        data: config,
      });
    } catch (error) {
      logger.error('Get Aruba Central config error:', error);
      next(error);
    }
  }

  /**
   * Create or update Aruba Central configuration
   * POST /api/v1/settings/aruba-central
   */
  async saveArubaCentralConfig(req, res, next) {
    try {
      const userId = req.user.id;
      const configData = req.body;

      const config = await settingsService.saveArubaCentralConfig(userId, configData);

      res.status(config.isNew ? 201 : 200).json({
        success: true,
        data: config.data,
        message: config.isNew ? 'Aruba Central configuration created successfully' : 'Aruba Central configuration updated successfully',
      });
    } catch (error) {
      logger.error('Save Aruba Central config error:', error);
      next(error);
    }
  }

  /**
   * Test Aruba Central configuration
   * POST /api/v1/settings/aruba-central/test
   */
  async testArubaCentralConfig(req, res, next) {
    try {
      const userId = req.user.id;
      const { configId } = req.body;

      const testResult = await settingsService.testArubaCentralConfig(userId, configId);

      res.json({
        success: true,
        data: testResult,
      });
    } catch (error) {
      logger.error('Test Aruba Central config error:', error);
      next(error);
    }
  }

  /**
   * Delete Aruba Central configuration
   * DELETE /api/v1/settings/aruba-central/:id
   */
  async deleteArubaCentralConfig(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      await settingsService.deleteArubaCentralConfig(id, userId);

      res.json({
        success: true,
        message: 'Aruba Central configuration deleted successfully',
      });
    } catch (error) {
      logger.error('Delete Aruba Central config error:', error);

      if (error.message === 'Aruba Central configuration not found') {
        return res.status(404).json({
          success: false,
          error: error.message,
        });
      }

      next(error);
    }
  }
}

module.exports = new SettingsController();
