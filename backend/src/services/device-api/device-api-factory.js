const CXSwitchAPI = require('./cx-switch-api');
const logger = require('../../utils/logger');
const { PLATFORMS, VENDORS } = require('../../constants/vendors');
const { detectPlatform } = require('../../utils/device-platform');

/**
 * Device API Factory
 *
 * Creates per-device REST API clients (the "talk to ONE device directly"
 * plane). Cloud-managed devices do NOT come through here — they route to
 * their CloudIntegration's provider in services/cloud-providers/.
 *
 * The API type is derived from the device's explicit vendor/platform fields
 * via the PLATFORMS table in constants/vendors.js (`deviceApiType`), so
 * adding a vendor means adding a constant + a client, not editing heuristics.
 * The Aruba model-string heuristics survive only inside device-platform.js,
 * as a fallback for legacy rows whose platform was never classified.
 *
 * Implemented today: cx_switch (AOS-CX). Everything else is SSH-only until
 * its roadmap phase lands (docs/MULTI_VENDOR_ROADMAP.md).
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

      // Future clients slot in here as their phases land:
      // case 'junos':             return new JunosAPI(device, credentials);
      // case 'catalyst_restconf': return new CatalystAPI(device, credentials);

      default:
        throw new Error(`Unsupported device API type: ${apiType}`);
    }
  }

  /**
   * Determine the device API type from the device's platform.
   *
   * Platform is the explicit Device.platform column when set, falling back to
   * device-platform.js's legacy Aruba heuristics for unclassified rows. The
   * platform -> API type mapping lives in constants/vendors.js.
   *
   * @param {Object} device - Device object
   * @param {Object} credentials - Credentials object (unused; kept for call-site compatibility)
   * @returns {string} Device API type
   */
  static determineDeviceAPIType(device, credentials) { // eslint-disable-line no-unused-vars
    const platform = detectPlatform(device);
    const apiType = PLATFORMS[platform]?.deviceApiType;

    if (apiType) return apiType;

    // Unclassified switches keep the historical CX default: this codebase has
    // always assumed an unknown switch speaks AOS-CX REST, and the transport
    // router preserves that for connection tests.
    if (device.type === 'switch' && platform === 'unknown') {
      logger.warn('Could not determine switch platform, defaulting to AOS-CX REST', {
        deviceName: device.name,
        model: device.model,
      });
      return 'cx_switch';
    }

    throw new Error(
      `No device REST API for ${device.vendor || 'unknown vendor'}/${platform} `
      + `(device "${device.name}"). This device is reached over SSH or its cloud platform.`
    );
  }

  /**
   * Get list of supported device API types, generated from the vendor/platform
   * catalog so the UI never drifts from what the factory can actually build.
   *
   * @returns {Array<Object>} Array of supported device types with metadata
   */
  static getSupportedDeviceTypes() {
    const IMPLEMENTED = new Set(['cx_switch']);

    return Object.values(PLATFORMS)
      .filter((platform) => platform.deviceApiType)
      .map((platform) => ({
        type: platform.deviceApiType,
        name: `${VENDORS[platform.vendor]?.label || platform.vendor} ${platform.label}`,
        description: `${platform.label} devices reached over their REST API`,
        vendor: platform.vendor,
        platform: platform.id,
        implemented: IMPLEMENTED.has(platform.deviceApiType),
      }));
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
