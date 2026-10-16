/**
 * Platform-neutral port state helpers (pure functions, no I/O).
 *
 * A port snapshot is the normalized shape produced by a device API's
 * getPortState():
 *   { port, description, adminUp, linkUp, speedMbps, duplex,
 *     poe: null | { status, pdType, pdClass, powerW } }
 *
 * Events are raw transitions. Nothing here debounces: a PoE device
 * booting commonly bounces its link once or twice, and every bounce is
 * recorded. Consumers that act on events (automation triggers, a later
 * phase) are expected to apply their own settle time.
 */

const POE_FAULT = /fault|denied|error|overload|short/i;

/** Apply a partial update ({ link?, poe? }) to a port snapshot. Returns a new object. */
function mergePort(port, update) {
  const next = { ...port, ...(update.link || {}) };
  if (update.poe) next.poe = { status: null, pdType: null, pdClass: null, powerW: null, ...(port.poe || {}), ...update.poe };
  return next;
}

function poeEvent(before, after) {
  const was = before?.status || null;
  const now = after?.status || null;
  if (was === now) return null;
  if (now === 'delivering') return 'port.poe.up';
  if (now && POE_FAULT.test(now)) return 'port.poe.fault';
  if (was === 'delivering') return 'port.poe.down';
  return null; // e.g. disabled -> searching: not interesting on its own
}

/**
 * Transitions between two snapshots of the same port.
 * @returns {Array<{ type, port, data }>}
 */
function diffPort(before, after) {
  const events = [];
  const port = after.port;
  if (before.adminUp !== after.adminUp && typeof after.adminUp === 'boolean') {
    events.push({ type: after.adminUp ? 'port.admin.up' : 'port.admin.down', port, data: {} });
  }
  if (before.linkUp !== after.linkUp && typeof after.linkUp === 'boolean') {
    events.push({
      type: after.linkUp ? 'port.link.up' : 'port.link.down',
      port,
      data: after.linkUp ? { speedMbps: after.speedMbps ?? null } : {},
    });
  }
  const poeType = poeEvent(before.poe, after.poe);
  if (poeType) {
    events.push({
      type: poeType,
      port,
      data: { status: after.poe?.status || null, pdClass: after.poe?.pdClass || null, pdType: after.poe?.pdType || null },
    });
  }
  return events;
}

/**
 * Events between two full snapshots (arrays of ports). Ports present in only
 * one snapshot produce no events; the next resync simply adopts them.
 */
function diffSnapshots(before = [], after = []) {
  const prev = new Map(before.map((p) => [p.port, p]));
  return after.flatMap((port) => (prev.has(port.port) ? diffPort(prev.get(port.port), port) : []));
}

/**
 * Per-port rates from two counter samples taken dtSeconds apart. A counter
 * that went backwards (cleared, or the device rebooted) yields null for that
 * sample rather than a negative or absurd rate.
 */
function computeRates(previous, current, dtSeconds) {
  const out = {};
  if (!previous || !(dtSeconds > 0)) return out;
  const rate = (a, b) => (typeof a === 'number' && typeof b === 'number' && b >= a ? (b - a) / dtSeconds : null);
  for (const [port, now] of Object.entries(current)) {
    const was = previous[port];
    if (!was) continue;
    const rx = rate(was.rxBytes, now.rxBytes);
    const tx = rate(was.txBytes, now.txBytes);
    const errors = typeof was.errors === 'number' && now.errors >= was.errors ? now.errors - was.errors : null;
    out[port] = {
      rxBps: rx === null ? null : Math.round(rx * 8),
      txBps: tx === null ? null : Math.round(tx * 8),
      rxPps: rate(was.rxPackets, now.rxPackets),
      txPps: rate(was.txPackets, now.txPackets),
      newErrors: errors,
    };
  }
  return out;
}

module.exports = { mergePort, diffPort, diffSnapshots, computeRates };
