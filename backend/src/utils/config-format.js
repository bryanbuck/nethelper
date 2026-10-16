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

module.exports = {
  CONFIG_FORMATS,
  ARTIFACT_KINDS,
  GIT_CONFIG_NAMES,
  describeFormat,
  kindForFormat,
};
