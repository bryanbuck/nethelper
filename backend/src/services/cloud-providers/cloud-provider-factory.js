const { getPrisma } = require('../../config/database');
// NOTE: encryption exports a class instance whose methods use `this` — never
// destructure decrypt/encrypt off it (the old aruba-central.service did, and
// its DB-config decryption path was silently broken because of it).
const encryption = require('../../utils/encryption');
const { CLOUD_PROVIDERS } = require('../../constants/vendors');
const ArubaCentralProvider = require('./aruba-central.provider');
const MistProvider = require('./mist.provider');
const logger = require('../../utils/logger');

// Synthetic integration id used when falling back to ARUBA_CENTRAL_* env vars
// (kept for parity with the pre-CloudIntegration behavior, where env vars
// backed the tenant when no DB config row existed).
const ENV_ARUBA_INTEGRATION_ID = 'env:aruba_central';

const PROVIDER_CLASSES = {
  aruba_central: ArubaCentralProvider,
  juniper_mist: MistProvider,
  // cisco_meraki: Phase 3 (docs/MULTI_VENDOR_ROADMAP.md)
};

/**
 * Builds cloud-provider instances from CloudIntegration rows. One instance
 * per row; several integrations — including several tenants of the same
 * provider — can be in play at once, each with its own credentials and
 * token cache.
 */
class CloudProviderFactory {
  /**
   * @param {Object|string} integrationOrId - CloudIntegration row or its id
   * @returns {Promise<BaseCloudProvider>}
   */
  static async forIntegration(integrationOrId) {
    let integration = integrationOrId;
    if (typeof integrationOrId === 'string') {
      if (integrationOrId === ENV_ARUBA_INTEGRATION_ID) {
        integration = this.envArubaIntegration();
        if (!integration) throw new Error('ARUBA_CENTRAL_* environment variables are not configured');
      } else {
        integration = await getPrisma().cloudIntegration.findUnique({ where: { id: integrationOrId } });
        if (!integration) throw new Error(`Cloud integration ${integrationOrId} not found`);
      }
    }
    return this.instantiate(integration);
  }

  /**
   * Provider managing a given device (via device.cloudIntegrationId).
   * Cloud-managed legacy rows without an integration reference fall back to
   * the one active integration of the device vendor's cloud, then (Aruba
   * only) to the ARUBA_CENTRAL_* env vars.
   * @param {Object} device - Device row
   * @returns {Promise<BaseCloudProvider>}
   */
  static async forDevice(device) {
    const prisma = getPrisma();

    if (device.cloudIntegrationId) {
      const integration = await prisma.cloudIntegration.findUnique({
        where: { id: device.cloudIntegrationId },
      });
      if (!integration) {
        throw new Error(`Cloud integration ${device.cloudIntegrationId} for device "${device.name}" no longer exists`);
      }
      return this.instantiate(integration);
    }

    if (device.managementMode !== 'cloud') {
      throw new Error(`Device "${device.name}" is not cloud-managed`);
    }

    // A legacy cloud row with no integration: use the vendor's own cloud, but
    // only when exactly one integration of it is active. With several, picking
    // one would be a guess (a Juniper switch must never go to Central).
    const providers = Object.entries(CLOUD_PROVIDERS)
      .filter(([, meta]) => meta.vendor === (device.vendor || 'aruba'))
      .map(([key]) => key);
    const candidates = providers.length
      ? await prisma.cloudIntegration.findMany({ where: { provider: { in: providers }, isActive: true } })
      : [];
    if (candidates.length === 1) return this.instantiate(candidates[0]);
    if (candidates.length > 1) {
      throw new Error(`Device "${device.name}" has no cloud integration and ${candidates.length} could manage it. Sync devices to attribute it.`);
    }

    const envIntegration = (device.vendor || 'aruba') === 'aruba' ? this.envArubaIntegration() : null;
    if (envIntegration) return this.instantiate(envIntegration);

    throw new Error(`No cloud integration available for device "${device.name}". Configure one in Settings.`);
  }

  /**
   * Instances for every active integration (used by cloud sync). When no DB
   * rows exist but ARUBA_CENTRAL_* env vars are set, returns the synthetic
   * env-backed Central integration so pre-CloudIntegration setups keep
   * syncing.
   * @param {Object} [where] - extra Prisma filter (e.g. { provider: 'aruba_central' })
   * @returns {Promise<BaseCloudProvider[]>}
   */
  static async activeProviders(where = {}) {
    const rows = await getPrisma().cloudIntegration.findMany({
      where: { isActive: true, ...where },
      orderBy: { createdAt: 'asc' },
    });

    if (rows.length === 0) {
      const envIntegration = this.envArubaIntegration();
      return envIntegration ? [this.instantiate(envIntegration)] : [];
    }

    const providers = [];
    for (const row of rows) {
      try {
        providers.push(this.instantiate(row));
      } catch (error) {
        // One bad integration (unimplemented provider, mangled credentials)
        // must not take down sync for the others.
        logger.warn(`Skipping cloud integration "${row.name}" (${row.provider}): ${error.message}`);
      }
    }
    return providers;
  }

  /** @param {Object} integration - CloudIntegration row (encrypted or env-sourced credentials) */
  static instantiate(integration) {
    const ProviderClass = PROVIDER_CLASSES[integration.provider];
    if (!ProviderClass) {
      throw new Error(`Cloud provider "${integration.provider}" is not implemented yet`);
    }
    return new ProviderClass({
      ...integration,
      credentials: this.decryptCredentials(integration),
    });
  }

  /**
   * Decrypt the secret fields of an integration's credentials JSON in-memory.
   * Which fields are secret comes from constants/vendors.js. Env-sourced
   * credentials (marked _plaintext) are passed through untouched.
   */
  static decryptCredentials(integration) {
    const credentials = integration.credentials || {};
    if (credentials._plaintext) {
      const { _plaintext, ...rest } = credentials;
      return rest;
    }
    const fields = CLOUD_PROVIDERS[integration.provider]?.credentialFields || [];
    const decrypted = { ...credentials };
    for (const field of fields) {
      if (field.secret && decrypted[field.key]) {
        decrypted[field.key] = encryption.decrypt(decrypted[field.key]);
      }
    }
    return decrypted;
  }

  /** Synthetic Central integration from ARUBA_CENTRAL_* env vars, or null. */
  static envArubaIntegration() {
    if (!process.env.ARUBA_CENTRAL_BASE_URL || !process.env.ARUBA_CENTRAL_CLIENT_ID) return null;
    return {
      id: ENV_ARUBA_INTEGRATION_ID,
      provider: 'aruba_central',
      name: 'Aruba Central (environment)',
      baseUrl: process.env.ARUBA_CENTRAL_BASE_URL,
      isActive: true,
      credentials: {
        _plaintext: true,
        clientId: process.env.ARUBA_CENTRAL_CLIENT_ID,
        clientSecret: process.env.ARUBA_CENTRAL_CLIENT_SECRET,
        workspaceId: process.env.ARUBA_CENTRAL_WORKSPACE_ID,
      },
    };
  }
}

module.exports = CloudProviderFactory;
module.exports.ENV_ARUBA_INTEGRATION_ID = ENV_ARUBA_INTEGRATION_ID;
