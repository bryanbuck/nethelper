'use strict';

/**
 * Port Identity: which sources a client read of a switch would try. Pure;
 * shared by the collector (port-client.service.js), the Ports view and the
 * "Read now" route.
 */

const { resolveTransport } = require('../../utils/transport-router');
const { isCxRestCapable, detectPlatform } = require('../../utils/device-platform');

/**
 * What a client read of this switch would try, and why a source can't be.
 * Shared by the collector, the Ports view and "Read now".
 * @param device         Device row (type, vendor, platform, model, managementMode, ipAddress)
 * @param hasCredential  a device credential is linked
 * @returns {{ supported: boolean, platform: string|null, sources: { source, ready, note }[] }}
 */
function clientSourcePlan(device, { hasCredential = false } = {}) {
  const transports = resolveTransport(device, 'clients');
  const platform = detectPlatform(device) || null;
  if (!transports.length) return { supported: false, platform, sources: [] };
  const sources = [];
  if (transports.includes('device-rest')) {
    let note = null;
    if (!isCxRestCapable(device)) note = `no client-table reader for platform "${platform || 'unknown'}" yet`;
    else if (!device.ipAddress || !hasCredential) note = 'needs an IP address and a linked device credential';
    sources.push({ source: 'device-rest', ready: !note, note });
  }
  if (transports.includes('cloud')) sources.push({ source: 'cloud', ready: true, note: null });
  return { supported: true, platform, sources };
}

module.exports = { clientSourcePlan };
