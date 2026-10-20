/**
 * What each captured configuration format is, in one place.
 *
 * `kind` groups formats by what a person can do with them:
 *   cli        - text that can be pasted back into the device's CLI
 *                (SSH, Central MultiEdit, Junos `load set terminal`)
 *   structured - a JSON document: the AOS-CX REST config database, or a
 *                cloud plane's intent object. Machine-readable, not pasteable.
 * A backup holds at most one artifact per kind (ConfigBackupArtifact).
 *
 * `ext` names the flat file; `gitName` names the file in the Git mirror.
 */
const CONFIG_FORMATS = {
  'cli-text': { kind: 'cli', ext: 'cfg', gitName: 'running-config.cfg' },
  'junos-set': { kind: 'cli', ext: 'set', gitName: 'running-config.set' },
  'aoscx-json': { kind: 'structured', ext: 'json', gitName: 'settings.json' },
  'mist-config-json': { kind: 'structured', ext: 'json', gitName: 'settings.json' },
  'meraki-settings-json': { kind: 'structured', ext: 'json', gitName: 'settings.json' },
  'mist-scope-json': { kind: 'structured', ext: 'json', gitName: 'settings.json' },
  'central-scope-json': { kind: 'structured', ext: 'json', gitName: 'settings.json' },
};

const ARTIFACT_KINDS = ['cli', 'structured'];

// Every config filename the Git mirror may hold, so a format change can drop
// the stale one.
const GIT_CONFIG_NAMES = [...new Set(Object.values(CONFIG_FORMATS).map((f) => f.gitName))];

function describeFormat(format) {
  if (CONFIG_FORMATS[format]) return CONFIG_FORMATS[format];
  // Unknown formats: anything ending in json is structured, the rest is text.
  return /json$/.test(format || '')
    ? { kind: 'structured', ext: 'json', gitName: 'settings.json' }
    : CONFIG_FORMATS['cli-text'];
}

const kindForFormat = (format) => describeFormat(format).kind;

// Junos answers a config read its login class may not see with a placeholder
// per hierarchy (`set system /* ACCESS-DENIED */;`, or `system { /*
// ACCESS-DENIED */ }` in text format) instead of an error. Seen live on an
// EX4000 (24.4R2) with an account lacking view-configuration, 2026-10-19.
const JUNOS_ACCESS_DENIED = /^\s*(?:set\s+)?([\w-]+)\s*(?:\{\s*)?\/\*\s*ACCESS-DENIED\s*\*\//gm;

/** The hierarchies a Junos config read withheld (access-denied placeholders). */
function junosDeniedHierarchies(text) {
  return [...String(text || '').matchAll(JUNOS_ACCESS_DENIED)].map((m) => m[1]);
}

/**
 * Throw when a Junos config read holds nothing but access-denied
 * placeholders (an account without view-configuration), so such a read is
 * never stored as a backup. A read that withheld only some hierarchies is
 * kept; callers report those with junosDeniedHierarchies(). Even with
 * view-configuration, Junos withholds some (scripts, event-options, secret,
 * extension-service on an EX4000, 24.4R2).
 */
function assertJunosConfigReadable(text) {
  const denied = junosDeniedHierarchies(text);
  if (!denied.length) return;
  // A statement other than the version: a `set` line, or a text-format
  // leaf ending in `;` (hierarchy braces alone carry nothing).
  const readable = String(text).split('\n').some((line) => {
    const trimmed = line.trim();
    if (!trimmed || /ACCESS-DENIED/.test(trimmed) || /^(set )?version\b/.test(trimmed)) return false;
    return trimmed.startsWith('set ') || trimmed.endsWith(';');
  });
  if (readable) return;
  const error = new Error(
    `The device account can't read the configuration: Junos denied ${denied.join(', ')}. `
    + 'Give its login class the view-configuration permission.'
  );
  error.code = 'CONFIG_ACCESS_DENIED';
  error.denied = denied;
  throw error;
}

module.exports = {
  assertJunosConfigReadable,
  junosDeniedHierarchies,
  CONFIG_FORMATS,
  ARTIFACT_KINDS,
  GIT_CONFIG_NAMES,
  describeFormat,
  kindForFormat,
};
