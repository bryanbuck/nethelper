/**
 * The HTTP Request step's outbound call.
 *
 * An operator chooses the URL and the run history shows part of the answer,
 * so the request must not become a way to read services on the NetHelper host
 * itself: loopback, link-local (cloud metadata at 169.254.169.254) and
 * unspecified addresses are refused. The check is made on the address the
 * socket actually connects to (the agent's DNS lookup), so a name that
 * resolves to one of them is refused too. Private LAN addresses are allowed:
 * that is where a ticketing system or a home-automation hook usually lives.
 * Redirects are not followed, and only the start of the answer is kept.
 */

const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const axios = require('axios');

const TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const BODY_KEPT_CHARS = 500;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const blocked = new net.BlockList();
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addAddress('::1', 'ipv6');
blocked.addAddress('::', 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

function isBlockedAddress(address) {
  const family = net.isIP(address);
  if (!family) return false;
  if (family === 6) {
    // An IPv4 address written as IPv6 (::ffff:127.0.0.1) is judged as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
  }
  return blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function refusal(host) {
  const error = new Error(`${host} is an address on the NetHelper host itself (loopback or link-local), which an automation may not call`);
  error.code = 'ADDRESS_REFUSED';
  return error;
}

/** dns.lookup that fails when any answer is a refused address. */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const addresses = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (addresses.some(isBlockedAddress)) return callback(refusal(hostname));
    return callback(null, address, family);
  });
}

const httpAgent = new http.Agent({ lookup: guardedLookup });
const httpsAgent = new https.Agent({ lookup: guardedLookup });

/** Parse and check a URL an automation may call. Throws with a readable message. */
function checkUrl(value) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error('the URL is not a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('the URL must start with https:// or http://');
  if (url.username || url.password) throw new Error('put credentials in a header, not in the URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || isBlockedAddress(host)) throw refusal(host);
  return url;
}

/**
 * Make the request. Resolves { status, ok, durationMs, body } for any HTTP
 * answer; throws when no answer came (unreachable, timeout, refused address).
 * `body` is the first BODY_KEPT_CHARS characters of a text answer.
 */
async function request({ method, url, headers = {}, body }) {
  const target = checkUrl(url);
  const started = Date.now();
  let response;
  try {
    response = await axios.request({
      method,
      url: target.toString(),
      headers,
      data: body,
      timeout: TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      responseType: 'text',
      transformResponse: (data) => data,
      validateStatus: () => true,
      proxy: false,
      httpAgent,
      httpsAgent,
    });
  } catch (error) {
    if (error.code === 'ADDRESS_REFUSED' || error.cause?.code === 'ADDRESS_REFUSED') throw refusal(target.hostname);
    throw new Error(`No answer from ${target.host} (${error.code || error.message})`);
  }
  const text = typeof response.data === 'string' ? response.data : '';
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    durationMs: Date.now() - started,
    body: text.length > BODY_KEPT_CHARS ? `${text.slice(0, BODY_KEPT_CHARS)}…` : text,
  };
}

module.exports = { request, checkUrl, isBlockedAddress, METHODS, TIMEOUT_MS };
