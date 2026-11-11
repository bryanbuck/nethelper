/**
 * Cisco IOS / IOS-XE CLI text helpers (pure). Checked against a Catalyst
 * 3560E on IOS 15.0(1)SE2 (tests/fixtures/ios-live/); the IOS-XE forms are
 * from Cisco's command reference. See docs/hardware/IOS_NOTES.md.
 */

// Lines `show running-config` prints that are not configuration, or that
// change without a configuration change. Left in, every backup would differ
// from the last one:
//   Building configuration...
//   Current configuration : 9219 bytes
//   ! Last configuration change at 19:07:04 CST Sun Feb 28 1993 by admin
//   ! NVRAM config last updated at ...          (every `write memory`)
//   ! No configuration change since last restart
//   ntp clock-period 36028811                   (older IOS adjusts it itself)
const IOS_VOLATILE_LINE = new RegExp([
  '^Building configuration\\.\\.\\.\\s*$',
  '^Current configuration\\s*:\\s*\\d+ bytes\\s*$',
  '^! Last configuration change at .*$',
  '^! NVRAM config last updated at .*$',
  '^! No configuration change since last restart\\s*$',
  '^ntp clock-period \\d+\\s*$',
].join('|'));

/**
 * `show running-config` output as stable, pasteable config text: the
 * volatile lines dropped, then leading blank and bare "!" lines.
 */
function cleanIosConfig(text) {
  const lines = String(text || '').split('\n').filter((line) => !IOS_VOLATILE_LINE.test(line.trimEnd()));
  while (lines.length && /^!?\s*$/.test(lines[0])) lines.shift();
  return lines.join('\n').trim();
}

const first = (re, text) => (re.exec(text) || [])[1]?.trim() || null;

/**
 * What `show version` says about the switch itself.
 * @returns {{ version, model, serial, mac, hostname, os }} nulls where a line is missing
 */
function parseShowVersion(text) {
  const body = String(text || '');
  if (!/Cisco IOS/i.test(body)) {
    return { version: null, model: null, serial: null, mac: null, hostname: null, os: null };
  }
  return {
    // "Cisco IOS Software, C3560E Software (...), Version 15.0(1)SE2, RELEASE"
    // "Cisco IOS XE Software, Version 16.12.04"
    version: first(/Cisco IOS[^\n]*?Version\s+([^,\s]+)/i, body),
    model: first(/^Model number\s*:\s*(\S+)/im, body) || first(/^cisco\s+(\S+)\s.*processor/im, body),
    serial: first(/^System serial number\s*:\s*(\S+)/im, body) || first(/^Processor board ID\s+(\S+)/im, body),
    mac: first(/^Base ethernet MAC Address\s*:\s*([0-9a-f:.-]+)/im, body),
    hostname: first(/^(\S+) uptime is /m, body),
    os: /IOS[ -]XE/i.test(body) ? 'IOS-XE' : 'IOS',
  };
}

module.exports = { cleanIosConfig, parseShowVersion };
