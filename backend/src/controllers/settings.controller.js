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
   * Get API credentials by device ID
   * GET /api/v1/settings/api-credentials/device/:deviceId
   */
  async getApiCredentialsByDevice(req, res, next) {
    try {
      const { deviceId } = req.params;
      const userId = req.user.id;

      const credentials = await settingsService.getApiCredentialsByDevice(deviceId, userId);

      res.json({
        success: true,
        data: credentials,
      });
    } catch (error) {
      logger.error('Get API credentials by device error:', error);
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
   */
  async testApiCredential(req, res, next) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const testResult = await settingsService.testApiCredential(id, userId);

      res.json({
        success: true,
        data: testResult,
      });
    } catch (error) {
      logger.error('Test API credential error:', error);

      if (error.message === 'API credential not found') {
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
