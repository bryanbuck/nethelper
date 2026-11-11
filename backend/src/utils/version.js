/**
 * Release version ordering for the update check: x.y.z with an optional
 * pre-release suffix (0.9.1-beta.2), following semver precedence. A leading
 * "v" (a tag name) and build metadata (+...) are ignored.
 */

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(String(value || '').trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

function compareIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Math.sign(Number(a) - Number(b));
  if (aNum) return -1; // numeric identifiers sort before alphanumeric ones
  if (bNum) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** -1, 0 or 1; null when either side isn't a version. */
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  // A release sorts after its own pre-releases.
  if (!left.pre.length || !right.pre.length) {
    if (left.pre.length === right.pre.length) return 0;
    return left.pre.length ? -1 : 1;
  }
  const shared = Math.min(left.pre.length, right.pre.length);
  for (let i = 0; i < shared; i += 1) {
    const order = compareIdentifiers(left.pre[i], right.pre[i]);
    if (order) return order;
  }
  return Math.sign(left.pre.length - right.pre.length);
}

function isPrerelease(value) {
  const parsed = parseVersion(value);
  return Boolean(parsed && parsed.pre.length);
}

/** "v0.9.1" -> "0.9.1"; null when it isn't a version. */
function normalizeVersion(value) {
  const text = String(value || '').trim().replace(/^v/, '');
  return parseVersion(text) ? text.split('+')[0] : null;
}

module.exports = { parseVersion, compareVersions, isPrerelease, normalizeVersion };
