/**
 * Reconcile one device's freshly collected neighbor table against its stored
 * DeviceLink rows. Pure: returns what to write, writes nothing.
 *
 * - A neighbor seen again refreshes its row (lastSeen, details).
 * - A new neighbor is created; one seen before but inactive is reactivated.
 * - A stored active link missing from the table is deactivated (never deleted,
 *   so history and firstSeen survive a flapping link).
 * - On the same local port, a removal plus an addition is one `link.changed`
 *   (something else is plugged in there now), not two events.
 *
 * Only call this for a *successful* collection: a failed or unsupported read
 * must not deactivate anything.
 */

const linkKey = (localPort, chassisId, portId) => `${localPort}|${chassisId}|${portId}`;

function rowFields(neighbor) {
  return {
    remoteSysName: neighbor.sysName,
    remoteSysDesc: neighbor.sysDesc,
    remotePortDesc: neighbor.portDesc,
    remoteMgmtIp: neighbor.mgmtIp,
    remoteMac: neighbor.mac,
    remoteCapabilities: neighbor.capabilities || [],
    source: neighbor.protocol || 'lldp',
  };
}

function remoteSummary(link) {
  return {
    chassisId: link.remoteChassisId,
    portId: link.remotePortId,
    sysName: link.remoteSysName || null,
    mgmtIp: link.remoteMgmtIp || null,
  };
}

/**
 * @param {Object[]} existing - all DeviceLink rows for the device (active or not)
 * @param {Object[]} neighbors - normalized neighbors from a successful collection
 * @param {{ now?: Date, initial?: boolean }} options - initial: first ever
 *   collection for the device, which records no changes (everything would be "added")
 * @returns {{ creates: Object[], updates: {id, data}[], changes: {type, localPort, data}[] }}
 */
function reconcileLinks(existing, neighbors, { now = new Date(), initial = false } = {}) {
  const byKey = new Map(existing.map((row) => [linkKey(row.localPort, row.remoteChassisId, row.remotePortId), row]));
  const fresh = new Map();
  for (const n of neighbors) {
    const key = linkKey(n.localPort, n.chassisId, n.portId);
    if (!fresh.has(key)) fresh.set(key, n);
  }

  const creates = [];
  const updates = [];
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, n] of fresh) {
    const row = byKey.get(key);
    const remote = {
      remoteChassisId: n.chassisId, remotePortId: n.portId, remoteSysName: n.sysName, remoteMgmtIp: n.mgmtIp,
    };
    if (!row) {
      creates.push({
        localPort: n.localPort,
        remoteChassisId: n.chassisId,
        remotePortId: n.portId,
        ...rowFields(n),
        active: true,
        firstSeen: now,
        lastSeen: now,
      });
      added.push({ localPort: n.localPort, remote });
      continue;
    }
    updates.push({ id: row.id, data: { ...rowFields(n), active: true, lastSeen: now } });
    if (!row.active) {
      added.push({ localPort: n.localPort, remote });
    } else if ((row.remoteSysName || null) !== (n.sysName || null)) {
      changed.push({
        localPort: n.localPort,
        before: remoteSummary(row),
        after: remoteSummary(remote),
      });
    }
  }

  for (const [key, row] of byKey) {
    if (!row.active || fresh.has(key)) continue;
    updates.push({ id: row.id, data: { active: false } });
    removed.push({ localPort: row.localPort, remote: row });
  }

  const changes = [];
  if (!initial) {
    // Pair a removal with an addition on the same port into one link.changed.
    const addedByPort = new Map();
    for (const a of added) {
      if (!addedByPort.has(a.localPort)) addedByPort.set(a.localPort, []);
      addedByPort.get(a.localPort).push(a);
    }
    for (const r of removed) {
      const candidates = addedByPort.get(r.localPort);
      if (candidates && candidates.length) {
        const a = candidates.shift();
        changes.push({
          type: 'link.changed',
          localPort: r.localPort,
          data: { before: remoteSummary(r.remote), after: remoteSummary(a.remote) },
        });
      } else {
        changes.push({ type: 'link.removed', localPort: r.localPort, data: { remote: remoteSummary(r.remote) } });
      }
    }
    for (const list of addedByPort.values()) {
      for (const a of list) {
        changes.push({ type: 'link.added', localPort: a.localPort, data: { remote: remoteSummary(a.remote) } });
      }
    }
    for (const c of changed) {
      changes.push({ type: 'link.changed', localPort: c.localPort, data: { before: c.before, after: c.after } });
    }
  }

  return { creates, updates, changes };
}

module.exports = { reconcileLinks, linkKey };
