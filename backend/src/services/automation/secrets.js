/**
 * Secrets inside an automation's builder graph (Automation.elements).
 *
 * Today that is one thing: the header values of HTTP Request steps (an
 * Authorization token, an API key). They are field-encrypted at rest, the API
 * returns them as '***', and a '***' sent back on a write keeps the stored
 * value of the same header on the same node. A masked value with nothing
 * stored behind it (a duplicated automation, a renamed header) is saved
 * empty, and the step then refuses to run until the value is entered again.
 *
 * Everything that returns elements to a client goes through maskElements;
 * every write goes through protectElements. scripts/rotate-encryption-key.js
 * rotates these values with rotateElements.
 */

const encryption = require('../../utils/encryption');

const SECRET_MASK = '***';
const PREFIX = 'enc:'; // marks a stored (encrypted) header value

const isHttpNode = (el) => el && el.type === 'action' && el.data?.actionType === 'http-request';
const isStored = (value) => typeof value === 'string' && value.startsWith(PREFIX);
const headerList = (node) => (Array.isArray(node.data?.config?.headers) ? node.data.config.headers : []);

/** Copy of elements with each HTTP Request node's headers replaced by fn(headers, node). */
function mapHeaders(elements, fn) {
  if (!Array.isArray(elements)) return elements;
  return elements.map((el) => {
    if (!isHttpNode(el) || !el.data.config) return el;
    return { ...el, data: { ...el.data, config: { ...el.data.config, headers: fn(headerList(el), el) } } };
  });
}

/** Elements as stored: header values encrypted, masked ones taken from `previous` (the stored graph). */
function protectElements(elements, previous = []) {
  const stored = new Map((Array.isArray(previous) ? previous : []).filter(isHttpNode).map((n) => [n.id, headerList(n)]));
  return mapHeaders(elements, (headers, node) => headers
    .filter((h) => h && String(h.name || '').trim())
    .map((h) => {
      const name = String(h.name).trim();
      const value = h.value == null ? '' : String(h.value);
      if (value === SECRET_MASK || isStored(value)) {
        // Never trust a ciphertext from the client: only the stored one counts.
        const kept = (stored.get(node.id) || []).find((p) => p.name.toLowerCase() === name.toLowerCase());
        return { name, value: kept && isStored(kept.value) ? kept.value : '' };
      }
      return { name, value: value ? PREFIX + encryption.encrypt(value) : '' };
    }));
}

/** Elements as the API returns them: stored header values shown as '***'. */
function maskElements(elements) {
  return mapHeaders(elements, (headers) => headers.map((h) => ({ name: h.name, value: h.value ? SECRET_MASK : '' })));
}

/** An automation row (or any object carrying `elements`) with its graph masked. */
function maskAutomation(row) {
  return row && Array.isArray(row.elements) ? { ...row, elements: maskElements(row.elements) } : row;
}

/** Headers a step sends: { name: plain value }. Throws when a value was never stored. */
function revealHeaders(headers) {
  const out = {};
  for (const h of Array.isArray(headers) ? headers : []) {
    if (!isStored(h.value)) throw new Error(`Header "${h.name}" has no stored value; enter it again`);
    out[h.name] = encryption.decrypt(h.value.slice(PREFIX.length));
  }
  return out;
}

/**
 * Key rotation: every stored header value through rotate(ciphertext, label)
 * -> new ciphertext, or null to leave it. Returns the new elements, or null
 * when nothing changed.
 */
function rotateElements(elements, rotate) {
  let changed = false;
  const next = mapHeaders(elements, (headers, node) => headers.map((h) => {
    if (!isStored(h.value)) return h;
    const value = rotate(h.value.slice(PREFIX.length), `node ${node.id} header ${h.name}`);
    if (value == null) return h;
    changed = true;
    return { ...h, value: PREFIX + value };
  }));
  return changed ? next : null;
}

module.exports = { SECRET_MASK, isStored, protectElements, maskElements, maskAutomation, revealHeaders, rotateElements };
