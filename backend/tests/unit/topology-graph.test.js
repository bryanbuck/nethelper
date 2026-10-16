const { reconcileLinks } = require('../../src/services/topology/link-diff');
const { buildGraph, guessType } = require('../../src/services/topology/graph');
const { resolveTransport } = require('../../src/utils/transport-router');

const neighbor = (localPort, chassisId, portId, extra = {}) => ({
  localPort, chassisId, portId, sysName: null, mac: null, capabilities: [], protocol: 'lldp', ...extra,
});
const row = (id, localPort, chassisId, portId, extra = {}) => ({
  id, localPort, remoteChassisId: chassisId, remotePortId: portId, remoteSysName: null, active: true, ...extra,
});

describe('reconcileLinks', () => {
  const now = new Date('2026-10-16T12:00:00Z');

  test('first collection creates links and records no changes', () => {
    const out = reconcileLinks([], [neighbor('1/1/1', 'aa', '1'), neighbor('1/1/2', 'bb', '2')], { now, initial: true });
    expect(out.creates).toHaveLength(2);
    expect(out.creates[0]).toMatchObject({ localPort: '1/1/1', remoteChassisId: 'aa', active: true, lastSeen: now });
    expect(out.changes).toEqual([]);
  });

  test('a new neighbor is link.added, a missing one link.removed and deactivated', () => {
    const existing = [row('r1', '1/1/1', 'aa', '1')];
    const out = reconcileLinks(existing, [neighbor('1/1/2', 'bb', '2')], { now });
    expect(out.creates).toHaveLength(1);
    expect(out.updates).toEqual([{ id: 'r1', data: { active: false } }]);
    expect(out.changes.map((c) => c.type).sort()).toEqual(['link.added', 'link.removed']);
  });

  test('a different neighbor on the same port is one link.changed', () => {
    const existing = [row('r1', '1/1/1', 'aa', '1', { remoteSysName: 'old' })];
    const out = reconcileLinks(existing, [neighbor('1/1/1', 'bb', '7', { sysName: 'new' })], { now });
    expect(out.changes).toEqual([{
      type: 'link.changed',
      localPort: '1/1/1',
      data: {
        before: expect.objectContaining({ chassisId: 'aa', sysName: 'old' }),
        after: expect.objectContaining({ chassisId: 'bb', portId: '7', sysName: 'new' }),
      },
    }]);
  });

  test('a renamed neighbor is link.changed; an unchanged one only refreshes', () => {
    const existing = [row('r1', '1/1/1', 'aa', '1', { remoteSysName: 'sw-a' }), row('r2', '1/1/2', 'bb', '2')];
    const out = reconcileLinks(existing, [
      neighbor('1/1/1', 'aa', '1', { sysName: 'sw-a-renamed' }),
      neighbor('1/1/2', 'bb', '2'),
    ], { now });
    expect(out.creates).toEqual([]);
    expect(out.updates).toHaveLength(2);
    expect(out.updates.every((u) => u.data.active === true && u.data.lastSeen === now)).toBe(true);
    expect(out.changes).toHaveLength(1);
    expect(out.changes[0]).toMatchObject({ type: 'link.changed', localPort: '1/1/1' });
  });

  test('an inactive link seen again is reactivated as link.added', () => {
    const existing = [row('r1', '1/1/1', 'aa', '1', { active: false })];
    const out = reconcileLinks(existing, [neighbor('1/1/1', 'aa', '1')], { now });
    expect(out.creates).toEqual([]);
    expect(out.updates[0]).toMatchObject({ id: 'r1', data: { active: true } });
    expect(out.changes.map((c) => c.type)).toEqual(['link.added']);
  });

  test('duplicate neighbors in one table count once', () => {
    const out = reconcileLinks([], [neighbor('1/1/1', 'aa', '1'), neighbor('1/1/1', 'aa', '1')], { now });
    expect(out.creates).toHaveLength(1);
  });
});

describe('guessType', () => {
  test.each([
    [['bridge', 'router'], 'switch'],
    [['router'], 'gateway'],
    [['bridge', 'wlan-ap'], 'access_point'],
    [['bridge', 'telephone'], 'phone'],
    [['station'], 'host'],
    [[], 'unknown'],
  ])('%j → %s', (caps, type) => expect(guessType(caps)).toBe(type));
});

describe('buildGraph', () => {
  const studio = {
    id: 'd-studio', name: 'Sw-Studio', type: 'switch', vendor: 'aruba', platform: 'aos-cx',
    ipAddress: '192.168.0.14', macAddress: null, location: 'HQ', pingStatus: 'online',
  };
  const core = {
    id: 'd-core', name: 'Sw-CoreB', type: 'switch', vendor: 'aruba', platform: 'aos-cx',
    ipAddress: '192.168.255.2', macAddress: null, location: 'DC',
  };
  const gw = {
    id: 'd-gw', name: 'gw1', type: 'gateway', vendor: 'aruba', ipAddress: '192.168.255.1', location: 'DC',
  };
  const states = [
    { deviceId: 'd-studio', status: 'ok', chassisId: 'ec:67:94:d1:a8:00', sysName: 'Sw-Studio' },
    { deviceId: 'd-core', status: 'ok', chassisId: '14:ab:ec:c2:0e:00', sysName: 'Sw-CoreB' },
  ];
  const link = (deviceId, localPort, chassis, port, extra = {}) => ({
    deviceId,
    localPort,
    remoteChassisId: chassis,
    remotePortId: port,
    remoteMac: /^[0-9a-f:]{17}$/.test(chassis) ? chassis : null,
    remoteCapabilities: [],
    source: 'lldp',
    ...extra,
  });
  const links = [
    // Studio 1/1/13 ↔ CoreB 1/1/6, reported from both ends
    link('d-studio', '1/1/13', '14:ab:ec:c2:0e:00', '1/1/6', { remoteSysName: 'Sw-CoreB' }),
    link('d-core', '1/1/6', 'ec:67:94:d1:a8:00', '1/1/13', { remoteSysName: 'Sw-Studio' }),
    // The phone on Studio 1/1/4: no Device; matches a discovery host by MAC
    link('d-studio', '1/1/4', '192.168.18.140', '042AE270CB4E:P1', {
      remoteMac: '04:2a:e2:70:cb:4e', remoteSysName: 'SEP042AE270CB4E', remoteCapabilities: ['bridge', 'telephone'],
    }),
    // CoreB uplink to the gateway, matched by management IP only
    link('d-core', '1/1/1', 'gw-chassis', 'eth0', { remoteMgmtIp: '192.168.255.1', remoteCapabilities: ['router'] }),
  ];
  const discovered = [
    { id: 'h-phone', ipAddress: '192.168.18.140', macAddress: '04:2a:e2:70:cb:4e', subnet: '192.168.18.0/24' },
    { id: 'h-printer', ipAddress: '192.168.18.50', macAddress: '00:00:5e:00:53:01', subnet: '192.168.18.0/24' },
    { id: 'h-other', ipAddress: '10.9.9.9', macAddress: null, subnet: null },
  ];
  const input = {
    devices: [studio, core, gw], links, states, discovered,
  };

  test('a link reported from both ends is one bidirectional edge', () => {
    const graph = buildGraph(input);
    const between = graph.edges.filter((e) => [e.source, e.target].sort().join() === 'device:d-core,device:d-studio');
    expect(between).toHaveLength(1);
    expect(between[0].bidirectional).toBe(true);
    const ports = { [between[0].source]: between[0].sourcePort, [between[0].target]: between[0].targetPort };
    expect(ports).toEqual({ 'device:d-studio': '1/1/13', 'device:d-core': '1/1/6' });
  });

  test('a neighbor with no Device is a ghost carrying its discovery host', () => {
    const graph = buildGraph(input);
    const ghost = graph.nodes.find((n) => n.kind === 'ghost');
    expect(ghost.id).toBe('ghost:04:2a:e2:70:cb:4e');
    expect(ghost.data).toMatchObject({ guessedType: 'phone', discovered: { id: 'h-phone' } });
  });

  test('far ends resolve by management IP when the chassis id is unknown', () => {
    const graph = buildGraph(input);
    expect(graph.edges.some((e) => [e.source, e.target].includes('device:d-gw'))).toBe(true);
    expect(graph.nodes.filter((n) => n.kind === 'ghost')).toHaveLength(1);
  });

  test('edges point downstream: gateway → switch, switch → phone', () => {
    const graph = buildGraph(input);
    const gwEdge = graph.edges.find((e) => e.source === 'device:d-gw' || e.target === 'device:d-gw');
    expect(gwEdge.source).toBe('device:d-gw');
    expect(gwEdge).toMatchObject({ sourcePort: 'eth0', targetPort: '1/1/1' });
    const phoneEdge = graph.edges.find((e) => e.target.startsWith('ghost:'));
    expect(phoneEdge.source).toBe('device:d-studio');
  });

  test('a site scope keeps linked devices from other sites, marked out of scope', () => {
    const graph = buildGraph({ ...input, site: 'HQ' });
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['device:d-core', 'device:d-studio', 'ghost:04:2a:e2:70:cb:4e']);
    expect(graph.nodes.find((n) => n.id === 'device:d-core').data.outOfScope).toBe(true);
    expect(graph.stats.devices).toBe(1);
    expect(graph.sites).toEqual(['DC', 'HQ']);
  });

  test('discovery hosts not on the map group by subnet', () => {
    const graph = buildGraph({ ...input, includeDiscovered: true });
    const subnets = graph.nodes.filter((n) => n.kind === 'subnet');
    expect(subnets.map((n) => [n.id, n.data.count]).sort()).toEqual([
      ['subnet:192.168.18.0/24', 1], // the phone is already a ghost
      ['subnet:unknown', 1],
    ]);
  });

  test('ambiguous names never resolve', () => {
    const twin = { ...core, id: 'd-twin', name: 'sw-dup', ipAddress: null };
    const twin2 = { ...core, id: 'd-twin2', name: 'sw-dup', ipAddress: null };
    const graph = buildGraph({
      devices: [studio, twin, twin2],
      links: [link('d-studio', '1/1/9', 'unknown-chassis', 'x', { remoteSysName: 'sw-dup' })],
    });
    expect(graph.nodes.some((n) => n.kind === 'ghost')).toBe(true);
  });

  test('stats', () => {
    const graph = buildGraph(input);
    expect(graph.stats).toMatchObject({ devices: 3, links: 3, ghosts: 1, collected: 2, neverCollected: 1 });
  });
});

describe('resolveTransport topology', () => {
  const cx = { vendor: 'aruba', platform: 'aos-cx', type: 'switch', ipAddress: '10.0.0.2' };

  test('direct devices use their matrix row', () => {
    expect(resolveTransport({ ...cx, managementMode: 'direct' }, 'topology')).toEqual(['device-rest']);
    expect(resolveTransport({ vendor: 'aruba', platform: 'aos-s', type: 'switch' }, 'topology')).toEqual(['ssh']);
    expect(resolveTransport({ vendor: 'juniper', platform: 'junos', type: 'switch' }, 'topology'))
      .toEqual(['device-rest', 'ssh']);
    expect(resolveTransport({ vendor: 'cisco', platform: 'ios-xe', type: 'switch' }, 'topology')).toEqual(['ssh']);
  });

  test('cloud-managed: local REST first when reachable, then the cloud plane, never SSH', () => {
    expect(resolveTransport({ ...cx, managementMode: 'cloud' }, 'topology')).toEqual(['device-rest', 'cloud']);
    expect(resolveTransport({ ...cx, managementMode: 'cloud', ipAddress: null }, 'topology')).toEqual(['cloud']);
    expect(resolveTransport({ vendor: 'juniper', type: 'access_point', managementMode: 'cloud' }, 'topology'))
      .toEqual(['cloud']);
    expect(resolveTransport({
      vendor: 'aruba', platform: 'aos-s', type: 'switch', managementMode: 'cloud', ipAddress: '10.0.0.3',
    }, 'topology')).toEqual(['cloud']);
  });

  test('unclassified devices get no transport', () => {
    expect(resolveTransport({ type: 'switch', vendor: 'other' }, 'topology')).toEqual([]);
    expect(resolveTransport({ type: 'access_point', vendor: 'other' }, 'topology')).toEqual([]);
  });
});
