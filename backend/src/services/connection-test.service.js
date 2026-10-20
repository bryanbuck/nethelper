const DeviceAPIFactory = require('./device-api/device-api-factory');
const sshDeviceService = require('./ssh-device.service');
const devicePollerService = require('./device-poller.service');
const NetconfClient = require('./device-api/netconf-client');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { isCxRestCapable } = require('../utils/device-platform');
const { resolveTransport } = require('../utils/transport-router');
const logger = require('../utils/logger');

/**
 * Test real connectivity to a device with the given decrypted credentials.
 *
 * The test is routed the way a real operation would be, through the transport
 * matrix. AOS-CX has a REST API and Junos has NETCONF (both fill the
 * 'device-rest' slot and are dispatched by the factory); everything else is
 * tested over the SSH CLI. Junos also falls back to SSH when the device hasn't
 * enabled the NETCONF subsystem.
 *
 * Shared by the per-device test (device-api-test.controller) and the
 * credential test (settings.service.testApiCredential), so both report what
 * the device actually said.
 *
 * A cloud-managed device that no direct transport reached gets its cloud's
 * view attached as `cloudStatus` ("Mist reports it online"). That is context,
 * never a pass: the test only succeeds when the device itself answered.
 *
 * @returns {Promise<Object>} { success, message, testedAt, ... }
 */
async function testDeviceConnection(device, credentials) {
  let result = null;
  const transports = resolveTransport(device, 'test');

  for (const transport of transports) {
    if (transport === 'device-rest') {
      let deviceAPI;
      try {
        deviceAPI = DeviceAPIFactory.createDeviceAPI(device, credentials);
      } catch (error) {
        // No device API client for this platform — try the next transport.
        logger.debug(`No device API for ${device.name}: ${error.message}`);
        continue;
      }

      result = await deviceAPI.testConnection();

      // NETCONF is off on this Junos device: not a failure, just means the
      // CLI is the way in. Try the next transport instead of reporting it.
      if (!result.success && result.code === NetconfClient.NETCONF_UNAVAILABLE) {
        logger.info(`NETCONF unavailable on ${device.name}; testing over the SSH CLI instead`);
        result = null;
        continue;
      }

      // While we have working REST access to a CX switch, refresh its
      // switch-reported Central state (best-effort, never fails the test).
      if (result.success && isCxRestCapable(device)) {
        const centralStatus = await devicePollerService.refreshCentralStatus(device, credentials);
        if (centralStatus) {
          result.centralStatus = {
            centralManaged: centralStatus.centralManaged,
            connectionStatus: centralStatus.connectionStatus,
            mode: centralStatus.mode,
          };
        }
      }
      break;
    }

    if (transport === 'ssh') {
      result = await sshDeviceService.testConnection(device, credentials);
      break;
    }
  }

  result = result || {
    success: false,
    message: `No usable transport for "${device.name}" (tried: ${transports.join(', ') || 'none'})`,
    testedAt: new Date().toISOString(),
  };

  if (!result.success && transports.includes('cloud')) {
    const cloudStatus = await cloudView(device);
    if (cloudStatus) {
      result.cloudStatus = cloudStatus;
      result.message = `${result.message}. ${cloudStatus.provider} reports the device ${cloudStatus.status}; NetHelper did not reach it directly.`;
    }
  }
  return result;
}

/** What the device's cloud says about it, or null when the cloud can't say. */
async function cloudView(device) {
  if (!device.serial) return null;
  try {
    const provider = await CloudProviderFactory.forDevice(device);
    const { status, lastSeen } = await provider.getDeviceStatus(device.serial);
    return { provider: provider.integration?.name || provider.label, status, lastSeen: lastSeen || null };
  } catch (error) {
    logger.debug(`No cloud status for ${device.name}: ${error.message}`);
    return null;
  }
}

module.exports = { testDeviceConnection };
