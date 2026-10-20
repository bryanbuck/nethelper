/**
 * JunosAPI against real NETCONF replies from an EX4000-12MP (Junos
 * 24.4R2.25, Mist-managed), captured 2026-10-19 and anonymised
 * (tests/fixtures/junos-live/). The session is faked; the parsing is real.
 */
const fs = require('fs');
const path = require('path');
const JunosAPI = require('../../src/services/device-api/junos-api');
const NetconfClient = require('../../src/services/device-api/netconf-client');
const { assertJunosConfigReadable, junosDeniedHierarchies } = require('../../src/utils/config-format');

const capture = (name) => fs.readFileSync(path.join(__dirname, '../fixtures/junos-live', `${name}.xml`), 'utf8');
const REPLIES = {
  '<get-software-information/>': capture('software-information'),
  '<get-lldp-neighbors-information/>': capture('lldp-neighbors'),
  '<get-lldp-local-info/>': capture('lldp-local-info'),
  '<get-chassis-inventory/>': capture('chassis-inventory'),
  '<get-chassis-mac-addresses/>': capture('chassis-mac-addresses'),
  // The account behind the capture lacked view-configuration.
  '<get-configuration format="set" database="committed"/>': capture('config-set'),
};

function liveApi() {
  const api = new JunosAPI({ name: 'JNEX-01', ipAddress: '192.0.2.2' }, { username: 'u', password: 'p' });
  const client = Object.create(NetconfClient.prototype);
  client.rpc = async (rpc) => {
    if (!(rpc in REPLIES)) throw new Error(`unexpected rpc ${rpc}`);
    return REPLIES[rpc];
  };
  api.withSession = (fn) => fn(client);
  return api;
}

test('device info: hostname, model and version', async () => {
  expect(await liveApi().getDeviceInfo()).toEqual({
    hostname: 'JNEX-01', model: 'ex4000-12mp', version: '24.4R2.25', platform: 'junos', vendor: 'juniper',
  });
});

test('identity: the chassis serial, and the base MAC from fpc-mac-base', async () => {
  expect(await liveApi().getIdentity()).toEqual({ serial: 'SN000002', macAddress: '5c:5b:35:00:00:02' });
});

test('LLDP: the AP and the core switch, plus the switch\'s own identity', async () => {
  const { neighbors, identity } = await liveApi().getLldpTopology();

  expect(identity).toMatchObject({ chassisId: '5c:5b:35:00:00:02', sysName: 'JNEX-01' });
  expect(neighbors).toHaveLength(2);
  expect(neighbors[0]).toMatchObject({ localPort: 'mge-0/0/0', chassisId: '5c:5b:35:00:00:01', sysName: 'JNAP-01' });
  expect(neighbors[1]).toMatchObject({ localPort: 'ge-0/0/11', chassisId: '02:00:00:00:00:10', sysName: 'Lab-Core' });
});

test('a config read without view-configuration is refused, not stored as a backup', async () => {
  await expect(liveApi().getConfiguration()).rejects.toMatchObject({
    code: 'CONFIG_ACCESS_DENIED',
    denied: ['version', 'groups', 'apply-groups', 'system', 'chassis', 'interfaces', 'protocols', 'vlans'],
  });
});

describe('assertJunosConfigReadable', () => {
  // What the same switch returned once the account had view-configuration:
  // the config, minus four hierarchies Junos still withholds.
  const partial = [
    'set version 24.4R2.25',
    'set system host-name JNEX-01',
    'set system login class nethelper-ro permissions view',
    'set system login class nethelper-ro permissions view-configuration',
    'set scripts /* ACCESS-DENIED */;',
    'set event-options /* ACCESS-DENIED */;',
    'set secret /* ACCESS-DENIED */;',
    'set extension-service /* ACCESS-DENIED */;',
    'set interfaces ge-0/0/11 unit 0 family ethernet-switching',
  ].join('\n');

  test('a partly withheld read is kept, and the withheld hierarchies are named', () => {
    expect(() => assertJunosConfigReadable(partial)).not.toThrow();
    expect(junosDeniedHierarchies(partial)).toEqual(['scripts', 'event-options', 'secret', 'extension-service']);
  });

  test('text format with nothing but placeholders is refused', () => {
    expect(() => assertJunosConfigReadable('version 24.4R2.25;\nsystem {\n    /* ACCESS-DENIED */\n}\n')).toThrow(/denied system/);
  });

  test('a readable config passes, even one mentioning the words', () => {
    expect(() => assertJunosConfigReadable('set system host-name ex1\nset interfaces ge-0/0/1 description "ACCESS-DENIED lab"\n')).not.toThrow();
  });
});
