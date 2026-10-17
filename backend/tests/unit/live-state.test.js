/**
 * Live port state: AOS-CX parsing (device-api/cx-live.js) and the
 * platform-neutral diff/rate helpers (services/live/port-state.js).
 *
 * Fixtures in tests/fixtures/aos-cx-live/ are trimmed real captures from a
 * 6200F on ML.10.16.1010 (port descriptions anonymised). The notification
 * fixture is a cable pull and replug of a PoE desk phone on 1/1/4.
 */
const cxLive = require('../../src/services/device-api/cx-live');
const { mergePort, diffPort, diffSnapshots, computeRates } = require('../../src/services/live/port-state');

const interfaces = require('../fixtures/aos-cx-live/interfaces-state.json');
const poe = require('../fixtures/aos-cx-live/poe-interfaces.json');
const counters = require('../fixtures/aos-cx-live/interface-counters.json');
const unplug = require('../fixtures/aos-cx-live/notifications-unplug.json');

const baseline = () => cxLive.normalizePortState(interfaces, poe);

describe('cx-live normalizePortState', () => {
  test('keeps physical ports only, in natural order', () => {
    const ports = baseline();
    expect(ports).toHaveLength(16);
    expect(ports.map((p) => p.port).slice(0, 3)).toEqual(['1/1/1', '1/1/2', '1/1/3']);
    expect(ports.map((p) => p.port)).not.toContain('lag1');
    expect(ports.map((p) => p.port)).not.toContain('vlan1');
    expect(ports[ports.length - 1].port).toBe('1/1/16');
  });

  test('reads link, admin (from user_config), and PoE through the wildcard nesting', () => {
    const phone = baseline().find((p) => p.port === '1/1/4');
    expect(phone).toEqual({
      port: '1/1/4',
      description: 'Desk phone',
      adminUp: true,
      linkUp: true,
      speedMbps: 1000,
      duplex: 'full',
      poe: { status: 'delivering', pdType: 'Type1', pdClass: 'Class2', powerW: expect.any(Number) },
    });
  });

  test('ports without PoE hardware have poe: null', () => {
    const sfp = baseline().find((p) => p.port === '1/1/16');
    expect(sfp.poe).toBeNull();
  });

  test('a down port has no speed', () => {
    const down = baseline().find((p) => p.port === '1/1/2');
    expect(down.linkUp).toBe(false);
    expect(down.speedMbps).toBeNull();
  });
});

describe('cx-live parseNotification', () => {
  test('the subscribe ack carries per-topic starting sequence numbers', () => {
    const { type, sequences } = cxLive.parseNotification(unplug[0].frame);
    expect(type).toBe('success');
    expect(sequences.length).toBeGreaterThan(0);
    expect(sequences.every((s) => s.seq === 1)).toBe(true);
  });

  test('a PoE frame carries only the changed attribute', () => {
    const { updates } = cxLive.parseNotification(unplug[1].frame);
    expect(updates).toEqual([{ port: '1/1/4', operation: 'modified', poe: { pdType: null } }]);
  });

  test('collection-topic resources arrive without values; the per-port topic has them', () => {
    const linkDown = unplug.find((f) => f.atSeconds > 223 && f.atSeconds < 224).frame;
    const { updates } = cxLive.parseNotification(linkDown);
    const withValues = updates.filter((u) => u.link);
    expect(withValues).toEqual([
      { port: '1/1/4', operation: 'modified', link: { linkUp: false, speedMbps: null } },
    ]);
  });
});

describe('cx-live normalizeCounters', () => {
  test('physical ports only; forwarding-engine discards are not errors', () => {
    const out = cxLive.normalizeCounters(counters);
    expect(Object.keys(out).sort()).toEqual(['1/1/1', '1/1/4', '1/1/5']);
    expect(counters['1/1/4'].statistics.fe_if_in_discard_packets).toBeGreaterThan(0);
    expect(out['1/1/4'].errors).toBe(0);
    expect(out['1/1/4'].rxBytes).toBe(counters['1/1/4'].statistics.rx_bytes);
  });
});

describe('port-state diff', () => {
  test('replaying the captured unplug/replug yields the raw transitions in order', () => {
    const ports = new Map(baseline().map((p) => [p.port, p]));
    const events = [];
    for (const { frame } of unplug.slice(1)) {
      for (const update of cxLive.parseNotification(frame).updates) {
        const before = ports.get(update.port);
        const after = mergePort(before, update);
        ports.set(update.port, after);
        events.push(...diffPort(before, after).map((e) => e.type));
      }
    }
    // The phone drops power then link; on replug PoE delivers ~8s before the
    // link comes up, and the link bounces once while the phone boots. Raw
    // events are recorded as-is; debouncing is the trigger layer's job.
    expect(events).toEqual([
      'port.poe.down',
      'port.link.down',
      'port.poe.up',
      'port.link.up',
      'port.link.down',
      'port.link.up',
    ]);
  });

  test('admin changes and PoE faults', () => {
    const port = { port: '1/1/9', adminUp: true, linkUp: false, poe: { status: 'searching' } };
    expect(diffPort(port, { ...port, adminUp: false }).map((e) => e.type)).toEqual(['port.admin.down']);
    expect(diffPort(port, { ...port, poe: { status: 'fault' } }).map((e) => e.type)).toEqual(['port.poe.fault']);
    expect(diffPort(port, { ...port, poe: { status: 'disabled' } })).toEqual([]);
    const faulted = { ...port, poe: { status: 'fault' } };
    expect(diffPort(faulted, { ...port, poe: { status: 'searching' } }).map((e) => e.type)).toEqual(['port.poe.down']);
  });

  test('snapshot diff ignores ports that appear or disappear', () => {
    const before = [{ port: 'a', linkUp: true }, { port: 'b', linkUp: true }];
    const after = [{ port: 'a', linkUp: false }, { port: 'c', linkUp: true }];
    expect(diffSnapshots(before, after).map((e) => `${e.port}:${e.type}`)).toEqual(['a:port.link.down']);
  });
});

describe('computeRates', () => {
  const sample = (rx, tx, errors = 0) => ({ p: { rxBytes: rx, txBytes: tx, rxPackets: rx / 100, txPackets: tx / 100, errors } });

  test('bits per second from byte deltas', () => {
    const rates = computeRates(sample(1000, 5000), sample(2000, 25000), 10);
    expect(rates.p.rxBps).toBe(800);
    expect(rates.p.txBps).toBe(16000);
    expect(rates.p.newErrors).toBe(0);
  });

  test('no rates on the first sample', () => {
    expect(computeRates(null, sample(1, 1), 10)).toEqual({});
  });

  test('a counter reset yields null, not a negative rate', () => {
    const rates = computeRates(sample(5000, 5000, 3), sample(100, 6000, 0), 10);
    expect(rates.p.rxBps).toBeNull();
    expect(rates.p.txBps).toBe(800);
    expect(rates.p.newErrors).toBeNull();
  });
});
