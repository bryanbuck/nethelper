/**
 * Port Identity: client-table parsers (live AOS-CX, Central and Mist captures,
 * 2026-11-10), the per-switch merge and the collector service.
 */
const swCoreaMacs = require('../fixtures/aos-cx-live/port-clients/sw-corea-macs.json');
const swCoreaArp = require('../fixtures/aos-cx-live/port-clients/sw-corea-arp.json');
const swCoreaIfaces = require('../fixtures/aos-cx-live/port-clients/sw-corea-interfaces.json');
const swStudioMacs = require('../fixtures/aos-cx-live/port-clients/sw-studio-macs.json');
const swStudioArp = require('../fixtures/aos-cx-live/port-clients/sw-studio-arp.json');
const swStudioIfaces = require('../fixtures/aos-cx-live/port-clients/sw-studio-interfaces.json');
const edge1Macs = require('../fixtures/aos-cx-live/port-clients/lab-edge1-macs.json');
const edge1Ifaces = require('../fixtures/aos-cx-live/port-clients/lab-edge1-interfaces.json');
const centralClients = require('../fixtures/central-live/clients.json');
const mistWired = require('../fixtures/mist-live/wired-clients-search.json');

const {
  parseCxInterfaces, parseCxMacTable, parseCxArp, refName,
} = require('../../src/services/ports/parsers/aos-cx-clients');
const {
  parseCentralWiredClients, parseMistWiredClients, cleanName, isRandomMac,
} = require('../../src/services/ports/parsers/cloud-clients');
const {
  classifyPorts, presenceObservations, enrich, linkStates,
} = require('../../src/services/ports/client-merge');
const { normalizeObservations, summarizePorts } = require('../../src/services/ports/client-aging');

const NOW = new Date('2026-11-10T01:30:00Z');
const byPort = (obs) => obs.reduce((m, o) => ({ ...m, [o.port]: (m[o.port] || 0) + 1 }), {});

describe('AOS-CX client tables', () => {
  const coreIfaces = parseCxInterfaces(swCoreaIfaces);
  const core = parseCxMacTable(swCoreaMacs, coreIfaces);
  const studioIfaces = parseCxInterfaces(swStudioIfaces);
  const studio = parseCxMacTable(swStudioMacs, studioIfaces);

  it('reads references in both shapes', () => {
    expect(refName({ '1/1/13': '/rest/v10.10/system/interfaces/1%2F1%2F13' })).toBe('1/1/13');
    expect(refName('/rest/v10.10/system/interfaces/1%2F1%2F13')).toBe('1/1/13');
    expect(refName(null)).toBeNull();
  });

  it('reads port type, link, untagged VLAN and LAG members', () => {
    expect(coreIfaces.ports.get('lag3')).toMatchObject({ type: 'lag' });
    expect(coreIfaces.lagOf.get('1/1/15')).toBe('lag3');
    expect(coreIfaces.ports.get('vlan10')).toMatchObject({ type: 'vlan' });
    expect(studioIfaces.ports.get('1/1/4')).toMatchObject({ type: 'system', linkUp: true, native: 20 });
  });

  it('keeps one observation per port and MAC, though a MAC is listed once per VLAN', () => {
    const entries = Object.values(swStudioMacs).reduce((n, v) => n + Object.keys(v).length, 0);
    expect(entries).toBe(73);
    expect(studio.observations).toHaveLength(59);
    expect(byPort(studio.observations)).toEqual({ '1/1/13': 56, '1/1/4': 2, '1/1/1': 1 });
  });

  it('reads a phone and the PC behind it, preferring the port untagged VLAN', () => {
    const phonePort = studio.observations.filter((o) => o.port === '1/1/4').map((o) => o.vlan).sort();
    expect(phonePort).toEqual([18, 20]);
  });

  it('stores a LAG as its own port and flags infrastructure ports', () => {
    expect(byPort(core.observations).lag3).toBe(1);
    expect([...core.infraPorts].sort()).toEqual(['1/1/11', '1/1/14', '1/1/2', '1/1/20', '1/1/21', '1/1/22', '1/1/26', '1/1/27']);
    expect(core.infraPorts.has('1/1/13')).toBe(false); // the phone port
  });

  it('skips MACs learned on a tunnel port (VXLAN)', () => {
    const edge1 = parseCxMacTable(edge1Macs, parseCxInterfaces(edge1Ifaces));
    expect(edge1.observations).toEqual([]);
    expect(edge1.skipped).toBe(1);
  });

  it('reads IPv4 ARP with the physical port behind the VLAN interface', () => {
    const arp = parseCxArp(swCoreaArp);
    expect(arp).toHaveLength(65);
    expect(arp.every((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a.ip) && a.mac)).toBe(true);
    expect(parseCxArp(swStudioArp).every((a) => a.port === '1/1/13')).toBe(true);
  });
});

describe('cloud client parsers', () => {
  const central = parseCentralWiredClients(centralClients.items, NOW);

  it('Central: wired clients only, keyed to the switch serial, with Central profiling', () => {
    expect(central).toHaveLength(61);
    expect(central.filter((o) => o.present)).toHaveLength(41);
    const iLo = central.find((o) => o.profile?.os === 'HP iLO');
    expect(iLo).toMatchObject({
      switch: { serial: expect.stringMatching(/^SN/) }, sources: ['cloud-wired'], present: true, seenAt: NOW,
      profile: { category: 'Network Infrastructure', function: 'Remote Management', source: 'Aruba Central' },
    });
  });

  it('Central: a disconnected client keeps its last-seen time and is not present', () => {
    const gone = central.find((o) => !o.present);
    expect(gone.seenAt).toBeInstanceOf(Date);
    expect(gone.seenAt.getTime()).toBeLessThan(NOW.getTime());
    expect(gone.firstSeen).toBeNull();
  });

  it('Mist: one observation per switch port, timed by the cloud own last-seen', () => {
    const [o] = parseMistWiredClients(mistWired.results, new Date('2026-11-10T00:00:00Z'));
    expect(o).toMatchObject({
      switch: { mac: expect.any(String) }, port: 'ge-0/0/11', vlan: 1, hostname: 'Lab-Core',
      sources: ['cloud-wired', 'lldp'], present: false,
    });
    expect(o.seenAt.toISOString()).toBe('2026-11-03T12:59:49.415Z');
    expect(o.firstSeen.toISOString()).toBe('2026-10-07T15:45:37.663Z');
    const [recent] = parseMistWiredClients(mistWired.results, new Date('2026-11-01T00:00:00Z'));
    expect(recent.present).toBe(true);
  });

  it('cleans NUL padding and MAC-only hostnames; spots random MACs', () => {
    expect(cleanName('Watch\u0000\u0000\u0000')).toBe('Watch');
    expect(cleanName('aa:bb:cc:dd:ee:ff')).toBeNull();
    expect(cleanName('  ')).toBeNull();
    expect(isRandomMac('da:a1:19:00:00:01')).toBe(true);
    expect(isRandomMac('00:1f:9e:00:00:01')).toBe(false);
  });
});

describe('per-switch merge', () => {
  const studioIfaces = parseCxInterfaces(swStudioIfaces);
  const studio = parseCxMacTable(swStudioMacs, studioIfaces);
  const phoneMac = studio.observations.find((o) => o.port === '1/1/4' && o.vlan === 18).mac;
  const links = [
    { localPort: '1/1/13', remoteMac: 'aa:aa:aa:00:00:01', remoteCapabilities: ['bridge', 'router'], remoteSysName: 'Sw-CoreA' },
    { localPort: '1/1/4', remoteMac: phoneMac, remoteCapabilities: ['bridge', 'telephone'], remoteSysName: 'SEP-phone' },
  ];

  it('classifies uplinks, AP ports and edge ports (a phone is an edge port)', () => {
    const inventoryByMac = new Map([['bb:bb:bb:00:00:02', { id: 'ap1', type: 'access_point' }]]);
    const { uplinkPorts, apPorts, lldp } = classifyPorts({
      links: [...links, { localPort: '1/1/20', remoteMac: 'cc:cc:cc:00:00:03', remoteCapabilities: ['wlan-ap'] }],
      infraPorts: new Set(['1/1/20', '1/1/27']),
      observations: [{ port: '1/1/9', mac: 'bb:bb:bb:00:00:02' }],
      inventoryByMac,
    });
    expect([...uplinkPorts].sort()).toEqual(['1/1/13', '1/1/27']);
    expect(apPorts.get('1/1/20')).toBe('cc:cc:cc:00:00:03');
    expect(apPorts.get('1/1/9')).toBe('bb:bb:bb:00:00:02');
    expect(lldp.get(`1/1/4|${phoneMac}`)).toMatchObject({ sysName: 'SEP-phone', capabilities: ['bridge', 'telephone'] });
  });

  it('keeps only the phone port clients of Sw-Studio once its uplink is known', () => {
    const { uplinkPorts, apPorts, lldp } = classifyPorts({ links, observations: studio.observations });
    const observed = normalizeObservations(enrich(studio.observations, { lldp }));
    const { clients, summary } = summarizePorts(observed, { uplinkPorts, apPorts, linkUp: linkStates(studioIfaces) });
    expect(byPort(clients)).toEqual({ '1/1/4': 2, '1/1/1': 1 });
    expect(summary['1/1/13']).toMatchObject({ uplink: true, macCount: 56 });
    expect(clients.find((c) => c.mac === phoneMac)).toMatchObject({ lldp: { sysName: 'SEP-phone' }, sources: ['lldp', 'mac-table'] });
  });

  it('presence comes from the switch table; the cloud adds identity, and its first-seen only for the same port', () => {
    const direct = { observations: [{ port: '1/1/4', mac: 'aa:00:00:00:00:01', vlan: 20, sources: ['mac-table'] }] };
    const cloud = [
      { port: '1/1/9', mac: 'aa:00:00:00:00:01', hostname: 'old', seenAt: new Date('2026-11-01'), sources: ['cloud-wired'] },
      {
        port: '1/1/4', mac: 'aa:00:00:00:00:01', hostname: 'desk-pc', username: 'user-1', profile: { os: 'Windows' },
        present: false, seenAt: new Date('2026-11-09'), firstSeen: new Date('2026-10-01'), sources: ['cloud-wired'],
      },
      { port: '1/1/5', mac: 'aa:00:00:00:00:02', present: true, sources: ['cloud-wired'] },
    ];
    const out = presenceObservations({ direct, cloud });
    expect(out).toHaveLength(1); // a client only the cloud lists doesn't count when the switch was read
    expect(out[0]).toMatchObject({
      hostname: 'desk-pc', username: 'user-1', profile: { os: 'Windows' }, firstSeen: new Date('2026-10-01'),
      sources: ['mac-table', 'cloud-wired'],
    });
  });

  it('without a switch read, the cloud present clients count', () => {
    const cloud = [
      { port: '2', mac: 'aa:00:00:00:00:01', present: true, sources: ['cloud-wired'] },
      { port: '3', mac: 'aa:00:00:00:00:02', present: false, sources: ['cloud-wired'] },
    ];
    expect(presenceObservations({ cloud }).map((o) => o.port)).toEqual(['2']);
  });

  it('prefers the registered vendor over a cloud manufacturer, which only fills an unknown prefix', () => {
    const out = enrich([
      { port: '1/1/1', mac: '00:1f:9e:00:00:01', vendor: 'Cisco Systems, Inc', sources: ['cloud-wired'] },
      { port: '1/1/2', mac: '00:1f:9e:00:00:02', vendor: 'Amcrest Technologies', sources: ['cloud-wired'] },
    ], { vendorOf: (mac) => (mac.endsWith('01') ? 'Cisco' : null) });
    expect(out[0].vendor).toBe('Cisco');
    expect(out[1].vendor).toBe('Amcrest Technologies');
  });

  it('enriches IP from fleet-wide ARP and vendor from the OUI, never for a random MAC', () => {
    const out = enrich([
      { port: '1/1/4', mac: '00:1f:9e:00:00:01', sources: ['mac-table'] },
      { port: '1/1/5', mac: 'da:a1:19:00:00:01', sources: ['mac-table'] },
    ], { arpByMac: new Map([['00:1f:9e:00:00:01', '10.0.0.5']]), vendorOf: () => 'Cisco' });
    expect(out[0]).toMatchObject({ ip: '10.0.0.5', vendor: 'Cisco', sources: ['arp', 'mac-table'] });
    expect(out[1]).toMatchObject({ vendor: null, profile: { randomMac: true } });
  });
});
