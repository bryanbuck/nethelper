/**
 * Network Map VLAN overlay: per-device membership parsers (AOS-CX REST,
 * Mist port stats), the edge/VLAN analysis, and the graph enrichment.
 */
const cxFixture = require('../fixtures/aos-cx-vlans.json');
const cxLive = require('../fixtures/aos-cx-live/interfaces-vlans.json');
const mistPorts = require('../fixtures/mist-live/neighbors-stats-ports-search.json');
const mistStats = require('../fixtures/mist-live/stats-devices-allfields-online.json');
const central2930f = require('../fixtures/central-live/switch-2930f.json');
const central6300f = require('../fixtures/central-live/switch-6300f.json');
const { parseCxVlans } = require('../../src/services/topology/parsers/aos-cx-vlans');
const { parseCentralVlans } = require('../../src/services/topology/parsers/central-vlans');
const { parseMistNeighbors } = require('../../src/services/topology/parsers/mist');
const {
  vlanIds, makeVlanSnapshot, portCarries, findPort,
} = require('../../src/services/topology/vlan-membership');
const { analyzeEdge, edgeStatus, analyzeVlans } = require('../../src/services/topology/vlan-analysis');
const { buildGraph } = require('../../src/services/topology/graph');

describe('vlanIds', () => {
  it('reads every reference shape', () => {
    expect(vlanIds(10)).toEqual([10]);
    expect(vlanIds('/rest/v10.10/system/vlans/20')).toEqual([20]);
    expect(vlanIds({ 1: '/rest/v10.10/system/vlans/1', 30: 'x' })).toEqual([1, 30]);
    expect(vlanIds({ id: 99, name: 'mgmt' })).toEqual([99]);
    expect(vlanIds(['/rest/v10.10/system/vlans/10', { id: 30 }])).toEqual([10, 30]);
    expect(vlanIds([0, 4095, 'abc', null])).toEqual([]);
  });
});

describe('parseCxVlans', () => {
  const snap = parseCxVlans(cxFixture);

  it('reads the VLAN table with names', () => {
    expect(snap.vlans).toEqual([
      { id: 1, name: 'DEFAULT_VLAN_1' }, { id: 10, name: 'users' }, { id: 20, name: 'voice' },
      { id: 30, name: 'cameras' }, { id: 99, name: 'mgmt' },
    ]);
  });

  it('maps access, trunk, allowed-all and routed ports', () => {
    expect(snap.ports['1/1/1']).toMatchObject({ mode: 'access', untagged: 10, tagged: [] });
    expect(snap.ports['1/1/49']).toMatchObject({ mode: 'trunk', untagged: 1, tagged: [10, 20], allTagged: false });
    expect(snap.ports['1/1/50']).toMatchObject({ mode: 'trunk', untagged: 1, allTagged: true });
    expect(snap.ports['1/1/52']).toMatchObject({ mode: 'routed', untagged: null });
  });

  it('gives LAG members the LAG membership (native-tagged: nothing untagged)', () => {
    expect(snap.ports['1/1/51']).toMatchObject({ mode: 'trunk', untagged: null, tagged: [10, 30, 99] });
  });

  it('lists SVIs with an address as routed', () => {
    expect(snap.routed).toEqual([{ vlan: 10, ip: '10.0.10.2/24' }]);
  });

  it('expands "allowed all" to the VLANs on the switch only', () => {
    expect(portCarries(snap, snap.ports['1/1/50'], 30)).toBe(true);
    expect(portCarries(snap, snap.ports['1/1/50'], 40)).toBe(false);
  });

  it('returns null for an empty reply', () => {
    expect(parseCxVlans({ interfaces: {}, vlans: {} })).toBeNull();
  });
});

describe('parseCxVlans (live 6300F, FL.10.16)', () => {
  const snap = parseCxVlans(cxLive);

  it('reads access ports whose configured vlan_mode is null from applied_*', () => {
    // `vlan access 110` alone leaves vlan_mode null; applied_vlan_mode says access.
    expect(cxLive.interfaces['1/1/1'].vlan_mode).toBeNull();
    expect(snap.ports['1/1/1']).toMatchObject({ mode: 'access', untagged: 110 });
    // A default-VLAN port has vlan_tag null too.
    expect(snap.ports['1/1/3']).toMatchObject({ mode: 'access', untagged: 1 });
  });

  it('keeps a routed port routed and skips loopbacks, SVIs and the VXLAN interface', () => {
    expect(snap.ports['1/1/24']).toMatchObject({ mode: 'routed' });
    expect(snap.ports.loopback0).toBeUndefined();
    expect(snap.ports.vlan1).toBeUndefined();
    expect(snap.ports.vxlan1).toBeUndefined();
  });

  it('reads the VLAN table', () => {
    expect(snap.vlans.map((v) => v.id)).toEqual([1, 110, 3000]);
  });

  it('falls back to the configured values where applied_* is absent', () => {
    const configuredOnly = parseCxVlans({
      interfaces: { '1/1/9': { name: '1/1/9', vlan_mode: 'access', vlan_tag: { 20: '/rest/v10.10/system/vlans/20' } } },
      vlans: {},
    });
    expect(configuredOnly.ports['1/1/9']).toMatchObject({ mode: 'access', untagged: 20 });
  });
});

describe('Central VLANs (live fixtures)', () => {
  const read = (f) => parseCentralVlans({ interfaces: f.interfaces.items, vlans: f.vlans.items });
  const aosS = read(central2930f);
  const cx = read(central6300f);

  it('maps access, trunk (native + allowed) and routed ports', () => {
    expect(aosS.ports['2']).toMatchObject({ mode: 'access', untagged: 110 });
    expect(aosS.ports['3']).toMatchObject({ mode: 'trunk', untagged: 101, tagged: [110], allTagged: false });
    expect(cx.ports['1/1/24']).toMatchObject({ mode: 'routed' });
  });

  it('reads a trunk without a native VLAN as nothing untagged', () => {
    expect(aosS.ports['8']).toMatchObject({ mode: 'trunk', untagged: null, untaggedKnown: true, tagged: [101] });
  });

  it('takes names from the VLAN list and routed VLANs from addresses that are not down', () => {
    expect(aosS.vlans.find((v) => v.id === 110)).toEqual({ id: 110, name: 'Access Devices' });
    expect(aosS.routed.map((r) => r.vlan)).toEqual([101, 110, 254]);
    expect(cx.routed).toEqual([]);
  });

  it('agrees with the switch own REST read for the same 6300F', () => {
    const local = parseCxVlans(cxLive);
    for (const port of ['1/1/1', '1/1/2', '1/1/3', '1/1/24']) {
      expect(cx.ports[port]).toMatchObject({ mode: local.ports[port].mode, untagged: local.ports[port].untagged });
    }
  });

  it('reads a trunk with no allowed list as allowed-all', () => {
    const snap = parseCentralVlans({ interfaces: [{ name: '1/1/49', vlanMode: 'Trunk', nativeVlan: 1, allowedVlanIds: [] }] });
    expect(snap.ports['1/1/49']).toMatchObject({ mode: 'trunk', allTagged: true });
  });
});

describe('Mist VLANs (live fixtures)', () => {
  const bySerial = parseMistNeighbors({ stats: mistStats, ports: mistPorts.results });

  it('takes port membership from every port row, neighbor or not', () => {
    const sw = bySerial.get('SN000002').vlans;
    expect(sw.ports['mge-0/0/0']).toMatchObject({ mode: 'access', untagged: 1, untaggedKnown: true });
    expect(sw.ports['ge-0/0/4']).toMatchObject({ mode: 'access', untagged: 1 });
    expect(sw.ports.irb).toBeUndefined();
    expect(sw.vlans).toEqual([{ id: 1, name: null }]);
  });

  it('reads irb addresses as routed VLANs', () => {
    expect(bySerial.get('SN000002').vlans.routed).toEqual([{ vlan: 1, ip: '172.16.10.102/24' }]);
  });

  it('has no VLAN data for an AP', () => {
    expect(bySerial.get('SN000001').vlans).toBeNull();
  });

  it('leaves a trunk native VLAN unknown', () => {
    const map = parseMistNeighbors({
      stats: [{ serial: 'S1', mac: 'aa0000000001', status: 'connected' }],
      ports: [{ mac: 'aa0000000001', port_id: 'ge-0/0/47', port_mode: 'trunk', vlan_ids: [1, 10, 20] }],
    });
    expect(map.get('S1').vlans.ports['ge-0/0/47']).toMatchObject({ mode: 'trunk', tagged: [1, 10, 20], untaggedKnown: false });
  });
});

// A small fabric: core routes VLAN 10 and 20; core-sw1 trunk passes 10 only.
const access = (port, untagged) => ({ port, mode: 'access', untagged });
const trunk = (port, untagged, tagged, extra = {}) => ({
  port, mode: 'trunk', untagged, tagged, ...extra,
});
const vl = (...ids) => ids.map((id) => ({ id, name: `v${id}` }));

describe('analyzeEdge / edgeStatus', () => {
  const core = makeVlanSnapshot({
    vlans: vl(1, 10, 20), ports: [trunk('1/1/1', 1, [10]), trunk('1/1/2', 1, [], { allTagged: true })], routed: [{ vlan: 10 }, { vlan: 20 }],
  });
  const sw1 = makeVlanSnapshot({ vlans: vl(1, 10, 20), ports: [trunk('1/1/49', 1, [10, 20])] });
  const sw2 = makeVlanSnapshot({ vlans: vl(10, 30), ports: [trunk('1/1/49', 10, [30])] });
  const snapshots = new Map([['device:core', core], ['device:sw1', sw1], ['device:sw2', sw2]]);
  const edge = (source, sPort, target, tPort) => ({
    source, target, ports: { [source]: { port: sPort }, [target]: { port: tPort } },
  });

  it('flags a VLAN both switches have but one side of the link drops', () => {
    const e = edge('device:core', '1/1/1', 'device:sw1', '1/1/49');
    e.vlans = analyzeEdge(e, snapshots);
    expect(e.vlans.carried).toEqual([1, 10]);
    expect(e.vlans.pruned).toEqual([{ vlan: 20, side: 'device:core' }]);
    expect(e.vlans.native).toBeNull();
    expect(edgeStatus(e, 20, snapshots)).toBe('pruned');
    expect(edgeStatus(e, 10, snapshots)).toBe('carried');
  });

  it('does not call a VLAN pruned when the far switch never had it', () => {
    const e = edge('device:core', '1/1/2', 'device:sw2', '1/1/49');
    e.vlans = analyzeEdge(e, snapshots);
    expect(e.vlans.carried).toEqual([10]);
    expect(e.vlans.pruned).toEqual([]);
    expect(edgeStatus(e, 30, snapshots)).toBe('absent');
    expect(e.vlans.native).toEqual({ 'device:core': 1, 'device:sw2': 10 });
  });

  it('is unknown, never guessed, when the far end has no data', () => {
    const e = edge('device:sw1', '1/1/49', 'ghost:x', 'eth0');
    e.vlans = analyzeEdge(e, snapshots);
    expect(e.vlans.known).toEqual({ 'device:sw1': true, 'ghost:x': false });
    expect(e.vlans.carried).toEqual([]);
    expect(edgeStatus(e, 10, snapshots)).toBe('unknown');
  });

  it('matches port names after normalization', () => {
    const snap = makeVlanSnapshot({ ports: [access('GigabitEthernet1/0/1', 5)] });
    expect(findPort(snap, 'Gi1/0/1')).toMatchObject({ untagged: 5 });
  });
});

describe('analyzeVlans islands', () => {
  const nodes = ['core', 'a', 'b', 'c'].map((id) => ({ id: `device:${id}` }));
  const edge = (s, t) => ({
    source: `device:${s}`, target: `device:${t}`, ports: { [`device:${s}`]: { port: `to-${t}` }, [`device:${t}`]: { port: `to-${s}` } },
  });

  function run(cPorts, extraEdges = []) {
    const snapshots = new Map([
      ['device:core', makeVlanSnapshot({ vlans: vl(20), ports: [trunk('to-a', null, [20])], routed: [{ vlan: 20 }] })],
      ['device:a', makeVlanSnapshot({ vlans: vl(20), ports: [trunk('to-core', null, [20]), trunk('to-b', null, [])] })],
      ['device:b', makeVlanSnapshot({ vlans: vl(20), ports: [trunk('to-a', null, [20]), trunk('to-c', null, [20])] })],
      ['device:c', makeVlanSnapshot({ vlans: vl(20), ports: cPorts })],
    ]);
    const edges = [edge('core', 'a'), edge('a', 'b'), edge('b', 'c'), ...extraEdges];
    for (const e of edges) e.vlans = analyzeEdge(e, snapshots);
    return analyzeVlans(nodes, edges, snapshots).find((v) => v.id === 20);
  }

  it('finds the part of the fabric cut off from the gateway', () => {
    const v20 = run([trunk('to-b', null, [20])]);
    expect(v20.routedOn).toEqual(['device:core']);
    expect(v20.islands).toEqual([['device:b', 'device:c']]);
  });

  it('does not call a group an island when it touches a link we cannot see across', () => {
    const extra = { source: 'device:c', target: 'ghost:x', ports: { 'device:c': { port: 'to-x' }, 'ghost:x': { port: 'p' } } };
    const v20 = run([trunk('to-b', null, [20]), trunk('to-x', null, [20])], [extra]);
    expect(v20.islands).toEqual([]);
  });
});

describe('buildGraph VLAN overlay', () => {
  const devices = [
    { id: 'core', name: 'core', type: 'switch', macAddress: 'aa:00:00:00:00:01' },
    { id: 'sw1', name: 'sw1', type: 'switch', macAddress: 'aa:00:00:00:00:02' },
  ];
  const links = [{
    deviceId: 'core', localPort: '1/1/1', remoteChassisId: 'aa:00:00:00:00:02', remoteMac: 'aa:00:00:00:00:02', remotePortId: '1/1/49', source: 'lldp',
  }];
  const states = [
    {
      deviceId: 'core', status: 'ok', vlanSource: 'AOS-CX REST', vlanCollectedAt: new Date('2026-10-24T00:00:00Z'),
      vlans: makeVlanSnapshot({ vlans: vl(1, 10, 20), ports: [trunk('1/1/1', 1, [10])], routed: [{ vlan: 10, ip: '10.0.10.1/24' }] }),
    },
    { deviceId: 'sw1', status: 'ok', vlans: makeVlanSnapshot({ vlans: vl(1, 10, 20), ports: [trunk('1/1/49', 1, [10, 20])] }) },
  ];

  it('adds edge VLANs, node summaries and the fleet list', () => {
    const graph = buildGraph({ devices, links, states });
    expect(graph.edges[0].vlans).toMatchObject({ carried: [1, 10], pruned: [{ vlan: 20, side: 'device:core' }] });
    const core = graph.nodes.find((n) => n.id === 'device:core');
    expect(core.data.vlans).toMatchObject({ ids: [1, 10, 20], routed: [{ vlan: 10, ip: '10.0.10.1/24' }], source: 'AOS-CX REST' });
    expect(graph.vlans.map((v) => v.id)).toEqual([1, 10, 20]);
    expect(graph.vlans.find((v) => v.id === 10)).toMatchObject({ names: ['v10'], devices: ['device:core', 'device:sw1'], routedOn: ['device:core'] });
  });

  it('has null VLAN data when nothing was collected', () => {
    const graph = buildGraph({ devices, links, states: [] });
    expect(graph.edges[0].vlans).toMatchObject({ carried: [], pruned: [] });
    expect(graph.nodes[0].data.vlans).toBeNull();
    expect(graph.vlans).toEqual([]);
  });
});
