const settingsService = require('../services/settings.service');
const { CLOUD_PROVIDERS } = require('../constants/vendors');
const logger = require('../utils/logger');

class SettingsController {
  /**
   * Get all API credentials (shared across all users)
   * GET /api/v1/settings/api-credentials
   */
  async getApiCredentials(req, res, next) {
    try {
      const credentials = await settingsService.getApiCredentials();

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

      const credential = await settingsService.getApiCredential(id);

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

      const credential = await settingsService.getApiCredentialByDevice(deviceId);

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
      const updateData = req.body;

      const credential = await settingsService.updateApiCredential(id, updateData);

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

      await settingsService.deleteApiCredential(id);

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
      const { deviceId } = req.body || {};

      const testResult = await settingsService.testApiCredential(id, deviceId);

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

  // ---------------------------------------------------------------------
  // Cloud integrations (multi-provider, multi-tenant)
  // ---------------------------------------------------------------------

  /**
   * List the user's cloud integrations, plus the catalog of supported
   * providers (so the UI can render the right credential form per provider).
   * GET /api/v1/settings/cloud-integrations
   */
  async getCloudIntegrations(req, res, next) {
    try {
      const integrations = await settingsService.getCloudIntegrations(req.user.id);

      res.json({
        success: true,
        data: {
          integrations,
          providers: Object.values(CLOUD_PROVIDERS).map((provider) => ({
            id: provider.id,
            label: provider.label,
            vendor: provider.vendor,
            defaultBaseUrl: provider.defaultBaseUrl,
            credentialFields: provider.credentialFields,
            // Providers whose tenants live in a specific regional cloud (Mist)
            // ship a region list; the UI renders a picker instead of asking the
            // user to type a base URL.
            regions: provider.regions || null,
            implemented: provider.implemented,
          })),
        },
      });
    } catch (error) {
      logger.error('Get cloud integrations error:', error);
      next(error);
    }
  }

  /**
   * Create a cloud integration.
   * POST /api/v1/settings/cloud-integrations
   */
  async createCloudIntegration(req, res, next) {
    try {
      const integration = await settingsService.createCloudIntegration(req.user.id, req.body);

      res.status(201).json({
        success: true,
        data: integration,
        message: 'Cloud integration created successfully',
      });
    } catch (error) {
      logger.error('Create cloud integration error:', error);
      next(error);
    }
  }

  /**
   * Update a cloud integration.
   * PUT /api/v1/settings/cloud-integrations/:id
   */
  async updateCloudIntegration(req, res, next) {
    try {
      const integration = await settingsService.updateCloudIntegration(
        req.params.id,
        req.user.id,
        req.body
      );

      res.json({
        success: true,
        data: integration,
        message: 'Cloud integration updated successfully',
      });
    } catch (error) {
      logger.error('Update cloud integration error:', error);
      next(error);
    }
  }

  /**
   * Test a cloud integration's credentials against its provider.
   * POST /api/v1/settings/cloud-integrations/:id/test
   */
  async testCloudIntegration(req, res, next) {
    try {
      const result = await settingsService.testCloudIntegration(req.params.id, req.user.id);

      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      logger.error('Test cloud integration error:', error);
      next(error);
    }
  }

  /**
   * Delete a cloud integration.
   * DELETE /api/v1/settings/cloud-integrations/:id
   */
  async deleteCloudIntegration(req, res, next) {
    try {
      await settingsService.deleteCloudIntegration(req.params.id, req.user.id);

      res.json({
        success: true,
        message: 'Cloud integration deleted successfully',
      });
    } catch (error) {
      logger.error('Delete cloud integration error:', error);
      next(error);
    }
  }

  // ---------------------------------------------------------------------
  // Git backup mirror
  // ---------------------------------------------------------------------

  /**
   * Get the Git mirror configuration (secrets masked) plus its field catalog.
   * GET /api/v1/settings/git-backup
   */
  async getGitBackupConfig(req, res, next) {
    try {
      const data = await settingsService.getGitBackupConfig();
      res.json({ success: true, data });
    } catch (error) {
      logger.error('Get git backup config error:', error);
      next(error);
    }
  }

  /**
   * Create or update the Git mirror configuration.
   * PUT /api/v1/settings/git-backup
   */
  async saveGitBackupConfig(req, res, next) {
    try {
      const config = await settingsService.saveGitBackupConfig(req.user.id, req.body);
      res.json({
        success: true,
        data: config,
        message: 'Git backup configuration saved',
      });
    } catch (error) {
      logger.error('Save git backup config error:', error);
      next(error);
    }
  }

  /**
   * Validate the stored Git mirror configuration.
   * POST /api/v1/settings/git-backup/test
   */
  async testGitBackupConfig(req, res, next) {
    try {
      const result = await settingsService.testGitBackupConfig();
      res.json({ success: result.success, message: result.message, data: result });
    } catch (error) {
      logger.error('Test git backup config error:', error);
      next(error);
    }
  }

  /**
   * Forget the Git mirror configuration (the repository is left on disk).
   * DELETE /api/v1/settings/git-backup
   */
  async deleteGitBackupConfig(req, res, next) {
    try {
      await settingsService.deleteGitBackupConfig();
      res.json({
        success: true,
        message: 'Git backup configuration removed. The repository was left on disk.',
      });
    } catch (error) {
      logger.error('Delete git backup config error:', error);
      next(error);
    }
  }
}

module.exports = new SettingsController();
