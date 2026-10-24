/**
 * Provider listAlarms() (cloud alarm mirror): Mist org alarm search and
 * Central network-notifications alerts, normalized. Shapes follow the live
 * captures of 2026-10-22 (ROADMAP item 2a findings), with made-up names.
 */
jest.mock('axios');
jest.mock('../../src/config/redis', () => ({ getRedis: jest.fn() }));

const ArubaCentralProvider = require('../../src/services/cloud-providers/aruba-central.provider');
const MistProvider = require('../../src/services/cloud-providers/mist.provider');

const since = new Date('2026-10-20T00:00:00Z');

describe('MistProvider.listAlarms', () => {
  const provider = new MistProvider({
    id: 'int-m', provider: 'juniper_mist', name: 'Mist', baseUrl: 'https://api.mist.example',
    credentials: { apiToken: 'token', orgId: 'org-1' },
  });

  test('reads infrastructure and marvis alarms, skips what NetHelper records itself', async () => {
    const request = jest.spyOn(provider, 'request').mockImplementation(async (method, endpoint, opts) => {
      if (endpoint === '/api/v1/const/alarm_defs') return [{ key: 'sw_bad_optics', display: 'Switch Bad Optics' }];
      expect(endpoint).toBe('/api/v1/orgs/org-1/alarms/search');
      expect(opts.params.start).toBe(Math.floor(since.getTime() / 1000));
      return {
        results: [
          {
            id: 'a1', type: 'sw_bad_optics', group: 'infrastructure', severity: 'warn', timestamp: 1761130000,
            last_seen: 1761130600, count: 3, switches: ['d420b02000fa'], hostnames: ['EX-1'],
            reasons: ['xe-0/1/0 rx power low'], port_ids: ['xe-0/1/0'], site_id: 's1',
          },
          { id: 'a2', type: 'switch_down', group: 'infrastructure', severity: 'warn', timestamp: 1761130000 },
          { id: 'a3', type: 'rogue_ap', group: 'security', severity: 'warn', timestamp: 1761130000 },
          {
            id: 'a4', type: 'bad_cable', group: 'marvis', severity: 'critical', timestamp: 1761130000,
            status: 'resolved', resolved_time: 1761133600, switches: ['d420b02000fb'],
          },
        ],
      };
    });

    const { alarms, activeIds } = await provider.listAlarms({ since });
    expect(activeIds).toBeNull();
    expect(alarms.map((a) => a.externalId)).toEqual(['a1', 'a4']);
    expect(alarms[0]).toMatchObject({
      name: 'Switch Bad Optics', severity: 'warning', stateful: false, status: 'event', count: 3,
      macs: ['d4:20:b0:20:00:fa'], hostnames: ['EX-1'], summary: 'xe-0/1/0 rx power low',
      raisedAt: new Date(1761130000 * 1000), lastSeenAt: new Date(1761130600 * 1000),
      data: { siteId: 's1', ports: ['xe-0/1/0'] },
    });
    expect(alarms[1]).toMatchObject({
      name: 'Bad cable', severity: 'critical', stateful: true, status: 'cleared', clearedAt: new Date(1761133600 * 1000),
    });
    request.mockRestore();
  });
});

describe('ArubaCentralProvider.listAlarms', () => {
  const provider = new ArubaCentralProvider({
    id: 'int-c', provider: 'aruba_central', name: 'Central', baseUrl: 'https://central.example.com',
    credentials: { clientId: 'id', clientSecret: 'secret' },
  });

  const alert = (id, extra) => ({
    id, key: `k-${id}`, name: 'OSPF Peer Down', category: 'Routing', deviceType: 'Switch', severity: 'Major',
    priority: 'High', status: 'Active', summary: 'OSPF peer 10.0.0.2 on Sw-Core is down', createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '', clearedReason: '', siteName: 'HQ', ...extra,
  });

  test('active set plus a newest-first sweep back to since; offline alerts left out', async () => {
    const makeRequest = jest.spyOn(provider, 'makeRequest').mockImplementation(async (method, endpoint, { params }) => {
      expect(endpoint).toBe('/network-notifications/v1/alerts');
      if (params.filter) {
        return { items: [alert('c1'), alert('c9', { name: 'Gateway Offline', category: 'System', severity: 'Critical' })], next: null };
      }
      return {
        items: [
          alert('c1'),
          alert('c2', {
            status: 'Cleared', createdAt: '2026-10-20T12:00:00.000Z', updatedAt: '2026-10-20T12:30:00.000Z',
            clearedReason: 'Due to clear alert timer configuration',
          }),
          alert('c3', { status: 'Cleared', createdAt: '2026-10-19T12:00:00.000Z' }),
        ],
        next: 'cursor-2',
      };
    });

    const { alarms, activeIds } = await provider.listAlarms({ since });
    // The sweep stopped at the page holding an alert older than `since`.
    expect(makeRequest.mock.calls.filter(([, , o]) => !o.params.filter)).toHaveLength(1);
    expect(activeIds).toEqual(['c1']);
    expect(alarms.map((a) => a.externalId).sort()).toEqual(['c1', 'c2']);
    const c2 = alarms.find((a) => a.externalId === 'c2');
    expect(c2).toMatchObject({
      stateful: true, status: 'cleared', severity: 'warning', siteName: 'HQ',
      clearedAt: new Date('2026-10-20T12:30:00Z'), clearedReason: 'Due to clear alert timer configuration',
      data: { key: 'k-c2', priority: 'High', deviceType: 'Switch' },
    });
    expect(alarms.find((a) => a.externalId === 'c1')).toMatchObject({ status: 'active', clearedAt: null, clearedReason: null });
    makeRequest.mockRestore();
  });

  test('both providers advertise the capability', () => {
    expect(provider.supports('alarms')).toBe(true);
  });
});
