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
    credentials: { clientId: 'id', clientSecret: 'secret', customerId: 'cust' },
  });

  test('refuses an integration with missing credentials', () => {
    expect(() => new ArubaCentralProvider({
      name: 'Bad', baseUrl: 'https://x', credentials: { clientId: 'id' },
    })).toThrow(/missing clientId, clientSecret, or customerId/);
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
      ipAddress: '10.0.0.2', site: 'site-1', lastSeen: new Date(1758800000 * 1000),
    });
    expect(aoss).toMatchObject({ platform: 'aos-s', status: 'offline' });
    // APs don't get a platform; a missing name falls back to the serial.
    expect(ap).toMatchObject({ name: 'CNKL0003', type: 'access_point', platform: null, status: 'online', ipAddress: 'fd00::3' });
    expect(gw).toMatchObject({ type: 'gateway', status: 'maintenance', lastSeen: null, macAddress: null });
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
});
