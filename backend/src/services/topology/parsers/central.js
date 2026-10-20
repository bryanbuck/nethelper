/**
 * Aruba Central (New Central) site topology: GET
 * /network-monitoring/v1/topology/{site-id}, one call per site. Shapes checked
 * against a live tenant on 2026-10-19 (tests/fixtures/central-live/):
 *
 *   { links: [{ from, to, fromPortList: [{ name, lag }], toPortList, edgeType }],
 *     devices: [{ serial, name, type, status, mac, ipv4, model }] }
 *
 * Each link is listed once, by serial, with both ends' ports. Managed devices
 * are typed Switch / Access Point / Gateway; LLDP neighbors Central doesn't
 * manage are `Unmanaged`, under a made-up serial (`tpd_<mac>`) and often
 * named by their MAC. A gateway's WAN uplinks are links to `Internet` / `LTE`
 * pseudo-devices with no ports; those are skipped. Central computes the links
 * (from LLDP), so the protocol is `cloud`.
 */

const { makeNeighbor } = require('../neighbor');
const { normalizeMac } = require('../../../utils/device-key');

const MANAGED_CAPABILITIES = {
  Switch: ['bridge'],
  'Access Point': ['wlan-ap'],
  Gateway: ['router'],
};

const isMac = (value) => Boolean(normalizeMac(value)) && /[:.-]/.test(String(value));

/** One end's view of a link: its own port, and what is at the far end. */
function neighborOf(localPort, far, farPort) {
  return makeNeighbor({
    localPort,
    chassisId: far.mac || far.name,
    portId: farPort,
    sysName: isMac(far.name) ? null : far.name,
    sysDesc: far.model,
    mgmtIp: far.ipv4,
    capabilities: MANAGED_CAPABILITIES[far.type] || [],
    protocol: 'cloud',
  });
}

const portNames = (list) => (Array.isArray(list) ? list : []).map((p) => p?.name || null);

/**
 * @param {Object[]} replies - topology replies, one per site
 * @returns {Map<string, {neighbors: Object[], identity: {chassisId, sysName}, online: boolean}>} by serial,
 *   for every managed device the topology lists
 */
function parseCentralTopology(replies) {
  const bySerial = new Map();

  for (const reply of replies) {
    const devices = new Map();
    for (const device of reply?.devices || []) {
      if (!device?.serial) continue;
      devices.set(device.serial, device);
      if (MANAGED_CAPABILITIES[device.type] && !bySerial.has(device.serial)) {
        bySerial.set(device.serial, {
          neighbors: [],
          identity: { chassisId: normalizeMac(device.mac), sysName: device.name || null },
          online: device.status === 'ONLINE',
        });
      }
    }

    for (const link of reply?.links || []) {
      const from = devices.get(link?.from);
      const to = devices.get(link?.to);
      if (!from || !to) continue;
      const fromPorts = portNames(link.fromPortList);
      const toPorts = portNames(link.toPortList);
      // Ports pair up by position (a LAG lists its members on both sides).
      const count = Math.max(fromPorts.length, toPorts.length);
      for (let i = 0; i < count; i++) {
        const fromPort = fromPorts[i] ?? fromPorts[0] ?? null;
        const toPort = toPorts[i] ?? toPorts[0] ?? null;
        const add = (serial, neighbor) => {
          const entry = bySerial.get(serial);
          if (entry && neighbor) entry.neighbors.push(neighbor);
        };
        if (fromPort) add(from.serial, neighborOf(fromPort, to, toPort));
        if (toPort) add(to.serial, neighborOf(toPort, from, fromPort));
      }
    }
  }

  return bySerial;
}

module.exports = { parseCentralTopology };
