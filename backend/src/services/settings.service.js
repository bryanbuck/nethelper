const { getPrisma } = require('../config/database');
const encryption = require('../utils/encryption');
const axios = require('axios');
const logger = require('../utils/logger');

class SettingsService {
  /**
   * Get all API credentials for a user
   * @param {string} userId - User ID
   * @returns {Promise<Array>} Array of API credentials (with masked sensitive fields)
   */
  async getApiCredentials(userId) {
    try {
      const prisma = getPrisma();

      const credentials = await prisma.apiCredential.findMany({
        where: { userId },
        include: {
          device: {
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

      // Mask sensitive fields for response
      return credentials.map(cred => this.maskCredential(cred));
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
          device: {
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

      // Mask sensitive fields for response
      return this.maskCredential(credential);
    } catch (error) {
      logger.error('Get API credential error:', error);
      throw error;
    }
  }

  /**
   * Get API credentials by device ID
   * @param {string} deviceId - Device ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Array>} Array of API credentials
   */
  async getApiCredentialsByDevice(deviceId, userId) {
    try {
      const prisma = getPrisma();

      const credentials = await prisma.apiCredential.findMany({
        where: {
          deviceId,
          userId
        },
        orderBy: [
          { lastTestStatus: 'desc' }, // Success first
          { lastTested: 'desc' },
        ],
      });

      return credentials.map(cred => this.maskCredential(cred));
    } catch (error) {
      logger.error('Get API credentials by device error:', error);
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

      // If deviceId is provided, verify it exists
      if (credentialData.deviceId) {
        const device = await prisma.device.findUnique({
          where: { id: credentialData.deviceId },
        });

        if (!device) {
          throw new Error('Device not found');
        }
      }

      // Encrypt sensitive fields
      const encryptedData = {
        name: credentialData.name,
        type: credentialData.type,
        deviceId: credentialData.deviceId || null,
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
        include: {
          device: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
        },
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

      // If deviceId is being updated, verify it exists
      if (updateData.deviceId !== undefined && updateData.deviceId !== null) {
        const device = await prisma.device.findUnique({
          where: { id: updateData.deviceId },
        });

        if (!device) {
          throw new Error('Device not found');
        }
      }

      // Prepare update data
      const encryptedUpdateData = {
        ...(updateData.name && { name: updateData.name }),
        ...(updateData.type && { type: updateData.type }),
        ...(updateData.deviceId !== undefined && { deviceId: updateData.deviceId }),
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
        include: {
          device: {
            select: {
              id: true,
              name: true,
              serial: true,
              type: true,
            },
          },
        },
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
   * Test an API credential by attempting to connect to the device
   * @param {string} credentialId - Credential ID
   * @param {string} userId - User ID (for authorization)
   * @returns {Promise<Object>} Test result
   */
  async testApiCredential(credentialId, userId) {
    try {
      const prisma = getPrisma();

      // Get credential with decrypted values
      const credential = await prisma.apiCredential.findFirst({
        where: { id: credentialId, userId },
        include: {
          device: true,
        },
      });

      if (!credential) {
        throw new Error('API credential not found');
      }

      const startTime = Date.now();
      let testResult;

      try {
        // Decrypt credentials
        const decryptedCreds = {
          username: credential.username ? encryption.decrypt(credential.username) : null,
          password: credential.password ? encryption.decrypt(credential.password) : null,
          apiKey: credential.apiKey ? encryption.decrypt(credential.apiKey) : null,
          apiSecret: credential.apiSecret ? encryption.decrypt(credential.apiSecret) : null,
        };

        // Attempt connection based on device type
        testResult = await this.testDeviceConnection(
          credential.type,
          credential.device,
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
      deviceId: credential.deviceId,
      device: credential.device,
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

      // Get the most recently successful credential for the device
      const credential = await prisma.apiCredential.findFirst({
        where: {
          deviceId,
          lastTestStatus: 'success',
        },
        orderBy: { lastTested: 'desc' },
      });

      if (!credential) {
        // Fallback to any credential for the device
        const fallback = await prisma.apiCredential.findFirst({
          where: { deviceId },
          orderBy: { createdAt: 'desc' },
        });

        if (!fallback) {
          return null;
        }

        return this.decryptCredential(fallback);
      }

      return this.decryptCredential(credential);
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
}

module.exports = new SettingsService();
