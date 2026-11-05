/**
 * Network Map VXLAN overlay: the AOS-CX parser (live captures of two 6300Fs
 * joined by a static VXLAN), the snapshot, tunnel/VNI analysis, the VLAN
 * island bridging and the graph scoping.
 */
const edge0 = require('../fixtures/aos-cx-live/vxlan-edge0.json');
const edge1 = require('../fixtures/aos-cx-live/vxlan-edge1.json');
const { parseCxVxlan, vxlanInterfaceNames } = require('../../src/services/topology/parsers/aos-cx-vxlan');
const { makeVxlanSnapshot, bareIp } = require('../../src/services/topology/vxlan-membership');
const { makeVlanSnapshot } = require('../../src/services/topology/vlan-membership');
const { analyzeVxlan, TUNNEL_STATUSES } = require('../../src/services/topology/vxlan-analysis');
const { buildGraph } = require('../../src/services/topology/graph');

const snap0 = parseCxVxlan(edge0);
const snap1 = parseCxVxlan(edge1);

/** A VXLAN snapshot for a VTEP at `ip` with the given VNIs (vni -> vlan) and peers. */
const vtep = (ip, vnis, peers = []) => makeVxlanSnapshot({
  vteps: [{ iface: 'vxlan1', sourceIp: ip, admin: 'up' }],
  vnis: Object.entries(vnis).map(([vni, vlan]) => ({ vni: Number(vni), vlan, state: 'operational' })),
  peers: peers.map((p) => ({ iface: 'vxlan1', origin: 'static', state: 'operational', ...p })),
});
const node = (id, ipAddress = null) => ({ id, kind: 'device', data: { ipAddress } });

describe('parseCxVxlan (live 6300F pair)', () => {
  it('reads the VTEP source, the VNI-to-VLAN map and the static peer', () => {
    expect(snap0).toEqual({
      vteps: [{ iface: 'vxlan1', sourceIp: '10.15.20.20', admin: 'up' }],
      vnis: [{
        vni: 110, kind: 'l2', vlan: 110, vrf: null, state: 'operational', up: true,
      }],
      peers: [{
        iface: 'vxlan1', remoteIp: '10.15.20.25', origin: 'static', vrf: 'default', state: 'operational', up: true, vnis: [110],
      }],
    });
    expect(snap1.peers[0].remoteIp).toBe('10.15.20.20');
  });

  it('finds VXLAN interfaces by type', () => {
    expect(vxlanInterfaceNames(edge0.interfaces)).toEqual(['vxlan1']);
    expect(vxlanInterfaceNames({ '1/1/1': { type: 'system' } })).toEqual([]);
  });

  it('reads an L3 VNI, a learned EVPN peer and a peer that is not operational (schema-derived)', () => {
    const snap = parseCxVxlan({
      interfaces: { vxlan1: { name: 'vxlan1', type: 'vxlan', options: { local_ip: '10.0.0.1' } } },
      vnis: {
        'vxlan_vni,10000': { id: 10000, type: 'vxlan_vni', vrf: { tenant: '/rest/v10.10/system/vrfs/tenant' }, state: 'operational' },
      },
      tunnelEndpoints: {
        vxlan1: {
          'default,evpn,10.0.0.2': { destination: '10.0.0.2', origin: 'evpn', state: 'down', network_id: { 'vxlan_vni,10000': 'x' } },
        },
      },
    });
    expect(snap.vnis[0]).toMatchObject({ vni: 10000, kind: 'l3', vrf: 'tenant', vlan: null });
    expect(snap.peers[0]).toMatchObject({ origin: 'evpn', up: false, vnis: [10000] });
  });

  it('returns null for a switch without VXLAN', () => {
    expect(parseCxVxlan({ interfaces: {}, vnis: {}, tunnelEndpoints: {} })).toBeNull();
  });
});

describe('makeVxlanSnapshot', () => {
  it('strips prefix lengths and drops bad VNIs and duplicate peers', () => {
    expect(bareIp('10.1.1.1/32')).toBe('10.1.1.1');
    expect(bareIp('fe80::1')).toBeNull();
    const snap = makeVxlanSnapshot({
      vteps: [{ iface: 'vxlan1', sourceIp: '10.1.1.1/32' }],
      vnis: [{ vni: 0 }, { vni: 20 }, { vni: 20 }],
      peers: [{ iface: 'vxlan1', remoteIp: '10.1.1.2' }, { iface: 'vxlan1', remoteIp: '10.1.1.2' }],
    });
    expect(snap.vteps[0].sourceIp).toBe('10.1.1.1');
    expect(snap.vnis.map((v) => v.vni)).toEqual([20]);
    expect(snap.peers).toHaveLength(1);
    expect(snap.peers[0].up).toBeNull(); // no state reported: unknown, not down
  });
});

describe('analyzeVxlan', () => {
  it('pairs the live VTEPs by source address into one carried tunnel', () => {
    const result = analyzeVxlan(
      { nodes: [node('device:e0', '172.16.1.99'), node('device:e1', '172.22.1.99')] },
      new Map([['device:e0', snap0], ['device:e1', snap1]])
    );
    expect(result.tunnels).toHaveLength(1);
    expect(result.tunnels[0]).toMatchObject({ status: 'carried', vnis: [110], vniStatus: { 110: 'carried' } });
    expect(result.vnis[0]).toMatchObject({
      vni: 110, isolated: [], unresolved: [], vlanDiffers: false,
    });
    expect(result.bridges).toEqual([{ a: 'device:e0', b: 'device:e1', vlan: 110 }]);
  });

  it('flags a VNI one end floods and the other does not', () => {
    const a = vtep('10.0.0.1', { 110: 110, 120: 120 }, [{ remoteIp: '10.0.0.2', vnis: [110, 120] }]);
    const b = vtep('10.0.0.2', { 110: 110 }, [{ remoteIp: '10.0.0.1', vnis: [110] }]);
    const { tunnels } = analyzeVxlan({ nodes: [] }, new Map([['device:a', a], ['device:b', b]]));
    expect(tunnels[0].vniStatus).toEqual({ 110: 'carried', 120: 'one-sided' });
    expect(tunnels[0].status).toBe('one-sided');
  });

  it('marks a tunnel down when an end reports its peer not operational', () => {
    const a = vtep('10.0.0.1', { 110: 110 }, [{ remoteIp: '10.0.0.2', vnis: [110], state: 'down' }]);
    const b = vtep('10.0.0.2', { 110: 110 }, [{ remoteIp: '10.0.0.1', vnis: [110] }]);
    const { tunnels, bridges } = analyzeVxlan({ nodes: [] }, new Map([['device:a', a], ['device:b', b]]));
    expect(tunnels[0].status).toBe('down');
    expect(bridges).toEqual([]);
  });

  it('leaves the far end unknown (never one-sided) when it was not read, and keeps its path open', () => {
    const a = vtep('10.0.0.1', { 110: 110 }, [{ remoteIp: '172.16.0.9', vnis: [110] }]);
    const result = analyzeVxlan({ nodes: [node('device:far', '172.16.0.9')] }, new Map([['device:a', a]]));
    expect(result.tunnels[0]).toMatchObject({ target: 'device:far', status: 'unknown' });
    expect(result.open).toEqual([{ node: 'device:a', vlan: 110 }]);
  });

  it('lists a peer no device matches as unresolved, and a VTEP with no peer for a VNI as isolated', () => {
    const a = vtep('10.0.0.1', { 110: 110, 300: 300 }, [{ remoteIp: '10.9.9.9', vnis: [110] }]);
    const result = analyzeVxlan({ nodes: [] }, new Map([['device:a', a]]));
    expect(result.unresolved).toEqual([{
      node: 'device:a', remoteIp: '10.9.9.9', origin: 'static', up: true, vnis: [110],
    }]);
    expect(result.vnis.find((v) => v.vni === 110)).toMatchObject({ isolated: [], unresolved: [{ node: 'device:a', remoteIp: '10.9.9.9' }] });
    expect(result.vnis.find((v) => v.vni === 300).isolated).toEqual(['device:a']);
  });

  it('notes an L2 VNI mapped to different VLANs, and bridges nothing across it', () => {
    const a = vtep('10.0.0.1', { 5000: 10 }, [{ remoteIp: '10.0.0.2', vnis: [5000] }]);
    const b = vtep('10.0.0.2', { 5000: 20 }, [{ remoteIp: '10.0.0.1', vnis: [5000] }]);
    const result = analyzeVxlan({ nodes: [] }, new Map([['device:a', a], ['device:b', b]]));
    expect(result.vnis[0].vlanDiffers).toBe(true);
    expect(result.bridges).toEqual([]);
  });

  it('matches nothing on an address two VTEPs claim', () => {
    const a = vtep('10.0.0.1', { 1: 1 }, [{ remoteIp: '10.0.0.5', vnis: [1] }]);
    const b = vtep('10.0.0.5', { 1: 1 });
    const c = vtep('10.0.0.5', { 1: 1 });
    const result = analyzeVxlan({ nodes: [] }, new Map([['device:a', a], ['device:b', b], ['device:c', c]]));
    expect(result.tunnels).toEqual([]);
    expect(result.unresolved).toHaveLength(1);
  });

  it('only uses known statuses', () => {
    expect(TUNNEL_STATUSES).toEqual(['carried', 'one-sided', 'down', 'unknown']);
  });
});

describe('buildGraph VXLAN overlay', () => {
  const vlans110 = (routed) => makeVlanSnapshot({
    vlans: [{ id: 110, name: 'v110' }],
    ports: [{ port: '1/1/1', mode: 'access', untagged: 110 }],
    routed: routed ? [{ vlan: 110, ip: '10.110.0.1/24' }] : [],
  });
  const devices = [
    {
      id: 'e0', name: 'Lab-Edge0', type: 'switch', ipAddress: '172.16.1.99', location: 'Main',
    },
    {
      id: 'e1', name: 'Lab-Edge1', type: 'switch', ipAddress: '172.22.1.99', location: 'Remote',
    },
    {
      id: 'e2', name: 'Lab-Edge2', type: 'switch', ipAddress: '172.16.1.98', location: 'Remote',
    },
  ];

  it('joins a VLAN extended over a carried tunnel, so it is no island', () => {
    // e0 routes VLAN 110; e1 carries it with no cable to e0, only the tunnel.
    const states = [
      { deviceId: 'e0', vlans: vlans110(true), vxlan: snap0 },
      { deviceId: 'e1', vlans: vlans110(false), vxlan: snap1 },
      { deviceId: 'e2', vlans: vlans110(false) },
    ];
    const graph = buildGraph({ devices, links: [], states });
    const v110 = graph.vlans.find((v) => v.id === 110);
    expect(v110.vnis).toEqual([110]);
    // e2 has VLAN 110 with no path: the only island.
    expect(v110.islands).toEqual([['device:e2']]);
    expect(graph.vxlan.tunnels).toHaveLength(1);
  });

  it('without the tunnel, the far VTEP is an island too', () => {
    const states = [
      { deviceId: 'e0', vlans: vlans110(true) },
      { deviceId: 'e1', vlans: vlans110(false) },
    ];
    const graph = buildGraph({ devices: devices.slice(0, 2), links: [], states });
    expect(graph.vlans.find((v) => v.id === 110).islands).toEqual([['device:e1']]);
    expect(graph.vxlan).toEqual({ tunnels: [], vnis: [], unresolved: [] });
  });

  it('brings another site\'s VTEP in as a tunnel-only node and names it', () => {
    const states = [{ deviceId: 'e0', vxlan: snap0 }, { deviceId: 'e1', vxlan: snap1 }];
    const graph = buildGraph({
      devices, links: [], states, site: 'Main',
    });
    const far = graph.nodes.find((n) => n.id === 'device:e1');
    expect(far.data).toMatchObject({ outOfScope: true, tunnelOnly: true, name: 'Lab-Edge1' });
    expect(graph.vxlan.tunnels[0]).toMatchObject({ status: 'carried' });
    expect(graph.nodes.find((n) => n.id === 'device:e0').data.vxlan).toMatchObject({
      sourceIps: ['10.15.20.20'], peerCount: 1, vnis: [{ vni: 110, vlan: 110 }],
    });
  });

  it('leaves out tunnels between two devices of other sites', () => {
    const states = [{ deviceId: 'e0', vxlan: snap0 }, { deviceId: 'e1', vxlan: snap1 }];
    const graph = buildGraph({
      devices, links: [], states, site: 'Elsewhere',
    });
    expect(graph.vxlan.tunnels).toEqual([]);
    expect(graph.nodes.some((n) => n.data.tunnelOnly)).toBe(false);
  });
});
