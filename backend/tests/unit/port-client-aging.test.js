/**
 * Port Identity: how wired-client sightings age (services/ports/client-aging.js).
 */
const {
  normalizeObservations, summarizePorts, applyRead, linkDownUpdates, movedUpdates,
  derivePortKind, clientFreshness, DEFAULTS,
} = require('../../src/services/ports/client-aging');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (ms) => new Date(NOW.getTime() - ms);
const MAC_A = 'aa:aa:aa:00:00:01';
const MAC_B = 'bb:bb:bb:00:00:02';

function row(over = {}) {
  return {
    id: over.id || 'r1',
    deviceId: 'd1',
    port: '1/1/1',
    portLabel: '1/1/1',
    mac: MAC_A,
    ip: null,
    hostname: null,
    vendor: null,
    vlan: 10,
    sources: ['mac-table'],
    lldp: null,
    state: 'present',
    missedReads: 0,
    firstSeen: ago(DAY),
    lastSeen: ago(30 * 60 * 1000),
    goneAt: null,
    goneReason: null,
    goneDetail: null,
    ...over,
  };
}
const obs = (over = {}) => ({ port: '1/1/1', portLabel: '1/1/1', mac: MAC_A, vlan: 10, sources: ['mac-table'], ...over });

describe('normalizeObservations', () => {
  it('normalizes port and MAC, merges duplicates and their sources, drops unusable entries', () => {
    const out = normalizeObservations([
      { port: '1/1/1', mac: 'AA-AA-AA-00-00-01', source: 'mac-table', vlan: 10 },
      { port: '1/1/1', mac: 'aaaa.aa00.0001', source: 'cloud-wired', hostname: 'printer-214' },
      { port: '', mac: MAC_B },
      { port: '1/1/2', mac: '10.0.0.1' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ port: '1/1/1', mac: MAC_A, vlan: 10, hostname: 'printer-214', sources: ['cloud-wired', 'mac-table'] });
  });
});

describe('summarizePorts', () => {
  it('keeps only a count for uplinks and ports over the per-port cap', () => {
    const many = Array.from({ length: DEFAULTS.maxPerPort + 1 }, (_, i) => obs({ port: '1/1/48', mac: `cc:cc:cc:00:00:${String(i).padStart(2, '0')}` }));
    const observed = normalizeObservations([obs(), obs({ port: '1/1/49', mac: MAC_B }), ...many]);
    const { clients, summary } = summarizePorts(observed, { uplinkPorts: new Set(['1/1/49']) });
    expect(clients.map((c) => c.port)).toEqual(['1/1/1']);
    expect(summary['1/1/48']).toMatchObject({ uplink: true, macCount: DEFAULTS.maxPerPort + 1 });
    expect(summary['1/1/49']).toMatchObject({ uplink: true, macCount: 1 });
  });

  it('keeps only the AP on an AP port and counts what is bridged behind it', () => {
    const observed = normalizeObservations([obs({ port: '1/1/5', mac: MAC_A }), obs({ port: '1/1/5', mac: MAC_B })]);
    const { clients, summary } = summarizePorts(observed, { apPorts: new Map([['1/1/5', MAC_A]]) });
    expect(clients.map((c) => c.mac)).toEqual([MAC_A]);
    expect(summary['1/1/5']).toEqual({ macCount: 2, uplink: false, ap: MAC_A });
  });

  it('records link state for ports with no clients', () => {
    const { summary } = summarizePorts([], { linkUp: new Map([['1/1/7', false]]) });
    expect(summary['1/1/7']).toEqual({ macCount: 0, uplink: false, linkUp: false });
  });
});

describe('applyRead', () => {
  const opts = { readAt: NOW };

  it('creates a new sighting as present', () => {
    const { create, update, touch } = applyRead([], [obs({ hostname: 'pc-1' })], opts);
    expect(create).toEqual([expect.objectContaining({ mac: MAC_A, state: 'present', firstSeen: NOW, lastSeen: NOW, hostname: 'pc-1' })]);
    expect(update).toEqual([]);
    expect(touch).toEqual([]);
  });

  it('only touches a row that is listed again unchanged', () => {
    const { create, update, touch } = applyRead([row()], [obs()], opts);
    expect(create).toEqual([]);
    expect(update).toEqual([]);
    expect(touch).toEqual(['r1']);
  });

  it('updates changed fields and keeps known ones a source did not report', () => {
    const { update } = applyRead([row({ hostname: 'old', ip: '10.0.0.5' })], [obs({ hostname: 'new', sources: ['cloud-wired'] })], opts);
    expect(update).toEqual([{ id: 'r1', data: { hostname: 'new', sources: ['cloud-wired', 'mac-table'], lastSeen: NOW } }]);
  });

  it('brings a gone or unconfirmed client back to present', () => {
    const goneRow = row({ state: 'gone', goneAt: ago(DAY), goneReason: 'omitted', missedReads: 4 });
    const { update } = applyRead([goneRow], [obs()], opts);
    expect(update[0].data).toMatchObject({ state: 'present', missedReads: 0, goneAt: null, goneReason: null, lastSeen: NOW });
  });

  it('one miss with the port up only counts the miss', () => {
    const { update } = applyRead([row()], [], opts);
    expect(update).toEqual([{ id: 'r1', data: { missedReads: 1 } }]);
  });

  it('becomes unconfirmed at the miss limit and gone (omitted) at twice it', () => {
    expect(applyRead([row({ missedReads: 1 })], [], opts).update[0].data).toEqual({ state: 'unconfirmed', missedReads: 2 });
    expect(applyRead([row({ state: 'unconfirmed', missedReads: 3 })], [], opts).update[0].data)
      .toEqual({ state: 'gone', goneAt: NOW, goneReason: 'omitted', goneDetail: null, missedReads: 4 });
  });

  it('honours a custom miss limit', () => {
    expect(applyRead([row()], [], { ...opts, missLimit: 1 }).update[0].data).toEqual({ state: 'unconfirmed', missedReads: 1 });
  });

  it('is gone at once when the port is down', () => {
    const { update } = applyRead([row()], [], { ...opts, linkUp: new Map([['1/1/1', false]]) });
    expect(update[0].data).toMatchObject({ state: 'gone', goneReason: 'link-down', goneAt: NOW });
  });

  it('is gone (port-reassigned) when another MAC takes a static port', () => {
    const { update, create } = applyRead([row()], [obs({ mac: MAC_B })], { ...opts, staticPorts: new Set(['1/1/1']) });
    expect(create).toHaveLength(1);
    expect(update).toEqual([{ id: 'r1', data: expect.objectContaining({ state: 'gone', goneReason: 'port-reassigned' }) }]);
  });

  it('only counts a miss when another MAC appears on a port that is not static', () => {
    const { update } = applyRead([row()], [obs({ mac: MAC_B })], opts);
    expect(update).toEqual([{ id: 'r1', data: { missedReads: 1 } }]);
  });

  it('leaves gone rows and skipped (uplink) ports alone', () => {
    const rows = [row({ id: 'g', state: 'gone', goneReason: 'omitted' }), row({ id: 'u', port: '1/1/49', mac: MAC_B })];
    const { update, touch } = applyRead(rows, [], { ...opts, skipPorts: new Set(['1/1/49']) });
    expect(update).toEqual([]);
    expect(touch).toEqual([]);
  });
});

describe('linkDownUpdates and movedUpdates', () => {
  it('ends every live sighting on the port that went down', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', port: '1/1/2' }), row({ id: 'c', state: 'gone' })];
    expect(linkDownUpdates(rows, '1/1/1', NOW)).toEqual([{ id: 'a', data: { state: 'gone', goneAt: NOW, goneReason: 'link-down', goneDetail: null } }]);
  });

  it('normalizes the event port name', () => {
    const rows = [row({ id: 'a', port: 'ge-0/0/1' })];
    expect(linkDownUpdates(rows, 'GE-0/0/1', NOW)).toHaveLength(1);
  });

  it('marks the MAC moved everywhere but its new port', () => {
    const rows = [row({ id: 'old', deviceId: 'd1', port: '1/1/1' }), row({ id: 'here', deviceId: 'd2', port: '1/1/3' })];
    expect(movedUpdates(rows, { deviceId: 'd2', port: '1/1/3' }, NOW))
      .toEqual([{ id: 'old', data: { state: 'gone', goneAt: NOW, goneReason: 'moved', goneDetail: { deviceId: 'd2', port: '1/1/3' } } }]);
  });
});

describe('derivePortKind', () => {
  const base = { now: NOW };

  it('takes a user override first', () => {
    expect(derivePortKind({ ...base, note: { kind: 'dynamic' }, summary: { uplink: true } })).toMatchObject({ kind: 'dynamic', source: 'note' });
  });

  it('uplink and AP ports from the read summary', () => {
    expect(derivePortKind({ ...base, summary: { uplink: true, macCount: 40 } }).kind).toBe('uplink');
    expect(derivePortKind({ ...base, summary: { ap: MAC_A } }).kind).toBe('ap');
  });

  it('static after one client for the static period', () => {
    expect(derivePortKind({ ...base, clients: [row({ firstSeen: ago(8 * DAY), lastSeen: ago(60000) })] }).kind).toBe('static');
    expect(derivePortKind({ ...base, clients: [row({ firstSeen: ago(2 * DAY), lastSeen: ago(60000) })] }).kind).toBe('new');
  });

  it('dynamic with several clients in the window', () => {
    const clients = [MAC_A, MAC_B, 'cc:cc:cc:00:00:03'].map((mac, i) => row({ id: `r${i}`, mac, state: i ? 'gone' : 'present', lastSeen: ago(i * DAY) }));
    expect(derivePortKind({ ...base, clients }).kind).toBe('dynamic');
  });

  it('unused only after being watched for the whole period', () => {
    const old = [row({ state: 'gone', lastSeen: ago(40 * DAY) })];
    expect(derivePortKind({ ...base, clients: old, observingSince: ago(60 * DAY) }).kind).toBe('unused');
    expect(derivePortKind({ ...base, clients: old, observingSince: ago(5 * DAY) }).kind).toBe('idle');
    expect(derivePortKind({ ...base, clients: [], observingSince: ago(60 * DAY), summary: { linkUp: true } }).kind).toBe('idle');
  });
});

describe('clientFreshness', () => {
  const intervalMs = 30 * 60 * 1000;

  it('confirmed while the last good read is recent', () => {
    expect(clientFreshness(row(), { lastSuccessAt: ago(10 * 60 * 1000), intervalMs, now: NOW }).freshness).toBe('confirmed');
  });

  it('stale once reads have failed for twice the interval, whatever the row says', () => {
    const f = clientFreshness(row(), { lastSuccessAt: ago(3 * intervalMs), intervalMs, now: NOW });
    expect(f).toEqual({ freshness: 'stale', since: ago(3 * intervalMs) });
    expect(clientFreshness(row(), { lastSuccessAt: null, intervalMs, now: NOW }).freshness).toBe('stale');
  });

  it('unconfirmed and gone pass through', () => {
    expect(clientFreshness(row({ state: 'unconfirmed' }), { lastSuccessAt: NOW, intervalMs, now: NOW }).freshness).toBe('unconfirmed');
    expect(clientFreshness(row({ state: 'gone', goneAt: ago(DAY) }), { lastSuccessAt: NOW, intervalMs, now: NOW }))
      .toEqual({ freshness: 'gone', since: ago(DAY) });
  });
});
