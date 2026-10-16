/**
 * Provider normalization: Central and Mist inventory both map onto the
 * NormalizedCloudDevice contract (see base-cloud-provider.js).
 */
jest.mock('axios');
jest.mock('../../src/config/redis', () => ({ getRedis: jest.fn() }));

const axios = require('axios');
const ArubaCentralProvider = require('../../src/services/cloud-providers/aruba-central.provider');
const MistProvider = require('../../src/services/cloud-providers/mist.provider');
const centralFixture = require('../fixtures/central-devices.json');
const mistInventory = require('../fixtures/mist-inventory.json');
const mistStats = require('../fixtures/mist-stats.json');
const mistScope = require('../fixtures/mist-scope.json');

const CONTRACT_KEYS = [
  'serial', 'name', 'model', 'macAddress', 'ipAddress', 'type', 'vendor', 'platform',
  'status', 'firmwareVersion', 'site', 'lastSeen', 'metadata',
].sort();
const DEVICE_TYPES = ['access_point', 'switch', 'gateway', 'other'];
const DEVICE_STATUSES = ['online', 'offline', 'warning', 'maintenance'];

function expectContract(device) {
  expect(Object.keys(device).sort()).toEqual(CONTRACT_KEYS);
  expect(DEVICE_TYPES).toContain(device.type);
  expect(DEVICE_STATUSES).toContain(device.status);
  expect(typeof device.name).toBe('string');
  expect(device.name.length).toBeGreaterThan(0);
}

describe('ArubaCentralProvider', () => {
  const provider = new ArubaCentralProvider({
    id: 'int-1',
    provider: 'aruba_central',
    name: 'Central',
    baseUrl: 'https://central.example.com',
    credentials: { clientId: 'id', clientSecret: 'secret' },
  });

  test('refuses an integration with missing credentials', () => {
    expect(() => new ArubaCentralProvider({
      name: 'Bad', baseUrl: 'https://x', credentials: { clientId: 'id' },
    })).toThrow(/missing clientId or clientSecret/);
  });

  describe('authentication', () => {
    const { getRedis } = require('../../src/config/redis');
    const redis = { get: jest.fn(), setEx: jest.fn(), del: jest.fn() };

    beforeEach(() => {
      jest.resetAllMocks();
      getRedis.mockReturnValue(redis);
      redis.get.mockResolvedValue(null);
      redis.setEx.mockResolvedValue('OK');
      redis.del.mockResolvedValue(1);
    });

    const centralAt = (baseUrl, extra = {}) => new ArubaCentralProvider({
      id: 'int-2', provider: 'aruba_central', name: 'Home', baseUrl,
      credentials: { clientId: 'id', clientSecret: 'secret', ...extra },
    });

    test('a Central API client gets its token from HPE SSO', async () => {
      axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 7199 } });
      await centralAt('https://us4.api.central.arubanetworks.com').getAccessToken();
      const [url, body] = axios.post.mock.calls[0];
      expect(url).toBe('https://sso.common.cloud.hpe.com/as/token.oauth2');
      expect(body.get('grant_type')).toBe('client_credentials');
    });

    test('a GreenLake-platform client uses its workspace token URL', async () => {
      axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 899 } });
      await centralAt('https://us4.api.central.arubanetworks.com', { workspaceId: 'ws-1' }).getAccessToken();
      expect(axios.post.mock.calls[0][0])
        .toBe('https://global.api.greenlake.hpe.com/authorization/v2/oauth2/ws-1/token');
    });

    test('a Classic apigw-* base URL fails the test without calling out', async () => {
      const result = await centralAt('https://apigw-uswest4.central.arubanetworks.com').testConnection();
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Classic Central/);
      expect(result.details.actions.length).toBeGreaterThan(0);
      expect(axios.post).not.toHaveBeenCalled();
    });

    test('a failed test returns the provider error, not just a summary', async () => {
      axios.post.mockRejectedValue({
        message: 'Request failed with status code 400',
        config: { url: 'https://sso.common.cloud.hpe.com/as/token.oauth2', method: 'post' },
        response: {
          status: 400,
          data: { error: 'invalid_client', error_description: 'Invalid client authentication' },
          headers: {},
        },
      });
      const result = await centralAt('https://us4.api.central.arubanetworks.com').testConnection();
      expect(result).toMatchObject({
        success: false,
        message: 'Invalid client credentials',
        details: {
          method: 'POST',
          endpoint: 'https://sso.common.cloud.hpe.com/as/token.oauth2',
          statusCode: 400,
          providerError: 'invalid_client',
          providerMessage: 'Invalid client authentication',
        },
      });
      expect(result.details).not.toHaveProperty('headers');
    });

    test('a passing test also calls the API on the configured cluster', async () => {
      axios.post.mockResolvedValue({ data: { access_token: 'tok', expires_in: 7199 } });
      axios.mockResolvedValue({ data: { items: [] } });
      const result = await centralAt('https://us4.api.central.arubanetworks.com').testConnection();
      expect(result.success).toBe(true);
      expect(axios.mock.calls[0][0]).toMatchObject({
        url: 'https://us4.api.central.arubanetworks.com/network-monitoring/v1alpha1/devices',
        headers: { Authorization: 'Bearer tok' },
      });
    });
  });

  test('does not claim config-backup (endpoints are quarantined)', async () => {
    expect(provider.supports('config-backup')).toBe(false);
    await expect(provider.getDeviceConfiguration('SG1')).rejects.toMatchObject({ name: 'CapabilityError', statusCode: 501 });
  });

  test('listInventory follows pagination and normalizes every item', async () => {
    const makeRequest = jest.spyOn(provider, 'makeRequest')
      .mockResolvedValueOnce(centralFixture.page1)
      .mockResolvedValueOnce(centralFixture.page2);

    const devices = await provider.listInventory();

    expect(makeRequest).toHaveBeenCalledTimes(2);
    expect(makeRequest.mock.calls[1][2].params).toEqual({ limit: 100, next: 'cursor-2' });
    expect(devices).toHaveLength(4);
    devices.forEach(expectContract);

    const [cx, aoss, ap, gw] = devices;
    expect(cx).toMatchObject({
      serial: 'SG30KW0001', type: 'switch', vendor: 'aruba', platform: 'aos-cx', status: 'online',
      ipAddress: '10.0.0.2', site: 'HQ', firmwareVersion: 'FL.10.16.1010',
    });
    // Central leaves lastSeenAt empty for a device that is up.
    expect(cx.lastSeen).toBeInstanceOf(Date);
    expect(cx.metadata).toMatchObject({ siteId: '100001', uptimeMs: 14791955848, configStatus: 'Synchronized' });
    expect(aoss).toMatchObject({ platform: 'aos-s', status: 'offline', lastSeen: new Date('2026-10-01T12:00:00Z') });
    // APs don't get a platform; a missing name falls back to the serial.
    expect(ap).toMatchObject({ name: 'CNKL0003', type: 'access_point', platform: null, status: 'online', ipAddress: 'fd00::3' });
    expect(gw).toMatchObject({ type: 'gateway', status: 'offline', lastSeen: null, macAddress: null, site: null });
  });

  test('switch platform comes from the firmware when the model is bare', () => {
    const bare = provider.normalizeDevice({
      serialNumber: 'VN0001', deviceType: 'SWITCH', model: '6200', firmwareVersion: 'ML.10.16.1006', status: 'ONLINE',
    });
    expect(bare.platform).toBe('aos-cx');
    const aoss = provider.normalizeDevice({
      serialNumber: 'TW0001', deviceType: 'SWITCH', model: '2930F', firmwareVersion: 'WC.16.11.0012', status: 'OFFLINE',
    });
    expect(aoss.platform).toBe('aos-s');
  });

  test('status mapping covers the live ONLINE/OFFLINE values and older spellings', () => {
    expect(provider.mapDeviceStatus('ONLINE')).toBe('online');
    expect(provider.mapDeviceStatus('OFFLINE')).toBe('offline');
    expect(provider.mapDeviceStatus('Up')).toBe('online');
    expect(provider.mapDeviceStatus('Maintenance')).toBe('maintenance');
  });

  test('getDeviceStatus filters on serialNumber (Central rejects "serial")', async () => {
    const makeRequest = jest.spyOn(provider, 'makeRequest')
      .mockResolvedValueOnce({ items: [centralFixture.page1.items[0]] });
    const result = await provider.getDeviceStatus('SG30KW0001');
    expect(makeRequest.mock.calls[0][2].params.filter).toBe("serialNumber eq 'SG30KW0001'");
    expect(result.status).toBe('online');
  });

  test('unknown status maps to offline, not online', () => {
    expect(provider.mapDeviceStatus('Something')).toBe('offline');
  });
});

describe('MistProvider', () => {
  const provider = new MistProvider({
    id: 'int-2',
    provider: 'juniper_mist',
    name: 'Mist',
    baseUrl: 'https://api.mist.com',
    credentials: { apiToken: 'token', orgId: 'org-1' },
  });

  beforeEach(() => axios.mockReset());

  function routeAxios(handlers) {
    axios.mockImplementation(async (config) => {
      const path = config.url.replace('https://api.mist.com', '');
      const handler = handlers[path];
      if (!handler) throw new Error(`unexpected request ${path}`);
      return { data: handler(config) };
    });
  }

  test('listInventory enriches from stats and requests all device types', async () => {
    let statsParams;
    routeAxios({
      '/api/v1/orgs/org-1/inventory': () => mistInventory,
      '/api/v1/orgs/org-1/stats/devices': (config) => {
        statsParams = config.params;
        return mistStats;
      },
    });

    const devices = await provider.listInventory();

    expect(statsParams.type).toBe('all');
    expect(axios.mock.calls[0][0].headers.Authorization).toBe('Token token');
    expect(devices).toHaveLength(3);
    devices.forEach(expectContract);

    const [ex, ap, srx] = devices;
    // Stats are matched by MAC case-insensitively.
    expect(ex).toMatchObject({
      serial: 'FX0001', type: 'switch', vendor: 'juniper', platform: 'junos', status: 'online',
      ipAddress: '10.1.0.2', firmwareVersion: '23.4R2-S3', lastSeen: new Date(1758800500 * 1000),
    });
    expect(ap).toMatchObject({
      name: 'ap-lobby', type: 'access_point', platform: null, status: 'offline',
      ipAddress: null, lastSeen: new Date(1758600000 * 1000),
    });
    expect(srx).toMatchObject({ name: 'SRX0003', type: 'gateway', platform: 'junos', site: null });
  });

  test('a stats failure still returns the inventory', async () => {
    routeAxios({
      '/api/v1/orgs/org-1/inventory': () => mistInventory,
      '/api/v1/orgs/org-1/stats/devices': () => {
        throw Object.assign(new Error('503'), { response: { status: 503 } });
      },
    });

    const devices = await provider.listInventory();

    expect(devices).toHaveLength(3);
    expect(devices[0].ipAddress).toBeNull();
  });

  test('pagination continues while pages are full', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ serial: `S${i}`, mac: `m${i}`, type: 'switch' }));
    const pages = [full, [{ serial: 'LAST', mac: 'mlast', type: 'switch' }]];
    routeAxios({
      '/api/v1/orgs/org-1/inventory': (config) => pages[config.params.page - 1],
      '/api/v1/orgs/org-1/stats/devices': () => [],
    });

    const devices = await provider.listInventory();

    expect(devices).toHaveLength(1001);
    expect(devices[1000].serial).toBe('LAST');
  });

  test('config backup of an AP is an honest CapabilityError', async () => {
    routeAxios({ '/api/v1/orgs/org-1/inventory': () => [mistInventory[1]] });

    await expect(provider.getDeviceConfiguration('AP0002')).rejects.toMatchObject({ name: 'CapabilityError' });
  });

  test('config backup of an unassigned device is a CapabilityError', async () => {
    routeAxios({ '/api/v1/orgs/org-1/inventory': () => [mistInventory[2]] });

    await expect(provider.getDeviceConfiguration('SRX0003')).rejects.toThrow(/not assigned to a site/);
  });

  test('switch config is canonical JSON with sorted keys', async () => {
    routeAxios({
      '/api/v1/orgs/org-1/inventory': () => [mistInventory[0]],
      [`/api/v1/sites/site-a/devices/${mistInventory[0].id}`]: () => ({ zeta: 1, alpha: { b: 2, a: 1 } }),
    });

    const config = await provider.getDeviceConfiguration('FX0001');

    expect(config.format).toBe('mist-config-json');
    expect(config.text).toBe(JSON.stringify({ alpha: { a: 1, b: 2 }, zeta: 1 }, null, 2));
  });

  describe('scope backups', () => {
    const notFound = () => {
      throw Object.assign(new Error('404'), { response: { status: 404 } });
    };
    const orgRoutes = {
      '/api/v1/orgs/org-1/setting': () => mistScope.orgSetting,
      '/api/v1/orgs/org-1/wlans': () => mistScope.orgWlans,
      '/api/v1/orgs/org-1/templates': () => mistScope.templates,
      '/api/v1/orgs/org-1/rftemplates': () => mistScope.rftemplates,
      '/api/v1/orgs/org-1/deviceprofiles': () => mistScope.deviceprofiles,
      '/api/v1/orgs/org-1/networktemplates': () => [],
      '/api/v1/orgs/org-1/sitetemplates': () => [],
      '/api/v1/orgs/org-1/gatewaytemplates': notFound,
    };

    test('supports scope-backup', () => {
      expect(provider.supports('scope-backup')).toBe(true);
    });

    test('lists the org, then its sites by name', async () => {
      routeAxios({
        '/api/v1/orgs/org-1': () => mistScope.org,
        '/api/v1/orgs/org-1/sites': () => mistScope.sites,
      });

      expect(await provider.listConfigScopes()).toEqual([
        { scopeType: 'org', scopeId: 'org-1', name: 'Acme Networks' },
        { scopeType: 'site', scopeId: 'site-a', name: 'HQ' },
        { scopeType: 'site', scopeId: 'site-b', name: 'Warehouse' },
      ]);
    });

    test('org scope bundles the inherited objects; an unavailable section is null', async () => {
      routeAxios(orgRoutes);

      const config = await provider.getScopeConfiguration({ scopeType: 'org', scopeId: 'org-1', name: 'Acme Networks' });
      const bundle = JSON.parse(config.text);

      expect(config.format).toBe('mist-scope-json');
      expect(bundle.scope).toEqual({ type: 'org', id: 'org-1', name: 'Acme Networks' });
      expect(bundle.wlans.map((w) => w.id)).toEqual(['w-1', 'w-2']); // sorted by id
      expect(bundle.rfTemplates[0].name).toBe('Office RF');
      expect(bundle.deviceProfiles[0].type).toBe('ap');
      expect(bundle.gatewayTemplates).toBeNull();
    });

    test('the bundle is stable across response ordering', async () => {
      routeAxios(orgRoutes);
      const scope = { scopeType: 'org', scopeId: 'org-1', name: 'Acme Networks' };
      const first = await provider.getScopeConfiguration(scope);
      routeAxios({ ...orgRoutes, '/api/v1/orgs/org-1/wlans': () => [...mistScope.orgWlans].reverse() });
      const second = await provider.getScopeConfiguration(scope);

      expect(second.text).toBe(first.text);
    });

    test('site scope holds the site record, its settings and its WLANs', async () => {
      routeAxios({
        '/api/v1/sites/site-a': () => mistScope.siteA,
        '/api/v1/sites/site-a/setting': () => mistScope.siteSetting,
        '/api/v1/sites/site-a/wlans': () => mistScope.siteWlans,
      });

      const bundle = JSON.parse((await provider.getScopeConfiguration({ scopeType: 'site', scopeId: 'site-a', name: 'HQ' })).text);

      expect(Object.keys(bundle)).toEqual(['scope', 'setting', 'site', 'wlans']);
      expect(bundle.site.rftemplate_id).toBe('rf-1');
    });

    test('an error other than 404 fails the scope', async () => {
      routeAxios({ ...orgRoutes, '/api/v1/orgs/org-1/wlans': () => { throw Object.assign(new Error('403'), { response: { status: 403 } }); } });

      await expect(provider.getScopeConfiguration({ scopeType: 'org', scopeId: 'org-1', name: 'x' })).rejects.toThrow(/403/);
    });
  });
});

describe('scope backups on other providers', () => {
  test('Central is an honest CapabilityError until its config endpoints are verified', async () => {
    const central = new ArubaCentralProvider({
      id: 'int-1', provider: 'aruba_central', name: 'Central', baseUrl: 'https://example.invalid',
      credentials: { clientId: 'c', clientSecret: 's', customerId: 'cust' },
    });
    expect(central.supports('scope-backup')).toBe(false);
    await expect(central.listConfigScopes()).rejects.toMatchObject({ name: 'CapabilityError' });
  });
});
