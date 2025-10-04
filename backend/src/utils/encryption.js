const crypto = require('crypto');
const logger = require('./logger');

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

class EncryptionService {
  constructor() {
    this.encryptionKey = process.env.ENCRYPTION_KEY;

    if (!this.encryptionKey) {
      logger.warn('ENCRYPTION_KEY not set in environment variables. Using default key (NOT SECURE FOR PRODUCTION)');
      this.encryptionKey = 'default-key-change-this-in-production-for-security';
    }
  }

  /**
   * Derives a key from the encryption key using PBKDF2
   * @param {string} salt - Salt for key derivation
   * @returns {Buffer} Derived key
   */
  deriveKey(salt) {
    return crypto.pbkdf2Sync(
      this.encryptionKey,
      salt,
      ITERATIONS,
      KEY_LENGTH,
      'sha256'
    );
  }

  /**
   * Encrypts a string value
   * @param {string} text - Plain text to encrypt
   * @returns {string|null} Encrypted text in format: salt:iv:encrypted:tag (hex encoded)
   */
  encrypt(text) {
    try {
      if (!text) {
        return null;
      }

      // Generate random salt and IV
      const salt = crypto.randomBytes(SALT_LENGTH);
      const iv = crypto.randomBytes(IV_LENGTH);

      // Derive key from password and salt
      const key = this.deriveKey(salt);

      // Create cipher
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

      // Encrypt the text
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get the auth tag
      const tag = cipher.getAuthTag();

      // Combine salt, iv, encrypted text, and tag
      return `${salt.toString('hex')}:${iv.toString('hex')}:${encrypted}:${tag.toString('hex')}`;
    } catch (error) {
      logger.error('Encryption error:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypts an encrypted string value
   * @param {string} encryptedText - Encrypted text in format: salt:iv:encrypted:tag
   * @returns {string|null} Decrypted plain text
   */
  decrypt(encryptedText) {
    try {
      if (!encryptedText) {
        return null;
      }

      // Split the encrypted text into its components
      const parts = encryptedText.split(':');
      if (parts.length !== 4) {
        throw new Error('Invalid encrypted text format');
      }

      const salt = Buffer.from(parts[0], 'hex');
      const iv = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      const tag = Buffer.from(parts[3], 'hex');

      // Derive key from password and salt
      const key = this.deriveKey(salt);

      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);

      // Decrypt the text
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('Decryption error:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Masks a sensitive value for display
   * @param {string} value - Value to mask
   * @returns {string} Masked value
   */
  mask(value) {
    if (!value) {
      return null;
    }
    return '***';
  }

  /**
   * Encrypts sensitive fields in an object
   * @param {Object} data - Object containing sensitive fields
   * @param {Array} fields - Array of field names to encrypt
   * @returns {Object} Object with encrypted fields
   */
  encryptFields(data, fields = ['password', 'apiKey', 'apiSecret']) {
    const encrypted = { ...data };

    fields.forEach(field => {
      if (encrypted[field]) {
        encrypted[field] = this.encrypt(encrypted[field]);
      }
    });

    return encrypted;
  }

  /**
   * Decrypts sensitive fields in an object
   * @param {Object} data - Object containing encrypted fields
   * @param {Array} fields - Array of field names to decrypt
   * @returns {Object} Object with decrypted fields
   */
  decryptFields(data, fields = ['password', 'apiKey', 'apiSecret']) {
    const decrypted = { ...data };

    fields.forEach(field => {
      if (decrypted[field]) {
        decrypted[field] = this.decrypt(decrypted[field]);
      }
    });

    return decrypted;
  }

  /**
   * Masks sensitive fields in an object for API responses
   * @param {Object} data - Object containing sensitive fields
   * @param {Array} fields - Array of field names to mask
   * @returns {Object} Object with masked fields
   */
  maskFields(data, fields = ['password', 'apiSecret']) {
    const masked = { ...data };

    fields.forEach(field => {
      if (masked[field]) {
        masked[field] = this.mask(masked[field]);
      }
    });

    return masked;
  }
}

// Export singleton instance
module.exports = new EncryptionService();
