const CXSwitchAPI = require('./cx-switch-api');
const logger = require('../../utils/logger');

/**
 * Device API Factory
 *
 * Factory class for creating device-specific API instances based on device type.
 * This provides a single entry point for accessing device APIs and makes it easy
 * to add support for new device types in the future.
 *
 * Supported Device Types:
 * - cx_switch: Aruba CX switches (AOS-CX)
 * - aos_switch: Aruba AOS switches (future)
 * - ap: Aruba Instant APs (future)
 * - controller: Aruba Controllers (future)
 */
class DeviceAPIFactory {
  /**
   * Create a device API instance based on device type
   *
   * @param {Object} device - Device object from database
   * @param {Object} credentials - Decrypted credentials object
   * @param {string} deviceApiType - Optional override for device API type
   * @returns {BaseDeviceAPI} Device API instance
   * @throws {Error} If device type is not supported
   */
  static createDeviceAPI(device, credentials, deviceApiType = null) {
    // Determine the device API type
    const apiType = deviceApiType || DeviceAPIFactory.determineDeviceAPIType(device, credentials);

    logger.debug('Creating device API instance', {
      deviceName: device.name,
      deviceType: device.type,
      apiType,
      credentialType: credentials.type || 'unknown',
    });

    // Create the appropriate API instance
    switch (apiType) {
      case 'cx_switch':
        return new CXSwitchAPI(device, credentials);

      // Future device types can be added here:
      // case 'aos_switch':
      //   return new AOSSwitchAPI(device, credentials);
      //
      // case 'instant_ap':
      //   return new InstantAPAPI(device, credentials);
      //
      // case 'aruba_controller':
      //   return new ArubaControllerAPI(device, credentials);

      default:
        throw new Error(`Unsupported device API type: ${apiType}`);
    }
  }

  /**
   * Determine the device API type based on device and credential information
   *
   * This method uses various heuristics to determine which API to use:
   * 1. Explicit credential type (if specified)
   * 2. Device model/type information
   * 3. Device metadata
   *
   * @param {Object} device - Device object
   * @param {Object} credentials - Credentials object (may include type hint)
   * @returns {string} Device API type
   */
  static determineDeviceAPIType(device, credentials) {
    // If credentials specify a type, use that as a hint
    if (credentials.type) {
      switch (credentials.type) {
        case 'switch':
          // Determine if it's CX or AOS based on model or metadata
          return DeviceAPIFactory.determineSwitchType(device);
        case 'ap':
          return 'instant_ap';
        case 'gateway':
          return 'aruba_gateway';
        case 'controller':
          return 'aruba_controller';
      }
    }

    // Fall back to device type
    switch (device.type) {
      case 'switch':
        return DeviceAPIFactory.determineSwitchType(device);
      case 'access_point':
        return 'instant_ap';
      case 'gateway':
        return 'aruba_gateway';
      default:
        throw new Error(`Cannot determine API type for device type: ${device.type}`);
    }
  }

  /**
   * Determine switch type (CX vs AOS) based on device information
   *
   * @param {Object} device - Device object
   * @returns {string} Switch API type (cx_switch or aos_switch)
   */
  static determineSwitchType(device) {
    // Check device model
    if (device.model) {
      const model = device.model.toLowerCase();

      // CX switch models typically contain 'cx' or specific model numbers
      if (model.includes('cx') ||
          model.includes('8360') ||
          model.includes('8325') ||
          model.includes('6300') ||
          model.includes('6400')) {
        return 'cx_switch';
      }

      // AOS switch models
      if (model.includes('2930') ||
          model.includes('2540') ||
          model.includes('5400') ||
          model.includes('3810')) {
        return 'aos_switch';
      }
    }

    // Check metadata for hints
    if (device.metadata) {
      if (device.metadata.operatingSystem === 'AOS-CX' ||
          device.metadata.os === 'AOS-CX') {
        return 'cx_switch';
      }

      if (device.metadata.operatingSystem === 'AOS-Switch' ||
          device.metadata.os === 'AOS-Switch') {
        return 'aos_switch';
      }
    }

    // Default to CX for now (most modern switches)
    logger.warn('Could not definitively determine switch type, defaulting to CX', {
      deviceName: device.name,
      model: device.model,
    });

    return 'cx_switch';
  }

  /**
   * Get list of supported device API types
   *
   * @returns {Array<Object>} Array of supported device types with metadata
   */
  static getSupportedDeviceTypes() {
    return [
      {
        type: 'cx_switch',
        name: 'Aruba CX Switch',
        description: 'Aruba CX switches running AOS-CX',
        implemented: true,
      },
      {
        type: 'aos_switch',
        name: 'Aruba AOS Switch',
        description: 'Legacy Aruba switches running AOS-Switch',
        implemented: false,
      },
      {
        type: 'instant_ap',
        name: 'Aruba Instant AP',
        description: 'Aruba Instant Access Points',
        implemented: false,
      },
      {
        type: 'aruba_controller',
        name: 'Aruba Controller',
        description: 'Aruba wireless controllers',
        implemented: false,
      },
      {
        type: 'aruba_gateway',
        name: 'Aruba Gateway',
        description: 'Aruba gateways and mobility controllers',
        implemented: false,
      },
    ];
  }

  /**
   * Check if a device API type is supported
   *
   * @param {string} apiType - Device API type to check
   * @returns {boolean} True if supported
   */
  static isSupported(apiType) {
    const supported = DeviceAPIFactory.getSupportedDeviceTypes();
    const deviceType = supported.find(dt => dt.type === apiType);
    return deviceType && deviceType.implemented;
  }
}

module.exports = DeviceAPIFactory;
