const BaseDeviceAPI = require('./base-device-api');
const NetconfClient = require('./netconf-client');
const junosTopology = require('../topology/parsers/junos');
const logger = require('../../utils/logger');
const { assertJunosConfigReadable } = require('../../utils/config-format');

/**
 * Junos device API (Juniper EX / SRX / MX), over NETCONF.
 *
 * NETCONF is preferred over screen-scraping the CLI because messages are
 * explicitly framed and responses are structured: no prompt-matching, no
 * echo-stripping, no pager to disable. See netconf-client.js.
 *
 * The catch, and why the SSH CLI path is kept as a fallback: NETCONF is not on
 * by default. A device without `set system services netconf ssh` will
 * authenticate and then refuse the subsystem, which surfaces here as a
 * NETCONF_UNAVAILABLE error. The transport router treats that as a signal to
 * retry over the CLI rather than as a failure (see utils/transport-router.js
 * and the `juniper/junos` row of the transport matrix).
 *
 * Config format: `format="set"` yields flat, one-statement-per-line output —
 * each line is independently replayable onto a device and diffs are precise,
 * unlike the native curly-brace format where indentation blocks shift. It
 * requires Junos 15.1+; older devices fall back to `format="text"`.
 */
class JunosAPI extends BaseDeviceAPI {
  constructor(device, credentials) {
    super('junos', device, credentials);
    this.client = null;
  }

  /** Open a NETCONF session (idempotent). */
  async login() {
    if (this.client?.connected) return { success: true, reused: true };

    this.client = new NetconfClient({
      host: this.device.ipAddress,
      username: this.credentials.username,
      password: this.credentials.password,
    });
    await this.client.connect();

    return {
      success: true,
      capabilities: this.client.serverCapabilities.length,
      framing: this.client.chunked ? 'chunked' : 'end-of-message',
    };
  }

  async logout() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /** Run fn against an open session, always closing it afterwards. */
  async withSession(fn) {
    await this.login();
    try {
      return await fn(this.client);
    } finally {
      await this.logout();
    }
  }

  async testConnection() {
    const startTime = Date.now();
    try {
      const info = await this.getDeviceInfo();
      return {
        success: true,
        message: 'NETCONF connection successful',
        transport: 'netconf',
        testedAt: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        deviceInfo: info,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        // Preserved so callers can tell "NETCONF is off on this device"
        // (fall back to CLI) apart from "the device is unreachable".
        code: error.code,
        transport: 'netconf',
        testedAt: new Date().toISOString(),
        responseTime: Date.now() - startTime,
      };
    }
  }

  /** hostname / model / Junos version, via <get-software-information>. */
  async getDeviceInfo() {
    return this.withSession(async (client) => {
      const reply = await client.rpc('<get-software-information/>');
      const version = client.extractText(reply, 'junos-version')
        // Older releases report the version per-package rather than at the top.
        || this.firstPackageVersion(reply, client);

      return {
        hostname: client.extractText(reply, 'host-name'),
        model: client.extractText(reply, 'product-model')
          || client.extractText(reply, 'product-name'),
        version,
        platform: 'junos',
        vendor: 'juniper',
      };
    });
  }

  /**
   * Chassis serial and base MAC. The MAC element differs by platform: an
   * EX4000 (24.4R2, seen 2026-10-19) reports `fpc-mac-base` per FPC; the
   * spec's `public-base-address` is kept for platforms that use it.
   */
  async getIdentity() {
    return this.withSession(async (client) => {
      const inventory = await client.rpc('<get-chassis-inventory/>');
      const macs = await client.rpc('<get-chassis-mac-addresses/>');
      return {
        // The chassis element comes first, so the first serial is the chassis's.
        serial: client.extractText(inventory, 'serial-number') || null,
        macAddress: client.extractText(macs, 'public-base-address') || client.extractText(macs, 'fpc-mac-base') || null,
      };
    });
  }

  /** Firmware view of the same RPC, shaped like the other device APIs. */
  async getFirmwareInfo() {
    const info = await this.getDeviceInfo();
    return {
      current_version: info.version,
      primary_version: info.version,
      model: info.model,
      hostname: info.hostname,
    };
  }

  /**
   * The committed configuration in `set` format.
   *
   * `database="committed"` matters: the default is `candidate`, which on a
   * device someone is mid-edit on would back up uncommitted changes that are
   * not actually running.
   */
  async getConfiguration() {
    return this.withSession(async (client) => {
      let reply;
      try {
        reply = await client.rpc('<get-configuration format="set" database="committed"/>');
      } catch (error) {
        // format="set" needs Junos 15.1+. Fall back to the hierarchical text
        // format rather than failing outright on an older box.
        logger.warn(
          `Junos ${this.device.name}: set-format config failed (${error.message}); retrying with text format`
        );
        reply = await client.rpc('<get-configuration format="text" database="committed"/>');
      }

      const config = this.extractConfigText(reply, client);
      if (!config) {
        throw new Error('NETCONF returned an empty configuration');
      }
      assertJunosConfigReadable(config);
      return config;
    });
  }

  /**
   * LLDP neighbors plus this device's own LLDP identity, in one session.
   * @returns {Promise<{neighbors: Object[], identity: {chassisId, sysName}}>}
   */
  async getLldpTopology() {
    return this.withSession(async (client) => {
      const neighbors = junosTopology.parseLldpNeighborsXml(await client.rpc('<get-lldp-neighbors-information/>'));
      let identity = { chassisId: null, sysName: null };
      try {
        identity = junosTopology.parseLocalInfoXml(await client.rpc('<get-lldp-local-info/>'));
      } catch (error) {
        // Identity only improves matching; the neighbor table is what matters.
        logger.debug(`Junos ${this.device.name}: no LLDP local info (${error.message})`);
      }
      return { neighbors, identity };
    });
  }

  /**
   * Pull the config text out of an rpc-reply.
   *
   * Junos wraps set-format output in <configuration-set> and text-format in
   * <configuration-text>, but rather than depend on those names we take the
   * first of them that is present and, failing that, the text content of
   * whatever single child the reply carries. That keeps this working if the
   * wrapper element differs across releases.
   */
  extractConfigText(reply, client) {
    for (const tag of ['configuration-set', 'configuration-text', 'configuration']) {
      const text = client.extractText(reply, tag);
      if (text && text.trim()) return text.trim();
    }

    // Last resort: strip the rpc-reply envelope and take what is left.
    const body = /<(?:\w+:)?rpc-reply[^>]*>([\s\S]*)<\/(?:\w+:)?rpc-reply>/.exec(reply);
    const inner = body ? body[1].trim() : '';
    return inner ? client.decodeEntities(inner) : null;
  }

  firstPackageVersion(reply, client) {
    const pkg = client.extractText(reply, 'package-information');
    if (!pkg) return null;
    const comment = /\[([^\]]+)\]/.exec(pkg);
    return comment ? comment[1] : null;
  }

  /** Live status is not modelled for direct Junos devices yet (see roadmap). */
  async getStatus() {
    const info = await this.getDeviceInfo();
    return { reachable: true, hostname: info.hostname, version: info.version };
  }
}

module.exports = JunosAPI;
