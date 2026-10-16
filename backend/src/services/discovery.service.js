const { execFile } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const { getPrisma } = require('../config/database');
const CloudProviderFactory = require('./cloud-providers/cloud-provider-factory');
const { getIO } = require('../websocket/socket.handler');
const logger = require('../utils/logger');
const { normalizeMac } = require('../utils/device-key');

const execFileAsync = promisify(execFile);

// Curated OUI prefixes for Aruba Networks and HPE (switch/AP hardware).
// Extend this list as new hardware generations appear on the network.
const KNOWN_OUIS = {
  '00:0b:86': 'Aruba Networks (HPE)',
  '00:1a:1e': 'Aruba Networks (HPE)',
  '00:24:6c': 'Aruba Networks (HPE)',
  '04:bd:88': 'Aruba Networks (HPE)',
  '18:64:72': 'Aruba Networks (HPE)',
  '20:4c:03': 'Aruba Networks (HPE)',
  '24:de:c6': 'Aruba Networks (HPE)',
  '38:17:c3': 'Aruba Networks (HPE)',
  '40:e3:d6': 'Aruba Networks (HPE)',
  '6c:f3:7f': 'Aruba Networks (HPE)',
  '70:3a:0e': 'Aruba Networks (HPE)',
  '84:d4:7e': 'Aruba Networks (HPE)',
  '94:b4:0f': 'Aruba Networks (HPE)',
  '9c:1c:12': 'Aruba Networks (HPE)',
  'ac:a3:1e': 'Aruba Networks (HPE)',
  'b4:5d:50': 'Aruba Networks (HPE)',
  'bc:9f:e4': 'Aruba Networks (HPE)',
  'cc:88:c7': 'Aruba Networks (HPE)',
  'd8:c7:c8': 'Aruba Networks (HPE)',
  'f0:5c:19': 'Aruba Networks (HPE)',
  'f4:2e:7f': 'Aruba Networks (HPE)',
  '3c:a8:2a': 'Hewlett Packard Enterprise',
  '5c:b9:01': 'Hewlett Packard Enterprise',
  '94:f1:28': 'Hewlett Packard Enterprise',
  '98:f2:b3': 'Hewlett Packard Enterprise',
  'ec:eb:b8': 'Hewlett Packard Enterprise',
};

// Ports probed on responsive hosts for best-effort type detection
const FINGERPRINT_PORTS = '22,80,443,4343,8080,8443';

const CIDR_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

class DiscoveryService {
  constructor() {
    this.scanTimeout = parseInt(process.env.DISCOVERY_SCAN_TIMEOUT) || 300000; // 5 min per nmap run
  }

  /**
   * Validate a CIDR string strictly (also guards the value passed to nmap).
   * Prefixes below /16 are rejected to keep sweep times reasonable.
   */
  isValidCidr(cidr) {
    const match = CIDR_REGEX.exec(cidr);
    if (!match) return false;
    const octets = match.slice(1, 5).map(Number);
    const prefix = Number(match[5]);
    return octets.every((o) => o >= 0 && o <= 255) && prefix >= 16 && prefix <= 32;
  }

  /**
   * Suggest subnets to scan based on the host's own non-loopback IPv4 interfaces.
   */
  getLocalSubnets() {
    const subnets = [];
    const interfaces = os.networkInterfaces();
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs || []) {
        if (addr.family !== 'IPv4' || addr.internal || !addr.cidr) continue;
        // Normalize host CIDR to the network base (e.g. 192.168.0.169/24 -> 192.168.0.0/24)
        const [ip, prefixStr] = addr.cidr.split('/');
        const prefix = Number(prefixStr);
        const ipNum = ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
        const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
        const network = (ipNum & mask) >>> 0;
        const base = [24, 16, 8, 0].map((shift) => (network >>> shift) & 255).join('.');
        subnets.push({ interface: name, subnet: `${base}/${prefix}` });
      }
    }
    return subnets;
  }

  normalizeMac(mac) {
    return normalizeMac(mac);
  }

  lookupVendor(mac) {
    const normalized = this.normalizeMac(mac);
    if (!normalized) return null;
    return KNOWN_OUIS[normalized.slice(0, 8)] || null;
  }

  emitProgress(scanId, progress, phase, message) {
    try {
      getIO().emit('discovery:progress', { scanId, progress, phase, message });
    } catch (error) {
      // Socket not initialized (e.g. during tests) - progress still lands in the DB
    }
  }

  /**
   * Create a scan record and return it. The actual scan runs via the Bull queue.
   */
  async createScan(subnets, userId) {
    const prisma = getPrisma();

    let targets = Array.isArray(subnets) ? subnets.filter(Boolean) : [];
    if (targets.length === 0) {
      targets = this.getLocalSubnets().map((s) => s.subnet);
    }
    if (targets.length === 0) {
      throw new Error('No subnets to scan: none provided and no local subnets detected');
    }
    const invalid = targets.filter((s) => !this.isValidCidr(s));
    if (invalid.length > 0) {
      throw new Error(`Invalid subnet(s): ${invalid.join(', ')} (expected CIDR between /16 and /32)`);
    }

    const running = await prisma.discoveryScan.findFirst({
      where: { status: { in: ['pending', 'running'] } },
    });
    if (running) {
      const error = new Error('A discovery scan is already in progress');
      error.statusCode = 409;
      throw error;
    }

    return prisma.discoveryScan.create({
      data: { subnets: targets, triggeredBy: userId || null },
    });
  }

  /**
   * Execute a full discovery scan (called from the Bull job processor).
   */
  async runScan(scanId) {
    const prisma = getPrisma();
    const scan = await prisma.discoveryScan.findUnique({ where: { id: scanId } });
    if (!scan) throw new Error(`Discovery scan ${scanId} not found`);

    await prisma.discoveryScan.update({
      where: { id: scanId },
      data: { status: 'running', startedAt: new Date(), progress: 5 },
    });
    this.emitProgress(scanId, 5, 'sweep', 'Starting network sweep');

    try {
      const subnets = scan.subnets;
      const hosts = new Map(); // ip -> { ipAddress, hostname, macAddress, vendor }

      // Phase 1: ping/ARP sweep per subnet (0-50%)
      for (let i = 0; i < subnets.length; i++) {
        const subnet = subnets[i];
        this.emitProgress(scanId, 5 + Math.round((i / subnets.length) * 45), 'sweep', `Sweeping ${subnet}`);
        const swept = await this.sweepSubnet(subnet);
        for (const host of swept) hosts.set(host.ipAddress, { ...host, subnet });
        const progress = 5 + Math.round(((i + 1) / subnets.length) * 45);
        await prisma.discoveryScan.update({ where: { id: scanId }, data: { progress } });
      }

      // Phase 2: fill missing MACs from the kernel neighbor table (no root needed)
      await this.enrichFromNeighborTable(hosts);
      for (const host of hosts.values()) {
        host.vendor = host.vendor || this.lookupVendor(host.macAddress);
        host.isArubaVendor = !!(host.macAddress && KNOWN_OUIS[this.normalizeMac(host.macAddress)?.slice(0, 8)]);
      }

      // Phase 3: port fingerprint responsive hosts (50-70%)
      this.emitProgress(scanId, 55, 'fingerprint', `Fingerprinting ${hosts.size} hosts`);
      await this.fingerprintHosts(hosts);
      await prisma.discoveryScan.update({ where: { id: scanId }, data: { progress: 70 } });

      // Phase 4: cross-check Aruba Central inventory by MAC (70-85%)
      this.emitProgress(scanId, 75, 'central', 'Cross-checking Aruba Central inventory');
      const centralByMac = await this.getCentralInventoryByMac();
      await prisma.discoveryScan.update({ where: { id: scanId }, data: { progress: 85 } });

      // Phase 5: conflict detection against local inventory and persistence (85-100%)
      this.emitProgress(scanId, 90, 'save', 'Resolving conflicts and saving results');
      const localDevices = await prisma.device.findMany({
        select: { id: true, serial: true, ipAddress: true, macAddress: true },
      });
      const localByIp = new Map(localDevices.filter((d) => d.ipAddress).map((d) => [d.ipAddress, d]));
      const localByMac = new Map(
        localDevices
          .map((d) => [this.normalizeMac(d.macAddress), d])
          .filter(([mac]) => mac)
      );
      const localBySerial = new Map(localDevices.map((d) => [d.serial, d]));

      let arubaCount = 0;
      const records = [];
      for (const host of hosts.values()) {
        const mac = this.normalizeMac(host.macAddress);
        const central = mac ? centralByMac.get(mac) : null;
        const isAruba = host.isArubaVendor || !!central;
        if (isAruba) arubaCount++;

        let existing = null;
        let conflictType = null;
        if (mac && localByMac.has(mac)) {
          existing = localByMac.get(mac);
          conflictType = 'mac_conflict';
        } else if (central && localBySerial.has(central.serial)) {
          existing = localBySerial.get(central.serial);
          conflictType = 'serial_conflict';
        } else if (localByIp.has(host.ipAddress)) {
          existing = localByIp.get(host.ipAddress);
          conflictType = 'ip_conflict';
        }

        records.push({
          scanId,
          ipAddress: host.ipAddress,
          subnet: host.subnet || null,
          macAddress: mac,
          vendor: central ? 'Aruba Networks (HPE)' : host.vendor,
          hostname: host.hostname || null,
          isArubaVendor: isAruba,
          openPorts: host.openPorts || [],
          suggestedType: this.suggestType(host, central),
          suggestedName: central?.deviceName || host.hostname || null,
          centralSerial: central?.serial || null,
          centralMatch: central || null,
          existingDeviceId: existing?.id || null,
          conflictType,
        });
      }

      if (records.length > 0) {
        await prisma.discoveredDevice.createMany({ data: records });
      }

      const completed = await prisma.discoveryScan.update({
        where: { id: scanId },
        data: {
          status: 'completed',
          completedAt: new Date(),
          progress: 100,
          totalHosts: hosts.size,
          arubaHosts: arubaCount,
        },
      });

      try {
        getIO().emit('discovery:completed', {
          scanId,
          totalHosts: completed.totalHosts,
          arubaHosts: completed.arubaHosts,
        });
      } catch (e) { /* socket not initialized */ }

      logger.info(`Discovery scan ${scanId} completed`, {
        totalHosts: hosts.size,
        arubaHosts: arubaCount,
      });
      return completed;
    } catch (error) {
      logger.error(`Discovery scan ${scanId} failed:`, error);
      await prisma.discoveryScan.update({
        where: { id: scanId },
        data: { status: 'failed', completedAt: new Date(), error: error.message },
      });
      try {
        getIO().emit('discovery:failed', { scanId, error: error.message });
      } catch (e) { /* socket not initialized */ }
      throw error;
    }
  }

  /**
   * Ping sweep a subnet with nmap. Parses host/MAC pairs from output.
   * Works unprivileged; MAC lines only appear when running as root, so
   * enrichFromNeighborTable() covers the unprivileged case.
   */
  async sweepSubnet(subnet) {
    if (!this.isValidCidr(subnet)) throw new Error(`Invalid subnet: ${subnet}`);

    const { stdout } = await execFileAsync(
      'nmap',
      ['-sn', '-T4', '--max-retries', '1', subnet],
      { timeout: this.scanTimeout, maxBuffer: 10 * 1024 * 1024 }
    );

    const hosts = [];
    let current = null;
    for (const line of stdout.split('\n')) {
      const reportMatch = /^Nmap scan report for (?:(.+) \((\d+\.\d+\.\d+\.\d+)\)|(\d+\.\d+\.\d+\.\d+))/.exec(line);
      if (reportMatch) {
        current = {
          ipAddress: reportMatch[2] || reportMatch[3],
          hostname: reportMatch[1] || null,
          macAddress: null,
          vendor: null,
        };
        hosts.push(current);
        continue;
      }
      const macMatch = /^MAC Address: ([0-9A-Fa-f:]{17})(?: \((.+)\))?/.exec(line);
      if (macMatch && current) {
        current.macAddress = macMatch[1];
        if (macMatch[2] && macMatch[2] !== 'Unknown') current.vendor = macMatch[2];
      }
    }
    return hosts;
  }

  /**
   * Fill in MAC addresses from the kernel ARP/neighbor table, which the
   * sweep just populated. Avoids needing root for nmap ARP scans.
   */
  async enrichFromNeighborTable(hosts) {
    try {
      const { stdout } = await execFileAsync('ip', ['neigh', 'show'], { timeout: 10000 });
      for (const line of stdout.split('\n')) {
        const match = /^(\d+\.\d+\.\d+\.\d+)\s.*lladdr\s+([0-9a-f:]{17})/i.exec(line);
        if (!match) continue;
        const host = hosts.get(match[1]);
        if (host && !host.macAddress) host.macAddress = match[2];
      }
    } catch (error) {
      logger.warn('Could not read neighbor table for MAC enrichment:', error.message);
    }
  }

  /**
   * Probe a fixed set of TCP ports on all responsive hosts for type hints.
   */
  async fingerprintHosts(hosts) {
    const ips = [...hosts.keys()];
    if (ips.length === 0) return;

    try {
      const { stdout } = await execFileAsync(
        'nmap',
        ['-p', FINGERPRINT_PORTS, '-T4', '--open', '-Pn', '--max-retries', '1', ...ips],
        { timeout: this.scanTimeout, maxBuffer: 10 * 1024 * 1024 }
      );

      let current = null;
      for (const line of stdout.split('\n')) {
        const reportMatch = /^Nmap scan report for (?:.+ \((\d+\.\d+\.\d+\.\d+)\)|(\d+\.\d+\.\d+\.\d+))/.exec(line);
        if (reportMatch) {
          current = hosts.get(reportMatch[1] || reportMatch[2]) || null;
          if (current) current.openPorts = [];
          continue;
        }
        const portMatch = /^(\d+)\/tcp\s+open/.exec(line);
        if (portMatch && current) {
          current.openPorts.push(Number(portMatch[1]));
        }
      }
    } catch (error) {
      logger.warn('Port fingerprinting failed, continuing without port data:', error.message);
    }
  }

  /**
   * Best-effort device type suggestion. A Central inventory match is
   * authoritative; otherwise fall back to port heuristics.
   */
  suggestType(host, central) {
    if (central?.deviceType) {
      const map = { ACCESS_POINT: 'access_point', SWITCH: 'switch', GATEWAY: 'gateway' };
      return map[central.deviceType] || null;
    }
    if (!host.isArubaVendor) return null;
    const ports = host.openPorts || [];
    if (ports.includes(4343)) return 'access_point'; // Aruba AP/controller web UI
    if (ports.includes(22) && ports.includes(443)) return 'switch';
    return null;
  }

  /**
   * Fetch the inventory of every active cloud integration and index it by
   * normalized MAC. An integration that is unconfigured or unreachable is
   * skipped so the scan still completes with whatever data is available.
   */
  async getCentralInventoryByMac() {
    const byMac = new Map();
    const providers = await CloudProviderFactory.activeProviders().catch((error) => {
      logger.warn('Cloud inventory cross-check skipped:', error.message);
      return [];
    });

    for (const provider of providers) {
      try {
        for (const device of await provider.listInventory()) {
          const mac = this.normalizeMac(device.macAddress);
          if (!mac) continue;
          byMac.set(mac, {
            serial: device.serial,
            deviceName: device.name,
            deviceType: device.type,
            model: device.model,
            status: device.status,
            integrationId: provider.id,
            integrationName: provider.label,
          });
        }
      } catch (error) {
        logger.warn(`Cloud inventory cross-check skipped for ${provider.label}:`, error.message);
      }
    }
    return byMac;
  }

  async getScans(limit = 20) {
    const prisma = getPrisma();
    return prisma.discoveryScan.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: { _count: { select: { discoveredDevices: true } } },
    });
  }

  async getScan(scanId) {
    const prisma = getPrisma();
    const scan = await prisma.discoveryScan.findUnique({
      where: { id: scanId },
      include: {
        discoveredDevices: {
          orderBy: [{ isArubaVendor: 'desc' }, { ipAddress: 'asc' }],
        },
      },
    });
    if (!scan) {
      const error = new Error('Discovery scan not found');
      error.statusCode = 404;
      throw error;
    }
    return scan;
  }

  async deleteScan(scanId) {
    const prisma = getPrisma();
    await prisma.discoveryScan.delete({ where: { id: scanId } });
  }

  /**
   * Import a discovered device into the inventory. Refuses when the device
   * conflicts with an existing one unless the caller resolves it by passing
   * updateExisting=true (merges IP/MAC into the conflicting device instead).
   */
  async importDevice(discoveredId, overrides = {}, userId) {
    const prisma = getPrisma();
    const discovered = await prisma.discoveredDevice.findUnique({ where: { id: discoveredId } });
    if (!discovered) {
      const error = new Error('Discovered device not found');
      error.statusCode = 404;
      throw error;
    }
    if (discovered.status !== 'new') {
      const error = new Error(`Discovered device already ${discovered.status}`);
      error.statusCode = 409;
      throw error;
    }

    if (discovered.existingDeviceId) {
      if (!overrides.updateExisting) {
        const error = new Error(
          `Conflicts with existing device (${discovered.conflictType}). Pass updateExisting=true to merge scan data into it.`
        );
        error.statusCode = 409;
        throw error;
      }
      const updated = await prisma.device.update({
        where: { id: discovered.existingDeviceId },
        data: {
          ipAddress: discovered.ipAddress,
          macAddress: discovered.macAddress || undefined,
          lastSeen: new Date(),
        },
      });
      await prisma.discoveredDevice.update({
        where: { id: discoveredId },
        data: { status: 'imported' },
      });
      return { device: updated, merged: true };
    }

    const serial = overrides.serial || discovered.centralSerial || discovered.macAddress?.toUpperCase();
    if (!serial) {
      const error = new Error('A serial number is required to import this device (none detected)');
      error.statusCode = 400;
      throw error;
    }
    const type = overrides.type || discovered.suggestedType;
    if (!type) {
      const error = new Error('A device type is required to import this device (none detected)');
      error.statusCode = 400;
      throw error;
    }

    const device = await prisma.device.create({
      data: {
        serial,
        name: overrides.name || discovered.suggestedName || discovered.ipAddress,
        type,
        vendor: overrides.vendor || 'aruba',
        platform: overrides.platform || null,
        model: overrides.model || discovered.centralMatch?.model || 'Unknown',
        ipAddress: discovered.ipAddress,
        macAddress: discovered.macAddress,
        location: overrides.location || null,
        // Discovered devices are reached on the local network, regardless of
        // whether a cloud plane also knows about them.
        managementMode: 'direct',
        apiCredentialId: overrides.apiCredentialId || null,
        metadata: {
          discoveredByScan: discovered.scanId,
          importedBy: userId || null,
          openPorts: discovered.openPorts,
        },
      },
    });
    await prisma.discoveredDevice.update({
      where: { id: discoveredId },
      data: { status: 'imported' },
    });
    return { device, merged: false };
  }

  async ignoreDevice(discoveredId) {
    const prisma = getPrisma();
    const discovered = await prisma.discoveredDevice.findUnique({ where: { id: discoveredId } });
    if (!discovered) {
      const error = new Error('Discovered device not found');
      error.statusCode = 404;
      throw error;
    }
    return prisma.discoveredDevice.update({
      where: { id: discoveredId },
      data: { status: 'ignored' },
    });
  }
}

module.exports = new DiscoveryService();
