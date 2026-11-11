/**
 * Cisco Meraki provider (preview). Every shape here is SPEC-DERIVED
 * (tests/fixtures/meraki-spec.json, from Cisco's OpenAPI spec v1.76): these
 * tests pin what the provider does with the documented replies, not what a
 * live organization sends. See docs/MERAKI.md.
 */
jest.mock('axios');

const axios = require('axios');
const MerakiProvider = require('../../src/services/cloud-providers/meraki.provider');
const CloudProviderFactory = require('../../src/services/cloud-providers/cloud-provider-factory');
const { CLOUD_PROVIDERS } = require('../../src/constants/vendors');
const { parseAllowedVlans, parseMerakiNeighbors } = require('../../src/services/topology/parsers/meraki');
const spec = require('../fixtures/meraki-spec.json');

const BASE = 'https://api.meraki.com/api/v1';
const ORG = '/organizations/2930418';

const make = (extra = {}) => new MerakiProvider({
  id: 'int-k', provider: 'cisco_meraki', name: 'Meraki', baseUrl: BASE,
  credentials: { apiKey: 'key-123', orgId: '2930418' },
  ...extra,
});

const apiError = (status, data = {}, headers = {}) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data, headers },
  config: { method: 'get', url: `${BASE}/x` },
});

/**
 * Answer axios from a path -> reply table. A reply is the data, a function of
 * the request config, or an Error to reject with. Unlisted paths are a 404.
 */
function serve(routes) {
  axios.mockImplementation(async (config) => {
    const path = config.url.replace(BASE, '');
    if (!(path in routes)) throw apiError(404, { errors: ['Not found'] });
    const reply = typeof routes[path] === 'function' ? routes[path](config) : routes[path];
    if (reply instanceof Error) throw reply;
    return reply && reply.__raw ? reply.__raw : { status: 200, data: reply, headers: {} };
  });
}
const paths = () => axios.mock.calls.map(([config]) => config.url.replace(BASE, ''));

beforeAll(() => {
  MerakiProvider.minIntervalMs = 0;
  MerakiProvider.retryScale = 0;
});
beforeEach(() => axios.mockReset());

describe('MerakiProvider: setup', () => {
  test('refuses an integration with missing credentials', () => {
    expect(() => make({ credentials: { apiKey: 'k' } })).toThrow(/missing apiKey or orgId/);
  });

  test('the factory builds it and Settings offers it as a preview', () => {
    expect(CLOUD_PROVIDERS.cisco_meraki).toMatchObject({ implemented: true, preview: true });
    expect(CLOUD_PROVIDERS.cisco_meraki.regions.map((r) => r.baseUrl)).toContain(BASE);
    const provider = CloudProviderFactory.instantiate({
      id: 'env', provider: 'cisco_meraki', name: 'M', baseUrl: BASE, credentials: { _plaintext: true, apiKey: 'k', orgId: '1' },
    });
    expect(provider).toBeInstanceOf(MerakiProvider);
  });

  test('claims what it does, and not events or writes', async () => {
    const provider = make();
    for (const capability of ['inventory', 'status', 'test', 'config-backup', 'scope-backup', 'topology', 'address-lookup', 'alarms']) {
      expect(provider.supports(capability)).toBe(true);
    }
    expect(provider.supports('events')).toBe(false);
    expect(provider.supports('switch-vlans')).toBe(false);
    await expect(provider.request('PUT', '/organizations')).rejects.toThrow(/read-only/);
  });
});

describe('MerakiProvider: transport', () => {
  test('sends the key as a bearer token and never lets axios follow redirects', async () => {
    serve({ '/organizations': spec.organizations });
    await make().request('GET', '/organizations');
    const [config] = axios.mock.calls[0];
    expect(config.headers.Authorization).toBe('Bearer key-123');
    expect(config.maxRedirects).toBe(0);
    expect(config.method).toBe('GET');
  });

  test('follows the Link header to the last page and unwraps { items }', async () => {
    const next = `${BASE}${ORG}/devices?perPage=1000&startingAfter=Q2`;
    axios.mockImplementation(async (config) => (config.url === next
      ? { status: 200, data: { items: [{ serial: 'Q3' }], meta: {} }, headers: {} }
      : { status: 200, data: [{ serial: 'Q1' }, { serial: 'Q2' }], headers: { link: `<${BASE}${ORG}/devices?perPage=1000>; rel=first, <${next}>; rel=next` } }));

    const items = await make().requestAllPages(`${ORG}/devices`);

    expect(items.map((d) => d.serial)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(axios.mock.calls[0][0].params).toEqual({ perPage: 1000 });
    expect(axios.mock.calls[1][0].params).toBeUndefined(); // the link carries the cursor
  });

  test('a next link on another site is not followed', async () => {
    axios.mockResolvedValue({ status: 200, data: [{ serial: 'Q1' }], headers: { link: '<https://evil.example/api/v1/x>; rel=next' } });
    const items = await make().requestAllPages(`${ORG}/devices`);
    expect(items).toHaveLength(1);
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('a redirect to the organization\'s shard is followed with the key', async () => {
    axios
      .mockResolvedValueOnce({ status: 302, data: '', headers: { location: 'https://n123.meraki.com/api/v1/organizations?x=1' } })
      .mockResolvedValueOnce({ status: 200, data: spec.organizations, headers: {} });
    const data = await make().request('GET', '/organizations', { params: { x: 1 } });
    expect(data).toHaveLength(2);
    expect(axios.mock.calls[1][0].url).toBe('https://n123.meraki.com/api/v1/organizations?x=1');
    expect(axios.mock.calls[1][0].headers.Authorization).toBe('Bearer key-123');
  });

  test('a redirect anywhere else is refused, and the key stays home', async () => {
    axios.mockResolvedValueOnce({ status: 302, data: '', headers: { location: 'https://meraki.com.evil.example/api/v1/organizations' } });
    await expect(make().request('GET', '/organizations')).rejects.toThrow(/won't send the API key/);
    expect(axios).toHaveBeenCalledTimes(1);
  });

  test('a 429 is retried after its Retry-After, then gives up with a clear error', async () => {
    axios
      .mockRejectedValueOnce(apiError(429, { errors: ['API rate limit exceeded for organization'] }, { 'retry-after': '1' }))
      .mockResolvedValueOnce({ status: 200, data: [], headers: {} });
    await expect(make().request('GET', '/organizations')).resolves.toEqual([]);

    axios.mockReset();
    axios.mockRejectedValue(apiError(429, {}, { 'retry-after': '1' }));
    await expect(make().request('GET', '/organizations')).rejects.toMatchObject({ statusCode: 429, message: expect.stringMatching(/rate limit/) });
    expect(axios).toHaveBeenCalledTimes(4); // the call and three retries
  });

  test('calls to one organization run one at a time', async () => {
    let running = 0;
    let most = 0;
    axios.mockImplementation(async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => { setTimeout(resolve, 5); });
      running -= 1;
      return { status: 200, data: [], headers: {} };
    });
    const provider = make();
    await Promise.all([1, 2, 3, 4].map(() => provider.request('GET', '/organizations')));
    expect(most).toBe(1);
  });

  test('errors explain themselves and never carry the key', async () => {
    axios.mockRejectedValue(apiError(401, { errors: ['Invalid API key'] }));
    const error = await make().request('GET', '/organizations').catch((e) => e);
    expect(error).toMatchObject({ statusCode: 401, isProviderError: true });
    expect(error.actions.length).toBeGreaterThan(0);
    expect(JSON.stringify(error.details)).not.toContain('key-123');
  });
});

describe('MerakiProvider: connection test', () => {
  test('passes when the key sees the organization, and says who and where', async () => {
    serve({ '/organizations': spec.organizations, '/administered/identities/me': spec.identity });
    const result = await make().testConnection();
    expect(result).toMatchObject({
      success: true,
      message: 'Authenticated with Cisco Meraki as miles@example.com: organization "Example Org"',
      details: { orgId: '2930418', orgName: 'Example Org', region: 'North America' },
    });
  });

  test('a key that cannot see the organization explains what to fix', async () => {
    serve({ '/organizations': [spec.organizations[1]] });
    const result = await make().testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/cannot see organization 2930418/);
    expect(result.details.explanation).toMatch(/Other Org \(111\)/);
  });

  test('an organization with API access off fails the test', async () => {
    serve({ '/organizations': [{ ...spec.organizations[0], api: { enabled: false } }] });
    const result = await make().testConnection();
    expect(result).toMatchObject({ success: false, message: expect.stringMatching(/API access is turned off/) });
  });

  test('a rejected key is a failure with suggested actions; a failed identity read is not', async () => {
    axios.mockRejectedValue(apiError(401));
    const failed = await make().testConnection();
    expect(failed.success).toBe(false);
    expect(failed.details.actions.length).toBeGreaterThan(0);

    axios.mockReset();
    serve({ '/organizations': spec.organizations });
    expect((await make().testConnection()).success).toBe(true);
  });
});

describe('MerakiProvider: inventory and status', () => {
  const routes = {
    [`${ORG}/inventory/devices`]: spec.inventory,
    [`${ORG}/devices`]: spec.devices,
    [`${ORG}/devices/availabilities`]: spec.availabilities,
    [`${ORG}/networks`]: spec.networks,
  };
  const CONTRACT_KEYS = [
    'serial', 'name', 'model', 'macAddress', 'ipAddress', 'type', 'vendor', 'platform',
    'status', 'firmwareVersion', 'site', 'lastSeen', 'metadata',
  ].sort();
  const OPTIONAL_KEYS = ['cloudManaged', 'cloudManagedSource', 'cloudConnectionStatus', 'configInSync'];

  test('normalizes every claimed device onto the contract', async () => {
    serve(routes);
    const devices = await make().listInventory();
    const by = Object.fromEntries(devices.map((d) => [d.serial, d]));

    expect(devices).toHaveLength(5);
    for (const device of devices) {
      expect(Object.keys(device).filter((k) => !OPTIONAL_KEYS.includes(k)).sort()).toEqual(CONTRACT_KEYS);
      expect(device).toMatchObject({ vendor: 'cisco', platform: 'meraki' });
      expect(device.name.length).toBeGreaterThan(0);
    }
    expect(by['Q234-ABCD-5678']).toMatchObject({
      type: 'access_point', status: 'online', ipAddress: '10.0.0.20', firmwareVersion: 'wireless-25-14',
      site: 'Main Office', macAddress: '00:11:22:33:44:55', cloudManaged: true, cloudManagedSource: 'cloud-inventory',
      cloudConnectionStatus: 'connected',
    });
    expect(by['Q234-ABCD-5678'].lastSeen).toBeInstanceOf(Date);
    // alerting = up with a health alert
    expect(by['Q555-5555-5555']).toMatchObject({ type: 'switch', status: 'online', metadata: { availability: 'alerting' } });
    // the inventory name is empty; the assigned-device list has it
    expect(by['Q2MX-AAAA-0001']).toMatchObject({ type: 'gateway', status: 'offline', name: 'Edge', lastSeen: null });
    // cameras are inventoried as other; dormant is offline
    expect(by['Q2MV-AAAA-0002']).toMatchObject({ type: 'other', status: 'offline' });
    // a spare not assigned to a network: no site, no status, not cloud-configured
    expect(by['Q2SP-AAAA-0003']).toMatchObject({ name: 'Q2SP-AAAA-0003', site: null, status: 'offline', ipAddress: null });
    expect(by['Q2SP-AAAA-0003'].cloudManaged).toBeUndefined();
  });

  test('the device and network lists only enrich; inventory and availability are required', async () => {
    serve({ [`${ORG}/inventory/devices`]: spec.inventory, [`${ORG}/devices/availabilities`]: spec.availabilities });
    const devices = await make().listInventory();
    expect(devices.find((d) => d.serial === 'Q234-ABCD-5678')).toMatchObject({ status: 'online', site: 'N_1', ipAddress: null, firmwareVersion: null });

    // No status source: fail the sync rather than guess a status.
    axios.mockReset();
    serve({ [`${ORG}/inventory/devices`]: spec.inventory, [`${ORG}/devices/availabilities`]: apiError(500) });
    await expect(make().listInventory()).rejects.toThrow(/Cisco Meraki API error \(500\)/);

    axios.mockReset();
    serve({ [`${ORG}/inventory/devices`]: apiError(500) });
    await expect(make().listInventory()).rejects.toThrow(/Cisco Meraki API error \(500\)/);
  });

  test('listStatuses reads availability and the device list, by serial', async () => {
    serve(routes);
    const statuses = await make().listStatuses();
    expect(paths()).toEqual([`${ORG}/devices/availabilities`, `${ORG}/devices`]);
    expect(statuses.size).toBe(4);
    expect(statuses.get('Q555-5555-5555')).toMatchObject({
      status: 'online', ipAddress: '10.0.0.2', firmwareVersion: 'switch-15-21-1', cloudConnectionStatus: 'connected', configInSync: null,
    });
    expect(statuses.get('Q2MX-AAAA-0001')).toMatchObject({ status: 'offline', lastSeen: null, cloudConnectionStatus: 'not_reachable' });
  });

  test('listStatuses survives a failed device list, and fails on a failed availability read', async () => {
    serve({ [`${ORG}/devices/availabilities`]: spec.availabilities, [`${ORG}/devices`]: apiError(500) });
    const statuses = await make().listStatuses();
    expect(statuses.get('Q234-ABCD-5678')).toMatchObject({ status: 'online', ipAddress: null, firmwareVersion: null });

    axios.mockReset();
    serve({ [`${ORG}/devices/availabilities`]: apiError(500) });
    await expect(make().listStatuses()).rejects.toThrow(/500/);
  });

  test('getDeviceStatus filters availability by serial', async () => {
    serve({ [`${ORG}/devices/availabilities`]: (config) => spec.availabilities.filter((row) => config.params.serials.includes(row.serial)) });
    const status = await make().getDeviceStatus('Q2MX-AAAA-0001');
    expect(axios.mock.calls[0][0].params.serials).toEqual(['Q2MX-AAAA-0001']);
    expect(status).toMatchObject({ status: 'offline', lastSeen: null, raw: { serial: 'Q2MX-AAAA-0001' } });
    await expect(make().getDeviceStatus('Q2SP-AAAA-0003')).rejects.toThrow(/no status/);
  });
});

describe('MerakiProvider: settings snapshots', () => {
  const device = spec.devices[1]; // the switch
  const D = `/devices/${device.serial}`;

  test('a switch snapshot holds its record without state fields, and its sections', async () => {
    serve({
      [D]: device,
      [`${D}/managementInterface`]: { wan1: { usingStaticIp: false, vlan: 7 } },
      [`${D}/switch/ports`]: [{ portId: '1', type: 'access', vlan: 10 }, { portId: '2', type: 'trunk', vlan: 1 }],
      [`${D}/switch/routing/interfaces`]: [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }],
      // staticRoutes and warmSpare are not served: 404 -> null
    });
    const result = await make().getDeviceConfiguration(device.serial);
    const snapshot = JSON.parse(result.text);

    expect(result).toMatchObject({ format: 'meraki-settings-json', source: 'Meraki (cisco_meraki)' });
    expect(snapshot.device).toMatchObject({ serial: device.serial, name: 'Example Switch', networkId: 'N_1' });
    for (const field of ['lanIp', 'firmware', 'configurationUpdatedAt']) expect(snapshot.device).not.toHaveProperty(field);
    expect(snapshot.managementInterface.wan1.vlan).toBe(7);
    expect(snapshot.switchPorts.map((p) => p.portId)).toEqual(['1', '2']);
    expect(snapshot.routingInterfaces.map((i) => i.id)).toEqual(['a', 'b']); // id lists are sorted
    expect(snapshot.staticRoutes).toBeNull();
    expect(snapshot.warmSpare).toBeNull();
    expect(result.text).toBe(make().canonicalJson(snapshot)); // sorted keys, stable
  });

  test('an unassigned device and a camera are honest CapabilityErrors', async () => {
    serve({});
    await expect(make().getDeviceConfiguration('Q2SP-AAAA-0003')).rejects.toMatchObject({
      name: 'CapabilityError', message: expect.stringMatching(/not assigned to a network/),
    });
    serve({ '/devices/Q2MV-AAAA-0002': spec.devices[3] });
    await expect(make().getDeviceConfiguration('Q2MV-AAAA-0002')).rejects.toMatchObject({
      name: 'CapabilityError', message: expect.stringMatching(/camera/),
    });
  });

  test('an error other than 400/404 fails the snapshot', async () => {
    serve({ [D]: device, [`${D}/managementInterface`]: apiError(500) });
    await expect(make().getDeviceConfiguration(device.serial)).rejects.toThrow(/500/);
  });

  test('scopes are the organization, its templates, then its networks by name', async () => {
    serve({
      [ORG]: spec.organizations[0],
      [`${ORG}/networks`]: spec.networks,
      [`${ORG}/configTemplates`]: [{ id: 'L_9', name: 'Branch template', productTypes: ['wireless'] }],
    });
    expect(await make().listConfigScopes()).toEqual([
      { scopeType: 'org', scopeId: '2930418', name: 'Example Org' },
      { scopeType: 'config-template', scopeId: 'L_9', name: 'Branch template' },
      { scopeType: 'network', scopeId: 'N_2', name: 'Branch' },
      { scopeType: 'network', scopeId: 'N_1', name: 'Main Office' },
    ]);
  });

  test('a network scope reads the sections of its product types, with secrets fingerprinted', async () => {
    process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-key';
    const N = '/networks/N_2';
    serve({
      [N]: spec.networks[1],
      [`${N}/settings`]: { localStatusPageEnabled: true },
      [`${N}/snmp`]: { access: 'community', communityString: 'sample', users: [{ username: 'u', passphrase: 'hunter2' }] },
      [`${N}/wireless/ssids`]: spec.ssids,
      [`${N}/wireless/ssids/0/firewall/l3FirewallRules`]: { rules: [{ policy: 'deny', destCidr: 'Local LAN' }, { policy: 'allow', destCidr: 'Any' }] },
    });
    const result = await make().getScopeConfiguration({ scopeType: 'network', scopeId: 'N_2', name: 'Branch' });
    const bundle = JSON.parse(result.text);

    expect(result.format).toBe('meraki-scope-json');
    expect(bundle.scope).toEqual({ type: 'network', id: 'N_2', name: 'Branch' });
    expect(bundle.network.name).toBe('Branch');
    expect(bundle.settings).toEqual({ localStatusPageEnabled: true });
    expect(bundle.wirelessRfProfiles).toBeNull(); // not served: 404
    // a wireless-only network reads no switch or appliance sections
    expect(paths().some((p) => /\/switch\/|\/appliance\//.test(p))).toBe(false);
    expect(bundle).not.toHaveProperty('switchSettings');
    // per-SSID rules only for the enabled SSID, in the order Meraki returned them
    expect(Object.keys(bundle.wirelessSsidRules)).toEqual(['0']);
    expect(bundle.wirelessSsidRules['0'].l3FirewallRules.rules.map((r) => r.policy)).toEqual(['deny', 'allow']);
    expect(bundle.wirelessSsidRules['0'].l7FirewallRules).toBeNull();
    // secrets never reach the file
    expect(result.text).not.toMatch(/deadbeef|hunter2|"sample"/);
    expect(bundle.wirelessSsids[0].psk).toMatch(/^\[REDACTED/);
    expect(bundle.snmp.communityString).toMatch(/^\[REDACTED/);
    expect(bundle.snmp.users[0].passphrase).toMatch(/^\[REDACTED/);
  });

  test('the organization scope bundles its sections; a network with nothing readable fails', async () => {
    serve({
      [ORG]: spec.organizations[0],
      [`${ORG}/snmp`]: { v2cEnabled: true, v2CommunityString: 'o/ABCDEF' },
      [`${ORG}/policyObjects`]: [{ id: '20', name: 'b' }, { id: '3', name: 'a' }],
    });
    const org = JSON.parse((await make().getScopeConfiguration({ scopeType: 'org', scopeId: '2930418', name: 'Example Org' })).text);
    expect(org.organization.name).toBe('Example Org');
    expect(org.snmp.v2CommunityString).toMatch(/^\[REDACTED/);
    expect(org.policyObjects.map((o) => o.id)).toEqual(['3', '20']);
    expect(org.loginSecurity).toBeNull();

    serve({ '/networks/N_2': spec.networks[1] });
    await expect(make().getScopeConfiguration({ scopeType: 'network', scopeId: 'N_2', name: 'Branch' }))
      .rejects.toThrow(/no settings/);
    await expect(make().getScopeConfiguration({ scopeType: 'site', scopeId: 'x', name: 'x' }))
      .rejects.toMatchObject({ name: 'CapabilityError' });
  });
});

describe('MerakiProvider: topology', () => {
  test('switch neighbors come from discovery, APs and appliances from the link layer, VLANs from the port config', async () => {
    serve({
      [`${ORG}/devices/availabilities`]: spec.availabilities.map((row) => ({ ...row, status: 'online' })),
      [`${ORG}/switch/ports/topology/discovery/byDevice`]: spec.discovery,
      [`${ORG}/switch/ports/bySwitch`]: spec.switchPorts,
      '/networks/N_1/topology/linkLayer': spec.linkLayer,
    });
    const neighbors = await make().listNeighbors();

    // page sizes the endpoints accept
    const perPage = Object.fromEntries(axios.mock.calls.map(([c]) => [c.url.replace(BASE, ''), c.params?.perPage]));
    expect(perPage[`${ORG}/switch/ports/topology/discovery/byDevice`]).toBe(20);
    expect(perPage[`${ORG}/switch/ports/bySwitch`]).toBe(50);

    const sw = neighbors.get('Q555-5555-5555');
    expect(sw.online).toBe(true);
    expect(sw.identity).toEqual({ chassisId: '01:23:45:67:ab:cd', sysName: 'Example Switch' });
    expect(sw.neighbors).toEqual([
      expect.objectContaining({
        localPort: '1', chassisId: '00:11:22:33:44:55', mac: '00:11:22:33:44:55', sysName: 'My AP', portId: '0',
        mgmtIp: '10.0.0.20', capabilities: ['wlan-ap'], protocol: 'lldp',
      }),
      expect.objectContaining({
        localPort: '8', chassisId: 'core1.example.com', sysName: 'core1.example.com', portId: 'GigabitEthernet1/0/24',
        mgmtIp: '10.0.0.254', capabilities: ['bridge', 'router'], protocol: 'cdp',
      }),
    ]);
    expect(sw.vlans.ports['1']).toMatchObject({ mode: 'access', untagged: 10 });
    expect(sw.vlans.ports['5']).toMatchObject({ mode: 'trunk', untagged: 1, tagged: [3, 5, 6, 7], allTagged: false });
    expect(sw.vlans.ports['8']).toMatchObject({ mode: 'trunk', untagged: 1, allTagged: true });

    // the appliance's links come from the link layer; the switch's are not listed twice
    const mx = neighbors.get('Q2MX-AAAA-0001');
    expect(mx.neighbors).toEqual([
      expect.objectContaining({ localPort: 'Port 3', mac: '01:23:45:67:ab:cd', sysName: 'Example Switch', portId: 'Port 8' }),
      expect.objectContaining({ localPort: 'Port 4', mac: 'aa:bb:cc:dd:ee:ff', sysName: 'Non-Meraki device', portId: 'ge-0/0/1', mgmtIp: '10.130.105.154' }),
    ]);
    expect(sw.neighbors).toHaveLength(2);
    expect(neighbors.get('Q234-ABCD-5678')).toMatchObject({ neighbors: [], vlans: null });
  });

  test('an offline device is marked so, and a failed VLAN or link-layer read costs only itself', async () => {
    serve({
      [`${ORG}/devices/availabilities`]: spec.availabilities,
      [`${ORG}/switch/ports/topology/discovery/byDevice`]: spec.discovery,
      [`${ORG}/switch/ports/bySwitch`]: apiError(500),
      '/networks/N_1/topology/linkLayer': apiError(400),
    });
    const neighbors = await make().listNeighbors();
    expect(neighbors.get('Q2MX-AAAA-0001').online).toBe(false);
    expect(neighbors.get('Q555-5555-5555')).toMatchObject({ online: true, vlans: null });
    expect(neighbors.get('Q555-5555-5555').neighbors).toHaveLength(2);
  });

  test('TLVs as [name, value] pairs and odd allowed-VLAN lists parse too', () => {
    const neighbors = parseMerakiNeighbors({
      discovery: [{ serial: 'S1', mac: '00:00:00:00:00:01', ports: [{ portId: '3', lldp: [['System name', 'sw2'], ['Port ID', '24']] }] }],
    });
    expect(neighbors.get('S1').neighbors[0]).toMatchObject({ localPort: '3', chassisId: 'sw2', portId: '24' });
    expect(parseAllowedVlans('all')).toEqual({ all: true, ids: [] });
    expect(parseAllowedVlans('1, 3,5-7,bogus,9-4')).toEqual({ all: false, ids: [1, 3, 5, 6, 7] });
    expect(parseAllowedVlans(null)).toEqual({ all: false, ids: [] });
  });
});

describe('MerakiProvider: address lookup', () => {
  test('finds its own device by LAN IP and exact-match clients, nearest networks first', async () => {
    serve({
      [`${ORG}/devices`]: [...spec.devices, { serial: 'Q9', networkId: 'N_2', lanIp: '10.0.0.50', name: 'Branch AP', mac: '00:11:22:33:44:99', model: 'MR44' }],
      [`${ORG}/devices/availabilities`]: [{ serial: 'Q9', status: 'offline' }],
      [`${ORG}/networks`]: spec.networks,
      '/networks/N_1/clients': spec.clients,
      '/networks/N_2/clients': apiError(400),
    });
    const holders = await make().findByAddress('10.0.0.50');

    const clientCalls = axios.mock.calls.filter(([c]) => c.url.endsWith('/clients'));
    expect(clientCalls[0][0].params).toMatchObject({ ip: '10.0.0.50', timespan: 604800 });
    expect(holders).toEqual([
      expect.objectContaining({ kind: 'device', name: 'Branch AP', serial: 'Q9', mac: '00:11:22:33:44:99', status: 'offline' }),
      expect.objectContaining({
        kind: 'client', name: "Miles's phone", mac: '22:33:44:55:66:77', status: 'connected', manufacturer: 'Apple',
        lastSeen: new Date(1526087474 * 1000),
        connectedTo: expect.objectContaining({ name: 'My AP', serial: 'Q234-ABCD-5678', mac: '00:11:22:33:44:55', vlan: '100', ssid: 'My SSID' }),
      }),
    ]); // 10.0.0.505 matched Meraki's partial filter and is left out
  });

  test('asks at most 20 networks', async () => {
    serve({
      [`${ORG}/devices`]: [],
      [`${ORG}/networks`]: Array.from({ length: 30 }, (_, i) => ({ id: `N_${i}`, name: `Net ${i}` })),
    });
    axios.mockImplementation(((inner) => async (config) => (config.url.endsWith('/clients')
      ? { status: 200, data: [], headers: {} }
      : inner(config)))(axios.getMockImplementation()));
    expect(await make().findByAddress('192.0.2.9')).toEqual([]);
    expect(axios.mock.calls.filter(([c]) => c.url.endsWith('/clients'))).toHaveLength(20);
  });
});

describe('MerakiProvider: alarms', () => {
  const since = new Date('2026-11-01T00:00:00Z');

  test('reads active and recently resolved alerts, skips device-unreachable', async () => {
    serve({
      [`${ORG}/assurance/alerts`]: (config) => (config.params?.resolved ? spec.alertsResolved : spec.alerts),
    });
    const { alarms, activeIds } = await make().listAlarms({ since });

    const [activeCall, resolvedCall] = axios.mock.calls.map(([c]) => c.params);
    expect(activeCall).toMatchObject({ active: true, perPage: 300 });
    expect(resolvedCall).toMatchObject({ active: false, resolved: true, tsStart: '2026-11-01T00:00:00.000Z' });

    expect(activeIds).toEqual(['1234']);
    expect(alarms.map((a) => a.externalId).sort()).toEqual(['1200', '1234']);
    expect(alarms.find((a) => a.externalId === '1234')).toMatchObject({
      type: 'crc_errors_error', name: 'CRC errors detected', category: 'connectivity', severity: 'warning',
      stateful: true, status: 'active', raisedAt: new Date('2026-11-01T15:48:57Z'), clearedAt: null,
      summary: 'Very high proportion of CRC errors on port id', siteName: 'Main Office', count: 1,
      serials: ['Q555-5555-5555'], macs: ['01:23:45:67:ab:cd'], hostnames: ['Example Switch'],
      data: { networkId: 'N_1', deviceType: 'MS', ports: ['33'] },
    });
    expect(alarms.find((a) => a.externalId === '1200')).toMatchObject({
      severity: 'info', status: 'cleared', clearedAt: new Date('2026-11-01T11:00:00Z'), clearedReason: null, siteName: 'Branch',
    });
  });

  test('a dismissed alert is cleared, and says why', () => {
    const alarm = make().normalizeAlarm({ id: 7, type: 'x_y', severity: 'critical', startedAt: '2026-11-01T00:00:00Z', dismissedAt: '2026-11-02T00:00:00Z' });
    expect(alarm).toMatchObject({ externalId: '7', name: 'X y', status: 'cleared', clearedReason: 'dismissed', severity: 'critical' });
  });
});
