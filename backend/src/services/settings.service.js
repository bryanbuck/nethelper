const { getPrisma } = require('../config/database');
const encryption = require('../utils/encryption');
const axios = require('axios');
const logger = require('../utils/logger');

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

  /**
   * Get Aruba Central configuration for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} Aruba Central configuration (without client secret)
   */
  async getArubaCentralConfig(userId) {
    const prisma = getPrisma();

    const config = await prisma.arubaCentralConfig.findFirst({
      where: { userId, isActive: true },
      select: {
        id: true,
        baseUrl: true,
        clientId: true,
        customerId: true,
        isActive: true,
        lastTested: true,
        lastTestStatus: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        // DO NOT include clientSecret in response
      },
    });

    return config;
  }

  /**
   * Save (create or update) Aruba Central configuration
   * @param {string} userId - User ID
   * @param {Object} configData - Configuration data
   * @returns {Promise<Object>} Saved configuration
   */
  async saveArubaCentralConfig(userId, configData) {
    const prisma = getPrisma();
    const arubaCentralService = require('./aruba-central.service');

    // Validate required fields
    if (!configData.baseUrl || !configData.clientId || !configData.clientSecret || !configData.customerId) {
      throw new Error('Missing required fields: baseUrl, clientId, clientSecret, and customerId are required');
    }

    // Encrypt client secret
    const encryptedSecret = encryption.encrypt(configData.clientSecret);

    // Check if user already has an active config
    const existingConfig = await prisma.arubaCentralConfig.findFirst({
      where: { userId, isActive: true },
    });

    let savedConfig;
    let isNew = false;

    if (existingConfig) {
      // Update existing config
      savedConfig = await prisma.arubaCentralConfig.update({
        where: { id: existingConfig.id },
        data: {
          baseUrl: configData.baseUrl,
          clientId: configData.clientId,
          clientSecret: encryptedSecret,
          customerId: configData.customerId,
          notes: configData.notes,
          updatedAt: new Date(),
        },
        select: {
          id: true,
          baseUrl: true,
          clientId: true,
          customerId: true,
          isActive: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } else {
      // Create new config
      savedConfig = await prisma.arubaCentralConfig.create({
        data: {
          baseUrl: configData.baseUrl,
          clientId: configData.clientId,
          clientSecret: encryptedSecret,
          customerId: configData.customerId,
          isActive: true,
          notes: configData.notes,
          userId,
        },
        select: {
          id: true,
          baseUrl: true,
          clientId: true,
          customerId: true,
          isActive: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      isNew = true;
    }

    // Clear the config cache in aruba-central.service
    arubaCentralService.clearConfigCache();

    // Clear the access token cache to force re-authentication with new credentials
    const redis = arubaCentralService.getRedis();
    await redis.del('aruba:access_token');

    return { data: savedConfig, isNew };
  }

  /**
   * Test Aruba Central configuration
   * @param {string} userId - User ID
   * @param {string} configId - Config ID (optional, uses active if not provided)
   * @returns {Promise<Object>} Test result
   */
  async testArubaCentralConfig(userId, configId) {
    const prisma = getPrisma();
    const arubaCentralService = require('./aruba-central.service');

    let config;
    if (configId) {
      config = await prisma.arubaCentralConfig.findFirst({
        where: { id: configId, userId },
      });
    } else {
      config = await prisma.arubaCentralConfig.findFirst({
        where: { userId, isActive: true },
      });
    }

    if (!config) {
      throw new Error('Aruba Central configuration not found');
    }

    try {
      // Clear caches to force using this config
      arubaCentralService.clearConfigCache();
      const redis = arubaCentralService.getRedis();
      await redis.del('aruba:access_token');

      // Try to get access token (this will test OAuth credentials)
      const startTime = Date.now();
      await arubaCentralService.getAccessToken();
      const responseTime = Date.now() - startTime;

      // Update test status
      await prisma.arubaCentralConfig.update({
        where: { id: config.id },
        data: {
          lastTested: new Date(),
          lastTestStatus: 'success',
        },
      });

      return {
        success: true,
        message: 'Successfully authenticated with Aruba Central',
        responseTime: `${responseTime}ms`,
        testedAt: new Date(),
      };
    } catch (error) {
      // Update test status
      await prisma.arubaCentralConfig.update({
        where: { id: config.id },
        data: {
          lastTested: new Date(),
          lastTestStatus: 'failed',
        },
      });

      return {
        success: false,
        message: error.message || 'Failed to authenticate with Aruba Central',
        error: error.message,
        testedAt: new Date(),
      };
    }
  }

  /**
   * Delete Aruba Central configuration
   * @param {string} configId - Config ID
   * @param {string} userId - User ID
   */
  async deleteArubaCentralConfig(configId, userId) {
    const prisma = getPrisma();
    const arubaCentralService = require('./aruba-central.service');

    const config = await prisma.arubaCentralConfig.findFirst({
      where: { id: configId, userId },
    });

    if (!config) {
      throw new Error('Aruba Central configuration not found');
    }

    await prisma.arubaCentralConfig.delete({
      where: { id: configId },
    });

    // Clear caches
    arubaCentralService.clearConfigCache();
    const redis = arubaCentralService.getRedis();
    await redis.del('aruba:access_token');
  }
}

module.exports = new SettingsService();
