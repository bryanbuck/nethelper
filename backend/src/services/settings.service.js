const { getPrisma } = require('../config/database');
const encryption = require('../utils/encryption');
const axios = require('axios');
const logger = require('../utils/logger');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { CLOUD_PROVIDERS } = require('../constants/vendors');

class SettingsService {
  /**
   * Get all API credentials for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of API credentials (with masked sensitive fields and device count)
   */
  async getApiCredentials(userId) {
    try {
      const prisma = getPrisma();

      const credentials = await prisma.apiCredential.findMany({
        where: { userId },
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
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object|null>} API credential (with masked sensitive fields)
   */
  async getApiCredential(credentialId, userId) {
    try {
      const prisma = getPrisma();

      const credential = await prisma.apiCredential.findFirst({
        where: {
          id: credentialId,
          userId
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
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object|null>} API credential or null
   */
  async getApiCredentialByDevice(deviceId, userId) {
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

      // Verify the credential belongs to the user
      if (device.apiCredential.userId !== userId) {
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
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} Updated API credential (with masked sensitive fields)
   */
  async updateApiCredential(credentialId, updateData, userId) {
    try {
      const prisma = getPrisma();

      // Verify credential exists and belongs to user
      const existing = await prisma.apiCredential.findFirst({
        where: { id: credentialId, userId },
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
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteApiCredential(credentialId, userId) {
    try {
      const prisma = getPrisma();

      // Verify credential exists and belongs to user
      const existing = await prisma.apiCredential.findFirst({
        where: { id: credentialId, userId },
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
   * @param {string} userId - User ID (for authorization)
   * @param {string} deviceId - Optional device ID to test against
   * @returns {Promise<Object>} Test result
   */
  async testApiCredential(credentialId, userId, deviceId = null) {
    try {
      const prisma = getPrisma();

      // Get credential with decrypted values
      const credential = await prisma.apiCredential.findFirst({
        where: { id: credentialId, userId },
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
        // Decrypt credentials
        const decryptedCreds = {
          username: credential.username ? credential.username : null,
          password: credential.password ? encryption.decrypt(credential.password) : null,
          apiKey: credential.apiKey ? encryption.decrypt(credential.apiKey) : null,
          apiSecret: credential.apiSecret ? encryption.decrypt(credential.apiSecret) : null,
        };

        // Attempt connection based on device type
        testResult = await this.testDeviceConnection(
          credential.type,
          device,
          decryptedCreds
        );

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
   * Test device connection based on type
   * @param {string} type - Credential type
   * @param {Object} device - Device object
   * @param {Object} credentials - Decrypted credentials
   * @returns {Promise<Object>} Test result
   */
  async testDeviceConnection(type, device, credentials) {
    // This is a basic implementation - expand based on actual device APIs
    // For now, we'll do a simple validation and mock response

    if (!device || !device.ipAddress) {
      throw new Error('Device IP address not configured');
    }

    // Basic timeout for connection test
    const timeout = 10000; // 10 seconds

    try {
      // Different connection logic based on device type
      switch (type) {
        case 'switch':
        case 'ap':
        case 'gateway':
          return await this.testNetworkDeviceConnection(device, credentials, timeout);

        case 'controller':
          return await this.testControllerConnection(device, credentials, timeout);

        default:
          return await this.testGenericConnection(device, credentials, timeout);
      }
    } catch (error) {
      throw error;
    }
  }

  /**
   * Test network device connection (switch, AP, gateway)
   * @param {Object} device - Device object
   * @param {Object} credentials - Decrypted credentials
   * @param {number} timeout - Connection timeout
   * @returns {Promise<Object>} Test result
   */
  async testNetworkDeviceConnection(device, credentials, timeout) {
    // This is a placeholder implementation
    // In production, you would:
    // 1. Use SSH for switches/APs with username/password
    // 2. Use REST API if device supports it with API keys
    // 3. Use SNMP for basic connectivity

    // For now, just validate that credentials are provided
    if (credentials.username && credentials.password) {
      return {
        success: true,
        message: 'Credentials validated successfully',
        testedAt: new Date().toISOString(),
        deviceInfo: {
          type: device.type,
          model: device.model,
          ipAddress: device.ipAddress,
        },
      };
    } else if (credentials.apiKey) {
      return {
        success: true,
        message: 'API key validated successfully',
        testedAt: new Date().toISOString(),
        deviceInfo: {
          type: device.type,
          model: device.model,
          ipAddress: device.ipAddress,
        },
      };
    } else {
      throw new Error('No valid credentials provided');
    }
  }

  /**
   * Test controller connection
   * @param {Object} device - Device object
   * @param {Object} credentials - Decrypted credentials
   * @param {number} timeout - Connection timeout
   * @returns {Promise<Object>} Test result
   */
  async testControllerConnection(device, credentials, timeout) {
    // Placeholder for controller-specific connection testing
    if (credentials.apiKey && credentials.apiSecret) {
      return {
        success: true,
        message: 'Controller API credentials validated',
        testedAt: new Date().toISOString(),
        deviceInfo: {
          type: device.type,
          model: device.model,
        },
      };
    } else {
      throw new Error('API key and secret required for controller');
    }
  }

  /**
   * Test generic connection
   * @param {Object} device - Device object
   * @param {Object} credentials - Decrypted credentials
   * @param {number} timeout - Connection timeout
   * @returns {Promise<Object>} Test result
   */
  async testGenericConnection(device, credentials, timeout) {
    // Basic validation for generic devices
    if (credentials.username || credentials.apiKey) {
      return {
        success: true,
        message: 'Credentials validated',
        testedAt: new Date().toISOString(),
      };
    } else {
      throw new Error('No credentials provided');
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
        // Preserve the existing value (secrets are never echoed back to the
        // client, so a blank secret on update means "unchanged").
        if (existing[field.key] !== undefined) {
          stored[field.key] = existing[field.key];
          continue;
        }
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
        baseUrl: data.baseUrl || spec.defaultBaseUrl,
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
        baseUrl: data.baseUrl ?? undefined,
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
    if (!configData.baseUrl || !configData.clientId || !configData.clientSecret || !configData.customerId) {
      throw new Error('Missing required fields: baseUrl, clientId, clientSecret, and customerId are required');
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
}

module.exports = new SettingsService();
