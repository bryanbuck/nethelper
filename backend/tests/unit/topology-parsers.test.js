const fs = require('fs');
const path = require('path');
const { normalizeMac } = require('../../src/utils/mac');
const { normalizeCapabilities, normalizePortName } = require('../../src/services/topology/neighbor');
const cx = require('../../src/services/topology/parsers/aos-cx');
const junos = require('../../src/services/topology/parsers/junos');
const aosS = require('../../src/services/topology/parsers/aos-s');
const ios = require('../../src/services/topology/parsers/ios');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../fixtures/aos-cx-live/lldp-neighbors.json'), 'utf8')
);

describe('normalizeMac', () => {
  test.each([
    ['14:ab:ec:c2:0e:00', '14:ab:ec:c2:0e:00'],
    ['14-AB-EC-C2-0E-00', '14:ab:ec:c2:0e:00'],
    ['0011.2233.4455', '00:11:22:33:44:55'],
    ['001a1e-000000', '00:1a:1e:00:00:00'],
    ['00 1a 1e 00 00 00', '00:1a:1e:00:00:00'],
  ])('%s', (input, expected) => {
    expect(normalizeMac(input)).toBe(expected);
  });

  test('IP addresses and names are not MACs, even with 12 digits', () => {
    expect(normalizeMac('192.168.18.140')).toBeNull();
    expect(normalizeMac('10.100.200.250')).toBeNull();
    expect(normalizeMac('sw2.example.com')).toBeNull();
    expect(normalizeMac(null)).toBeNull();
  });
});

describe('normalizeCapabilities', () => {
  test.each([
    ['Bridge, Router', ['bridge', 'router']],
    ['bridge, router', ['bridge', 'router']],
    ['B,R', ['bridge', 'router']],
    ['B,T', ['bridge', 'telephone']],
    ['Router Switch IGMP', ['bridge', 'router']],
    ['Host Phone Port-Mirror', ['station', 'telephone']],
    ['WLAN Access Point', ['wlan-ap']],
    [['bridge', 'wlan-ap'], ['bridge', 'wlan-ap']],
    ['', []],
  ])('%j', (input, expected) => {
    expect(normalizeCapabilities(input)).toEqual(expected);
  });
});

test('normalizePortName makes Cisco long and short names comparable', () => {
  expect(normalizePortName('GigabitEthernet1/0/1')).toBe(normalizePortName('Gi1/0/1'));
  expect(normalizePortName('TenGigabitEthernet1/1/1')).toBe('te1/1/1');
  expect(normalizePortName(' 1/1/13 ')).toBe('1/1/13');
});

describe('AOS-CX REST (live capture, 6200F ML.10.16)', () => {
  const neighbors = cx.parseLldpNeighbors(fixture.lldp);

  test('one neighbor per port', () => {
    expect(neighbors.map((n) => n.localPort).sort()).toEqual(['1/1/13', '1/1/4']);
  });

  test('a switch neighbor: chassis id is its system MAC', () => {
    const core = neighbors.find((n) => n.localPort === '1/1/13');
    expect(core).toMatchObject({
      chassisId: '14:ab:ec:c2:0e:00',
      mac: '14:ab:ec:c2:0e:00',
      portId: '1/1/6',
      sysName: 'Sw-CoreB',
      mgmtIp: '192.168.255.2',
      capabilities: ['bridge', 'router'],
      protocol: 'lldp',
    });
    expect(core.sysDesc).toMatch(/JL668A/);
  });

  test('a phone advertising an IP chassis id: the MAC comes from mac_addr', () => {
    const phone = neighbors.find((n) => n.localPort === '1/1/4');
    expect(phone).toMatchObject({
      chassisId: '192.168.18.140',
      mac: '04:2a:e2:70:cb:4e',
      portId: '042AE270CB4E:P1',
      mgmtIp: '192.168.18.140',
      capabilities: ['bridge', 'telephone'],
    });
  });

  test('identity from /system', () => {
    expect(cx.parseIdentity(fixture.system)).toEqual({ chassisId: 'ec:67:94:d1:a8:00', sysName: 'Sw-Studio' });
  });

  test('URI strings (depth too shallow) and empty responses are ignored', () => {
    expect(cx.parseLldpNeighbors({ '1/1/1': { 'a,b': '/rest/v10.10/system/...' } })).toEqual([]);
    expect(cx.parseLldpNeighbors(null)).toEqual([]);
  });
});

describe('Junos', () => {
  const xml = `<rpc-reply xmlns:junos="http://xml.juniper.net/junos/23.4R1/junos">
    <lldp-neighbors-information junos:style="brief">
      <lldp-neighbor-information>
        <lldp-local-port-id>ge-0/0/1</lldp-local-port-id>
        <lldp-local-parent-interface-name>-</lldp-local-parent-interface-name>
        <lldp-remote-chassis-id-subtype>Mac address</lldp-remote-chassis-id-subtype>
        <lldp-remote-chassis-id>00:11:22:33:44:55</lldp-remote-chassis-id>
        <lldp-remote-port-id-subtype>Interface name</lldp-remote-port-id-subtype>
        <lldp-remote-port-id>ge-0/0/24</lldp-remote-port-id>
        <lldp-remote-system-name>ex-core</lldp-remote-system-name>
      </lldp-neighbor-information>
      <lldp-neighbor-information>
        <lldp-local-interface>ge-0/0/2</lldp-local-interface>
        <lldp-remote-chassis-id>5c:5b:35:00:00:01</lldp-remote-chassis-id>
        <lldp-remote-port-id>eth0</lldp-remote-port-id>
        <lldp-remote-system-name>ap-lobby &amp; hall</lldp-remote-system-name>
      </lldp-neighbor-information>
    </lldp-neighbors-information></rpc-reply>`;

  test('NETCONF neighbors, both local-port element names', () => {
    const neighbors = junos.parseLldpNeighborsXml(xml);
    expect(neighbors).toHaveLength(2);
    expect(neighbors[0]).toMatchObject({
      localPort: 'ge-0/0/1', mac: '00:11:22:33:44:55', portId: 'ge-0/0/24', sysName: 'ex-core',
    });
    expect(neighbors[1]).toMatchObject({ localPort: 'ge-0/0/2', sysName: 'ap-lobby & hall' });
  });

  test('NETCONF local info', () => {
    const reply = '<lldp-local-info><lldp-local-chassis-id>aa:bb:cc:00:11:22</lldp-local-chassis-id>'
      + '<lldp-local-system-name>ex-access</lldp-local-system-name></lldp-local-info>';
    expect(junos.parseLocalInfoXml(reply)).toEqual({ chassisId: 'aa:bb:cc:00:11:22', sysName: 'ex-access' });
  });

  test('CLI table, with and without the parent column, port info with spaces', () => {
    const withParent = [
      'Local Interface    Parent Interface    Chassis Id          Port info          System Name',
      'ge-0/0/1           -                   00:11:22:33:44:55   ge-0/0/24          ex-core',
      'ge-0/0/2           ae0                 00:11:22:33:44:66   uplink to idf      ex-idf',
    ].join('\n');
    const rows = junos.parseLldpNeighborsCli(withParent);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ localPort: 'ge-0/0/2', portId: 'uplink to idf', sysName: 'ex-idf' });

    const noParent = [
      'Local Interface    Chassis Id          Port info     System Name',
      'ge-0/0/3           00:11:22:33:44:77   ge-0/0/1      ex-lab',
    ].join('\n');
    expect(junos.parseLldpNeighborsCli(noParent)[0]).toMatchObject({ mac: '00:11:22:33:44:77', sysName: 'ex-lab' });
  });

  test('CLI local information', () => {
    const text = 'LLDP Local Information details\n\nChassis ID   : 00:11:22:33:44:88\nSystem name  : ex-access\n';
    expect(junos.parseLocalInfoCli(text)).toEqual({ chassisId: '00:11:22:33:44:88', sysName: 'ex-access' });
  });
});

describe('AOS-S CLI', () => {
  const remote = ` LLDP Remote Device Information Detail

  Local Port   : 1
  ChassisType  : mac-address
  ChassisId    : 00 1a 1e 00 00 00
  PortType     : local
  PortId       : 24
  SysName      : sw-core
  System Descr : HP J9727A 2920-24G-PoE+ Switch, revision WB.16.10.0009
  PortDescr    : 24
  Pvid         : 1

  System Capabilities Supported  : bridge, router
  System Capabilities Enabled    : bridge

  Remote Management Address
     Type    : ipv4
     Address : 10.0.0.1
 ------------------------------------------------------------------------------
  Local Port   : 5
  ChassisType  : mac-address
  ChassisId    : 204c03-000001
  PortType     : local
  PortId       : 0
  SysName      : ap-305
  System Capabilities Enabled    : wlan-access-point
`;

  test('detail blocks', () => {
    const neighbors = aosS.parseRemoteDetail(remote);
    expect(neighbors).toHaveLength(2);
    expect(neighbors[0]).toMatchObject({
      localPort: '1', mac: '00:1a:1e:00:00:00', portId: '24', sysName: 'sw-core', mgmtIp: '10.0.0.1', capabilities: ['bridge'],
    });
    expect(neighbors[1]).toMatchObject({ localPort: '5', mac: '20:4c:03:00:00:01', capabilities: ['wlan-ap'] });
  });

  test('local device', () => {
    const local = ' LLDP Local Device Information\n\n  Chassis Type : mac-address\n  Chassis Id   : 00 1a 1e 11 22 33\n  System Name  : sw-access\n';
    expect(aosS.parseLocalDevice(local)).toEqual({ chassisId: '00:1a:1e:11:22:33', sysName: 'sw-access' });
  });
});

describe('IOS / IOS-XE CLI', () => {
  const cdp = `-------------------------
Device ID: sw2.example.com
Entry address(es):
  IP address: 10.0.0.2
Platform: cisco WS-C3850-24P,  Capabilities: Switch IGMP
Interface: GigabitEthernet1/0/1,  Port ID (outgoing port): GigabitEthernet1/0/24
Holdtime : 150 sec
-------------------------
Device ID: SEP001122334455
Entry address(es):
  IP address: 10.0.18.40
Platform: Cisco IP Phone 8841,  Capabilities: Host Phone Two-port Mac Relay
Interface: GigabitEthernet1/0/5,  Port ID (outgoing port): Port 1
`;
  const lldp = `------------------------------------------------
Local Intf: Gi1/0/1
Chassis id: 0011.2233.4455
Port id: Gi1/0/24
Port Description: GigabitEthernet1/0/24
System Name: sw2

System Description:
Cisco IOS Software, Catalyst L3 Switch Software

Time remaining: 101 seconds
System Capabilities: B,R
Enabled Capabilities: B,R
Management Addresses:
    IP: 10.0.0.2
`;

  test('CDP detail', () => {
    const neighbors = ios.parseCdpDetail(cdp);
    expect(neighbors).toHaveLength(2);
    expect(neighbors[0]).toMatchObject({
      localPort: 'GigabitEthernet1/0/1', chassisId: 'sw2.example.com', portId: 'GigabitEthernet1/0/24',
      mgmtIp: '10.0.0.2', capabilities: ['bridge'], protocol: 'cdp', mac: null,
    });
    expect(neighbors[1].capabilities).toEqual(['station', 'telephone']);
  });

  test('LLDP detail', () => {
    const [n] = ios.parseLldpDetail(lldp);
    expect(n).toMatchObject({
      localPort: 'Gi1/0/1', mac: '00:11:22:33:44:55', portId: 'Gi1/0/24', sysName: 'sw2',
      sysDesc: 'Cisco IOS Software, Catalyst L3 Switch Software', mgmtIp: '10.0.0.2', capabilities: ['bridge', 'router'],
    });
  });

  test('a disabled protocol yields nothing', () => {
    expect(ios.parseCdpDetail('% CDP is not enabled')).toEqual([]);
    expect(ios.parseLldpDetail('% LLDP is not enabled')).toEqual([]);
  });
});
