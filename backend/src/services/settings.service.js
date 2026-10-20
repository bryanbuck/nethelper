const { getPrisma } = require('../config/database');
const encryption = require('../utils/encryption');
const logger = require('../utils/logger');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { CLOUD_PROVIDERS } = require('../constants/vendors');
const gitBackupService = require('./git-backup.service');

class SettingsService {
  /**
   * Get all API credentials (shared across all users)
   * @returns {Promise<Array>} Array of API credentials (with masked sensitive fields and device count)
   */
  async getApiCredentials() {
    try {
      const prisma = getPrisma();

      const credentials = await prisma.apiCredential.findMany({
        include: {
          devices: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      // Mask sensitive fields for response and include device info
      return credentials.map(cred => ({
        ...this.maskCredential(cred),
        devices: cred.devices,
        deviceCount: cred.devices.length,
      }));
    } catch (error) {
      logger.error('Get API credentials error:', error);
      throw error;
    }
  }

  /**
   * Get a single API credential by ID
   * @param {string} credentialId - Credential ID
   * @returns {Promise<Object|null>} API credential (with masked sensitive fields)
   */
  async getApiCredential(credentialId) {
    try {
      const prisma = getPrisma();

      const credential = await prisma.apiCredential.findUnique({
        where: {
          id: credentialId
        },
        include: {
          devices: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
        },
      });

      if (!credential) {
        return null;
      }

      // Mask sensitive fields for response and include device info
      return {
        ...this.maskCredential(credential),
        devices: credential.devices,
        deviceCount: credential.devices.length,
      };
    } catch (error) {
      logger.error('Get API credential error:', error);
      throw error;
    }
  }

  /**
   * Get API credential associated with a specific device
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object|null>} API credential or null
   */
  async getApiCredentialByDevice(deviceId) {
    try {
      const prisma = getPrisma();

      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        include: {
          apiCredential: true,
        },
      });

      if (!device || !device.apiCredential) {
        return null;
      }

      return this.maskCredential(device.apiCredential);
    } catch (error) {
      logger.error('Get API credential by device error:', error);
      throw error;
    }
  }

  /**
   * Create a new API credential
   * @param {Object} credentialData - Credential data
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Created API credential (with masked sensitive fields)
   */
  async createApiCredential(credentialData, userId) {
    try {
      const prisma = getPrisma();

      // Validate that at least one authentication method is provided
      if (!credentialData.username && !credentialData.password && !credentialData.apiKey && !credentialData.apiSecret) {
        throw new Error('At least one authentication method (username/password or apiKey/apiSecret) must be provided');
      }

      // Encrypt sensitive fields
      const encryptedData = {
        name: credentialData.name,
        type: credentialData.type,
        username: credentialData.username || null,
        password: credentialData.password ? encryption.encrypt(credentialData.password) : null,
        apiKey: credentialData.apiKey ? encryption.encrypt(credentialData.apiKey) : null,
        apiSecret: credentialData.apiSecret ? encryption.encrypt(credentialData.apiSecret) : null,
        notes: credentialData.notes || null,
        metadata: credentialData.metadata || null,
        userId,
      };

      const credential = await prisma.apiCredential.create({
        data: encryptedData,
      });

      return this.maskCredential(credential);
    } catch (error) {
      logger.error('Create API credential error:', error);
      throw error;
    }
  }

  /**
   * Update an API credential
   * @param {string} credentialId - Credential ID
   * @param {Object} updateData - Data to update
   * @returns {Promise<Object>} Updated API credential (with masked sensitive fields)
   */
  async updateApiCredential(credentialId, updateData) {
    try {
      const prisma = getPrisma();

      // Verify credential exists
      const existing = await prisma.apiCredential.findUnique({
        where: { id: credentialId },
      });

      if (!existing) {
        throw new Error('API credential not found');
      }

      // Prepare update data
      const encryptedUpdateData = {
        ...(updateData.name && { name: updateData.name }),
        ...(updateData.type && { type: updateData.type }),
        ...(updateData.username !== undefined && { username: updateData.username }),
        ...(updateData.notes !== undefined && { notes: updateData.notes }),
        ...(updateData.metadata !== undefined && { metadata: updateData.metadata }),
      };

      // Only encrypt and update password/apiKey/apiSecret if provided
      if (updateData.password !== undefined) {
        encryptedUpdateData.password = updateData.password ? encryption.encrypt(updateData.password) : null;
      }
      if (updateData.apiKey !== undefined) {
        encryptedUpdateData.apiKey = updateData.apiKey ? encryption.encrypt(updateData.apiKey) : null;
      }
      if (updateData.apiSecret !== undefined) {
        encryptedUpdateData.apiSecret = updateData.apiSecret ? encryption.encrypt(updateData.apiSecret) : null;
      }

      const credential = await prisma.apiCredential.update({
        where: { id: credentialId },
        data: encryptedUpdateData,
      });

      return this.maskCredential(credential);
    } catch (error) {
      logger.error('Update API credential error:', error);
      throw error;
    }
  }

  /**
   * Delete an API credential
   * @param {string} credentialId - Credential ID
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteApiCredential(credentialId) {
    try {
      const prisma = getPrisma();

      // Verify credential exists
      const existing = await prisma.apiCredential.findUnique({
        where: { id: credentialId },
      });

      if (!existing) {
        throw new Error('API credential not found');
      }

      await prisma.apiCredential.delete({
        where: { id: credentialId },
      });

      return true;
    } catch (error) {
      logger.error('Delete API credential error:', error);
      throw error;
    }
  }

  /**
   * Test an API credential by attempting to connect to a device
   * @param {string} credentialId - Credential ID
   * @param {string} deviceId - Optional device ID to test against
   * @returns {Promise<Object>} Test result
   */
  async testApiCredential(credentialId, deviceId = null) {
    try {
      const prisma = getPrisma();

      // Get credential with decrypted values
      const credential = await prisma.apiCredential.findUnique({
        where: { id: credentialId },
        include: {
          devices: true,
        },
      });

      if (!credential) {
        throw new Error('API credential not found');
      }

      // If deviceId is provided, use that device; otherwise use the first device associated with this credential
      let device = null;
      if (deviceId) {
        device = await prisma.device.findUnique({
          where: { id: deviceId },
        });
        if (!device) {
          throw new Error('Device not found');
        }
      } else if (credential.devices && credential.devices.length > 0) {
        device = credential.devices[0];
      }

      const startTime = Date.now();
      let testResult;

      try {
        if (!device) {
          throw new Error('Link this credential to a device (or pick one) to test it');
        }
        if (!device.ipAddress) {
          throw new Error(`Device "${device.name}" has no IP address`);
        }

        // A real connection attempt, routed like any other operation. Lazy
        // require: connection-test pulls in device-poller, which requires this
        // module.
        const { testDeviceConnection } = require('./connection-test.service');
        testResult = await testDeviceConnection(device, this.decryptCredential(credential));

        // Update credential with test results
        await prisma.apiCredential.update({
          where: { id: credentialId },
          data: {
            lastTested: new Date(),
            lastTestStatus: testResult.success ? 'success' : 'failed',
          },
        });

        return {
          ...testResult,
          responseTime: Date.now() - startTime,
        };
      } catch (error) {
        // Update credential with failure
        await prisma.apiCredential.update({
          where: { id: credentialId },
          data: {
            lastTested: new Date(),
            lastTestStatus: 'failed',
          },
        });

        return {
          success: false,
          message: `Connection failed: ${error.message}`,
          testedAt: new Date().toISOString(),
          responseTime: Date.now() - startTime,
        };
      }
    } catch (error) {
      logger.error('Test API credential error:', error);
      throw error;
    }
  }

  /**
   * Mask sensitive fields in a credential object
   * @param {Object} credential - Credential object
   * @returns {Object} Credential with masked sensitive fields
   */
  maskCredential(credential) {
    return {
      id: credential.id,
      name: credential.name,
      type: credential.type,
      username: credential.username,
      password: credential.password ? '***' : null,
      apiKey: credential.apiKey ? '***' : null,
      apiSecret: credential.apiSecret ? '***' : null,
      notes: credential.notes,
      lastTested: credential.lastTested,
      lastTestStatus: credential.lastTestStatus,
      metadata: credential.metadata,
      userId: credential.userId,
      createdAt: credential.createdAt,
      updatedAt: credential.updatedAt,
    };
  }

  /**
   * Get decrypted credentials for internal use (e.g., device polling)
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object|null>} Decrypted credentials
   */
  async getDeviceCredentialsForUse(deviceId) {
    try {
      const prisma = getPrisma();

      // Get the device with its associated credential
      const device = await prisma.device.findUnique({
        where: { id: deviceId },
        include: {
          apiCredential: true,
        },
      });

      if (!device || !device.apiCredential) {
        return null;
      }

      return this.decryptCredential(device.apiCredential);
    } catch (error) {
      logger.error('Get device credentials for use error:', error);
      throw error;
    }
  }

  /**
   * Decrypt all sensitive fields in a credential
   * @param {Object} credential - Encrypted credential
   * @returns {Object} Decrypted credential
   */
  decryptCredential(credential) {
    return {
      ...credential,
      username: credential.username,
      password: credential.password ? encryption.decrypt(credential.password) : null,
      apiKey: credential.apiKey ? encryption.decrypt(credential.apiKey) : null,
      apiSecret: credential.apiSecret ? encryption.decrypt(credential.apiSecret) : null,
    };
  }

  // -----------------------------------------------------------------------
  // Cloud integrations (Aruba Central, Juniper Mist, Cisco Meraki)
  //
  // Several integrations can be configured and active at once, including
  // multiple tenants of the same provider (e.g. two Central accounts and a
  // Mist org). Devices are attributed to their owning integration via
  // Device.cloudIntegrationId. See docs/MULTI_VENDOR_ROADMAP.md.
  // -----------------------------------------------------------------------

  /**
   * Encrypt the secret credential fields of an integration payload, per the
   * provider's credentialFields definition in constants/vendors.js.
   * Fields left blank on update keep their existing stored value.
   */
  encryptCredentials(provider, credentials = {}, existing = {}) {
    const spec = CLOUD_PROVIDERS[provider];
    if (!spec) throw new Error(`Unknown cloud provider "${provider}"`);

    const stored = {};
    for (const field of spec.credentialFields) {
      const value = credentials[field.key];
      if (value === undefined || value === null || value === '') {
        // An optional, non-secret field sent as '' is being cleared.
        if (field.optional && !field.secret && value === '') continue;
        // Preserve the existing value (secrets are never echoed back to the
        // client, so a blank secret on update means "unchanged").
        if (existing[field.key] !== undefined) {
          stored[field.key] = existing[field.key];
          continue;
        }
        if (field.optional) continue;
        throw new Error(`Missing required field "${field.key}" for ${spec.label}`);
      }
      stored[field.key] = field.secret ? encryption.encrypt(String(value)) : String(value);
    }
    return stored;
  }

  /** Strip secrets from an integration row before it goes over the wire. */
  sanitizeIntegration(integration) {
    const spec = CLOUD_PROVIDERS[integration.provider];
    const credentials = {};
    for (const field of spec?.credentialFields || []) {
      if (field.secret) {
        credentials[field.key] = integration.credentials?.[field.key] ? '********' : null;
      } else {
        credentials[field.key] = integration.credentials?.[field.key] ?? null;
      }
    }
    const { credentials: _omit, ...rest } = integration;
    return { ...rest, credentials };
  }

  /**
   * List every cloud integration for a user (secrets masked).
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async getCloudIntegrations(userId) {
    const prisma = getPrisma();
    const integrations = await prisma.cloudIntegration.findMany({
      where: { userId },
      orderBy: [{ provider: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { devices: true } } },
    });
    return integrations.map((integration) => this.sanitizeIntegration(integration));
  }

  /**
   * An integration's base URL without trailing slashes (providers append
   * paths that start with one). Only http(s) URLs are accepted.
   */
  normalizeBaseUrl(baseUrl) {
    if (!baseUrl) return null;
    const trimmed = String(baseUrl).trim().replace(/\/+$/, '');
    let url;
    try {
      url = new URL(trimmed);
    } catch {
      url = null;
    }
    if (!url || !['http:', 'https:'].includes(url.protocol)) {
      const error = new Error(`"${baseUrl}" is not an http(s) URL`);
      error.statusCode = 400;
      throw error;
    }
    return trimmed;
  }

  /**
   * Create a cloud integration.
   * @param {string} userId
   * @param {Object} data - { provider, name, baseUrl?, credentials, isActive?, notes? }
   */
  async createCloudIntegration(userId, data) {
    const prisma = getPrisma();
    const spec = CLOUD_PROVIDERS[data.provider];
    if (!spec) throw new Error(`Unknown cloud provider "${data.provider}"`);
    if (!spec.implemented) throw new Error(`${spec.label} support is not implemented yet`);
    if (!data.name) throw new Error('An integration name is required');

    const integration = await prisma.cloudIntegration.create({
      data: {
        provider: data.provider,
        name: data.name,
        baseUrl: this.normalizeBaseUrl(data.baseUrl) || spec.defaultBaseUrl,
        credentials: this.encryptCredentials(data.provider, data.credentials),
        isActive: data.isActive !== false,
        notes: data.notes || null,
        userId,
      },
    });

    return this.sanitizeIntegration(integration);
  }

  /**
   * Update a cloud integration. Blank secret fields keep their stored value.
   */
  async updateCloudIntegration(integrationId, userId, data) {
    const prisma = getPrisma();
    const existing = await prisma.cloudIntegration.findFirst({
      where: { id: integrationId, userId },
    });
    if (!existing) {
      const error = new Error('Cloud integration not found');
      error.statusCode = 404;
      throw error;
    }

    const integration = await prisma.cloudIntegration.update({
      where: { id: integrationId },
      data: {
        name: data.name ?? undefined,
        baseUrl: data.baseUrl ? this.normalizeBaseUrl(data.baseUrl) : undefined,
        credentials: data.credentials
          ? this.encryptCredentials(existing.provider, data.credentials, existing.credentials)
          : undefined,
        isActive: data.isActive ?? undefined,
        notes: data.notes ?? undefined,
      },
    });

    // Credentials or base URL may have changed - drop the cached OAuth token.
    await this.clearIntegrationCache(integration);
    return this.sanitizeIntegration(integration);
  }

  /**
   * Test a cloud integration's credentials against its provider.
   * Persists lastTested / lastTestStatus.
   */
  async testCloudIntegration(integrationId, userId) {
    const prisma = getPrisma();
    const row = await prisma.cloudIntegration.findFirst({
      where: { id: integrationId, userId },
    });
    if (!row) {
      const error = new Error('Cloud integration not found');
      error.statusCode = 404;
      throw error;
    }

    let result;
    try {
      const provider = await CloudProviderFactory.forIntegration(row);
      result = await provider.testConnection();
    } catch (error) {
      result = { success: false, message: error.message };
    }

    await prisma.cloudIntegration.update({
      where: { id: row.id },
      data: {
        lastTested: new Date(),
        lastTestStatus: result.success ? 'success' : 'failed',
      },
    });

    return { ...result, testedAt: new Date() };
  }

  /**
   * Delete a cloud integration. Devices that referenced it keep their rows
   * (the FK is SetNull) but lose their cloud attribution.
   */
  async deleteCloudIntegration(integrationId, userId) {
    const prisma = getPrisma();
    const integration = await prisma.cloudIntegration.findFirst({
      where: { id: integrationId, userId },
    });
    if (!integration) {
      const error = new Error('Cloud integration not found');
      error.statusCode = 404;
      throw error;
    }

    await this.clearIntegrationCache(integration);
    await prisma.cloudIntegration.delete({ where: { id: integrationId } });
  }

  /** Drop any provider-side cached token for an integration (best-effort). */
  async clearIntegrationCache(integration) {
    try {
      const provider = await CloudProviderFactory.forIntegration(integration);
      if (typeof provider.clearTokenCache === 'function') {
        await provider.clearTokenCache();
      }
    } catch (error) {
      logger.warn(`Could not clear cached token for integration ${integration.id}: ${error.message}`);
    }
  }

  // ---------------------------------------------------------------------
  // Deprecated Aruba-Central-shaped wrappers. The frontend has moved to the
  // /settings/cloud-integrations routes; these keep the old single-tenant
  // endpoints working for one release and operate on the aruba_central rows
  // of the CloudIntegration table.
  // ---------------------------------------------------------------------

  /** @deprecated Use getCloudIntegrations(). */
  async getArubaCentralConfig(userId) {
    const prisma = getPrisma();
    const integration = await prisma.cloudIntegration.findFirst({
      where: { userId, provider: 'aruba_central', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!integration) return null;

    return {
      id: integration.id,
      baseUrl: integration.baseUrl,
      clientId: integration.credentials?.clientId || null,
      customerId: integration.credentials?.customerId || null,
      isActive: integration.isActive,
      lastTested: integration.lastTested,
      lastTestStatus: integration.lastTestStatus,
      notes: integration.notes,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt,
    };
  }

  /** @deprecated Use createCloudIntegration()/updateCloudIntegration(). */
  async saveArubaCentralConfig(userId, configData) {
    const prisma = getPrisma();
    if (!configData.baseUrl || !configData.clientId || !configData.clientSecret) {
      throw new Error('Missing required fields: baseUrl, clientId, and clientSecret are required');
    }

    const credentials = {
      clientId: configData.clientId,
      clientSecret: configData.clientSecret,
      customerId: configData.customerId,
    };

    const existing = await prisma.cloudIntegration.findFirst({
      where: { userId, provider: 'aruba_central', isActive: true },
    });

    if (existing) {
      const updated = await this.updateCloudIntegration(existing.id, userId, {
        baseUrl: configData.baseUrl,
        credentials,
        notes: configData.notes,
      });
      return { data: await this.getArubaCentralConfig(userId), isNew: false, integration: updated };
    }

    const created = await this.createCloudIntegration(userId, {
      provider: 'aruba_central',
      name: configData.name || 'Aruba Central',
      baseUrl: configData.baseUrl,
      credentials,
      notes: configData.notes,
    });
    return { data: await this.getArubaCentralConfig(userId), isNew: true, integration: created };
  }

  /** @deprecated Use testCloudIntegration(). */
  async testArubaCentralConfig(userId, configId) {
    const prisma = getPrisma();
    const integration = configId
      ? await prisma.cloudIntegration.findFirst({ where: { id: configId, userId, provider: 'aruba_central' } })
      : await prisma.cloudIntegration.findFirst({ where: { userId, provider: 'aruba_central', isActive: true } });

    if (!integration) {
      throw new Error('Aruba Central configuration not found');
    }
    return this.testCloudIntegration(integration.id, userId);
  }

  /** @deprecated Use deleteCloudIntegration(). */
  async deleteArubaCentralConfig(configId, userId) {
    const prisma = getPrisma();
    const integration = await prisma.cloudIntegration.findFirst({
      where: { id: configId, userId, provider: 'aruba_central' },
    });
    if (!integration) {
      throw new Error('Aruba Central configuration not found');
    }
    return this.deleteCloudIntegration(configId, userId);
  }

  // ---------------------------------------------------------------------
  // Git backup mirror
  // ---------------------------------------------------------------------

  /**
   * Encrypt secret fields on a Git mirror credential blob. Mirrors
   * encryptCredentials(): a blank secret on update means "unchanged".
   */
  encryptGitCredentials(credentials = {}, existing = {}) {
    const stored = {};
    for (const field of gitBackupService.credentialFields) {
      const value = credentials[field.key];
      if (value === undefined || value === null || value === '') {
        if (existing[field.key] !== undefined) stored[field.key] = existing[field.key];
        continue;
      }
      stored[field.key] = field.secret ? encryption.encrypt(String(value)) : String(value);
    }
    return stored;
  }

  /** Strip secrets from a Git mirror row before it goes over the wire. */
  sanitizeGitConfig(row) {
    if (!row) return null;
    const credentials = {};
    for (const field of gitBackupService.credentialFields) {
      if (field.secret) {
        credentials[field.key] = row.credentials?.[field.key] ? '********' : null;
      } else {
        credentials[field.key] = row.credentials?.[field.key] ?? null;
      }
    }
    const { credentials: _omit, ...rest } = row;
    return { ...rest, credentials };
  }

  /**
   * The Git mirror configuration (secrets masked), plus the field catalog the
   * UI renders its form from. Returns defaults when nothing is configured yet.
   */
  async getGitBackupConfig() {
    const prisma = getPrisma();
    const row = await prisma.gitBackupConfig.findFirst({ orderBy: { createdAt: 'asc' } });
    return {
      config: this.sanitizeGitConfig(row),
      defaults: { repoPath: gitBackupService.defaultRepoPath, branch: 'main' },
      credentialFields: gitBackupService.credentialFields,
    };
  }

  /**
   * Create or update the Git mirror configuration. There is one row; passing
   * no id updates the existing one rather than creating a second.
   */
  async saveGitBackupConfig(userId, data) {
    const prisma = getPrisma();
    const existing = await prisma.gitBackupConfig.findFirst({ orderBy: { createdAt: 'asc' } });

    const repoPath = (data.repoPath || existing?.repoPath || gitBackupService.defaultRepoPath).trim();
    if (!repoPath) throw new Error('A repository path is required');

    const credentials = this.encryptGitCredentials(data.credentials, existing?.credentials || {});

    const fields = {
      name: data.name ?? existing?.name ?? 'Config Backup Repository',
      repoPath,
      remoteUrl: data.remoteUrl === '' ? null : (data.remoteUrl ?? existing?.remoteUrl ?? null),
      branch: (data.branch || existing?.branch || 'main').trim(),
      authorName: data.authorName || existing?.authorName || 'NetHelper',
      authorEmail: data.authorEmail || existing?.authorEmail || 'nethelper@localhost',
      credentials,
      isActive: data.isActive ?? existing?.isActive ?? false,
      notes: data.notes ?? existing?.notes ?? null,
    };

    gitBackupService.validateMirrorSettings({ ...fields, sshKeyPath: credentials?.sshKeyPath });

    const row = existing
      ? await prisma.gitBackupConfig.update({ where: { id: existing.id }, data: fields })
      : await prisma.gitBackupConfig.create({ data: { ...fields, userId } });

    logger.info(`Git backup mirror ${existing ? 'updated' : 'configured'} (active: ${row.isActive})`);
    return this.sanitizeGitConfig(row);
  }

  /**
   * Validate the stored Git mirror configuration and persist the result.
   * Returns { success, message } rather than throwing on a bad remote.
   */
  async testGitBackupConfig() {
    const prisma = getPrisma();
    const row = await prisma.gitBackupConfig.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!row) {
      const error = new Error('No Git backup configuration to test');
      error.statusCode = 404;
      throw error;
    }

    const result = await gitBackupService.testConnection(gitBackupService.decryptConfig(row));
    await prisma.gitBackupConfig.update({
      where: { id: row.id },
      data: {
        lastTested: new Date(),
        lastTestStatus: result.success ? 'success' : 'failed',
      },
    });
    return result;
  }

  /**
   * Forget the Git mirror configuration. The repository itself is left on disk
   * — deleting a config must never destroy backup history.
   */
  async deleteGitBackupConfig() {
    const prisma = getPrisma();
    const row = await prisma.gitBackupConfig.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!row) {
      const error = new Error('No Git backup configuration to delete');
      error.statusCode = 404;
      throw error;
    }
    await prisma.gitBackupConfig.delete({ where: { id: row.id } });
    logger.info(`Git backup mirror configuration removed (repository at ${row.repoPath} left intact)`);
  }
}

module.exports = new SettingsService();
