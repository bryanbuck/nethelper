const { Client } = require('ssh2');
const { detectPlatform } = require('../utils/device-platform');
const { debugLog, Services } = require('../utils/debug-logger');
const aosSTopology = require('./topology/parsers/aos-s');
const junosTopology = require('./topology/parsers/junos');
const iosTopology = require('./topology/parsers/ios');
const { normalizePortName } = require('./topology/neighbor');
const { assertJunosConfigReadable } = require('../utils/config-format');

const logger = debugLog.createLogger(Services.DEVICE);

/**
 * SSH Device Service
 *
 * Drives an interactive SSH shell against network devices that lack a usable
 * REST configuration API (legacy Aruba AOS-S switches, and any other CLI-only
 * gear). Modern AOS-CX switches are handled over REST elsewhere; this service
 * is the direct-management fallback for everything else.
 *
 * Network CLIs page long output and echo a prompt between commands, so a plain
 * `exec` channel is unreliable. We open a shell, disable paging, run each
 * command, and slice the output between prompts.
 */

// Per-platform command profiles. `paging` runs first to disable the pager so
// `config` returns in one shot. `config`/`version` are the data commands.
// `configHeader` (optional) matches a banner line the CLI prints before the
// config, which is dropped so the text can be pasted back.
// `neighbors` (optional) lists the LLDP/CDP commands and parsers behind
// getNeighbors(); `identity` reads the device's own LLDP chassis id/name.
const PLATFORM_PROFILES = {
  'aos-s': {
    paging: 'no page',
    config: 'show running-config',
    version: 'show version',
    neighbors: [{ command: 'show lldp info remote-device detail', parse: aosSTopology.parseRemoteDetail }],
    identity: { command: 'show lldp info local-device', parse: aosSTopology.parseLocalDevice },
  },
  'aos-cx': {
    paging: 'no page',
    config: 'show running-config',
    version: 'show version',
    // Printed before the config; not config, and not pasteable.
    configHeader: /^Current configuration:\s*$/,
  },
  // Junos (Juniper EX/SRX/MX). `| display set` yields flat, diffable
  // set-statements rather than the nested brace format.
  junos: {
    paging: 'set cli screen-length 0',
    config: 'show configuration | display set',
    version: 'show version',
    neighbors: [{ command: 'show lldp neighbors', parse: junosTopology.parseLldpNeighborsCli }],
    identity: { command: 'show lldp local-information', parse: junosTopology.parseLocalInfoCli },
  },
  // Cisco IOS / IOS-XE (Catalyst). CDP is on by default, LLDP often is not;
  // read both and keep whichever answers.
  'ios-xe': {
    paging: 'terminal length 0',
    config: 'show running-config',
    version: 'show version',
    neighbors: [
      { command: 'show cdp neighbors detail', parse: iosTopology.parseCdpDetail },
      { command: 'show lldp neighbors detail', parse: iosTopology.parseLldpDetail },
    ],
  },
  // Generic IOS-like fallback (CLI gear we could not classify)
  generic: {
    paging: 'terminal length 0',
    config: 'show running-config',
    version: 'show version',
  },
};

// A prompt: the last line of output, ending in '#', '>' or '$' (hostname#,
// user@host>, ...). Only used to recognise the device's FIRST prompt; after
// that we wait for that exact prompt text.
const PROMPT_LINE_REGEX = /(?:^|[\r\n])([^\r\n]*[#>$])[ \t]*$/;
// AOS-S (and some others) hold the login banner until a key is pressed.
const PRESS_ANY_KEY_REGEX = /press any key/i;
// ANSI escape sequences some CLIs emit around prompts.
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * Run commands over an open interactive shell, one at a time.
 *
 * Nothing is typed until the device shows its first prompt, and each command
 * is complete only when the output ends in that same prompt. Typing earlier
 * is what broke AOS-CX: its shell takes several seconds to present a prompt,
 * the pty echoes early input straight away, and the late login prompt was
 * then mistaken for the end of the paging command, so every output shifted
 * by one (the "config" came back as the `no page` echo).
 *
 * @param {Object} stream - shell stream (EventEmitter with write())
 * @param {Array<{label:string, command:string}>} queue
 * @param {Function} done - (err, outputs) called once, after the last prompt
 *   or when the stream closes
 * @param {Object} [timing] - settleMs: quiet time before the first prompt is
 *   trusted (a banner line of '#'s can look like one); nudgeMs: send one
 *   newline if no prompt has appeared by then
 */
function driveShell(stream, queue, done, { settleMs = 300, nudgeMs = 8000 } = {}) {
  const outputs = {};
  let buffer = '';
  let prompt = null; // learned from the first prompt, without trailing space
  let index = -1;
  let finished = false;
  let keyPressed = false;
  let settleTimer = null;
  const nudgeTimer = setTimeout(() => {
    if (prompt === null && !finished) stream.write('\n');
  }, nudgeMs);

  const finish = (err) => {
    if (finished) return;
    finished = true;
    clearTimeout(settleTimer);
    clearTimeout(nudgeTimer);
    done(err, outputs);
  };

  const sendNext = () => {
    index++;
    buffer = '';
    if (index >= queue.length) return finish(null);
    stream.write(queue[index].command + '\n');
  };

  const endsWithPrompt = (text) => {
    const clean = text.replace(ANSI_REGEX, '').replace(/\s+$/, '');
    return clean.endsWith(prompt) &&
      /[\r\n]/.test(clean.slice(0, clean.length - prompt.length));
  };

  stream.on('data', (data) => {
    if (finished) return;
    buffer += data.toString('utf8');

    if (prompt === null) {
      clearTimeout(settleTimer);
      const clean = buffer.replace(ANSI_REGEX, '');
      if (!keyPressed && PRESS_ANY_KEY_REGEX.test(clean)) {
        keyPressed = true;
        buffer = '';
        stream.write('\n');
        return;
      }
      const match = clean.match(PROMPT_LINE_REGEX);
      if (!match) return;
      settleTimer = setTimeout(() => {
        if (finished) return;
        prompt = match[1].trim();
        clearTimeout(nudgeTimer);
        sendNext();
      }, settleMs);
      return;
    }

    if (endsWithPrompt(buffer)) {
      const current = queue[index];
      outputs[current.label] = stripEcho(buffer.replace(ANSI_REGEX, ''), current.command, prompt);
      sendNext();
    }
  });

  stream.on('close', () => finish(null));
}

/**
 * Remove the echoed command line and the trailing prompt line from raw
 * shell output, leaving just the command result.
 */
function stripEcho(raw, command, prompt = null) {
  const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '').split('\n');
  // Drop the first line if it echoes the command we sent.
  if (lines.length && lines[0].includes(command)) lines.shift();
  // Drop the trailing prompt line.
  const last = lines.length ? lines[lines.length - 1].trim() : '';
  if (prompt ? last === prompt : /[#>$]$/.test(last)) lines.pop();
  return lines.join('\n').trim();
}

class SshDeviceService {
  constructor() {
    this.connectTimeout = parseInt(process.env.SSH_CONNECT_TIMEOUT) || 15000;
    this.commandTimeout = parseInt(process.env.SSH_COMMAND_TIMEOUT) || 45000;
    this.port = parseInt(process.env.SSH_PORT) || 22;
  }

  /**
   * Resolve the command profile for a device. Prefers an explicit
   * metadata.sshProfile, then uses shared platform detection, defaulting to
   * aos-s (the common direct-managed case here).
   */
  resolveProfile(device) {
    const explicit = device?.metadata?.sshProfile;
    if (explicit && PLATFORM_PROFILES[explicit]) return PLATFORM_PROFILES[explicit];

    const family = detectPlatform(device);
    return PLATFORM_PROFILES[family] || PLATFORM_PROFILES['aos-s'];
  }

  /**
   * Open a shell, run the given commands in order, and return their combined
   * stripped outputs keyed by the labels provided.
   *
   * @param {Object} device - Device row (needs ipAddress, model/metadata)
   * @param {Object} credentials - Decrypted { username, password }
   * @param {Array<{label:string, command:string}>} commands
   * @returns {Promise<Object>} map of label -> command output text
   */
  runCommands(device, credentials, commands) {
    return new Promise((resolve, reject) => {
      if (!device?.ipAddress) {
        return reject(new Error(`Device ${device?.name || '(unknown)'} has no IP address configured`));
      }
      if (!credentials?.username || !credentials?.password) {
        return reject(new Error('SSH requires a username and password credential'));
      }

      const conn = new Client();
      let settled = false;
      const finish = (err, result) => {
        if (settled) return;
        settled = true;
        try { conn.end(); } catch (e) { /* already closed */ }
        if (err) reject(err); else resolve(result);
      };

      const overallTimer = setTimeout(
        () => finish(new Error(`SSH command timeout after ${this.commandTimeout}ms`)),
        this.commandTimeout
      );

      conn.on('ready', () => {
        conn.shell({ pty: true }, (err, stream) => {
          if (err) {
            clearTimeout(overallTimer);
            return finish(new Error(`Failed to open SSH shell: ${err.message}`));
          }

          const profile = this.resolveProfile(device);
          // Disable paging first, then each requested command.
          const queue = [
            { label: '_paging', command: profile.paging },
            ...commands,
          ];

          driveShell(stream, queue, (shellErr, outputs) => {
            clearTimeout(overallTimer);
            delete outputs._paging;
            finish(shellErr, outputs);
          });

          stream.stderr.on('data', (data) => {
            logger.debug(`SSH stderr from ${device.name}: ${data.toString('utf8').trim()}`);
          });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(overallTimer);
        finish(new Error(`SSH connection failed: ${err.message}`));
      });

      conn.connect({
        host: device.ipAddress,
        port: this.port,
        username: credentials.username,
        password: credentials.password,
        readyTimeout: this.connectTimeout,
        // Network gear frequently offers only legacy KEX/host-key/cipher algorithms.
        algorithms: {
          kex: [
            'ecdh-sha2-nistp256', 'ecdh-sha2-nistp384', 'ecdh-sha2-nistp521',
            'diffie-hellman-group14-sha256', 'diffie-hellman-group14-sha1',
            'diffie-hellman-group1-sha1', 'diffie-hellman-group-exchange-sha256',
          ],
          serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-256', 'rsa-sha2-512'],
          cipher: [
            'aes128-ctr', 'aes192-ctr', 'aes256-ctr',
            'aes128-cbc', 'aes256-cbc', '3des-cbc',
          ],
        },
      });
    });
  }

  /**
   * Pull the running configuration as text.
   */
  async getRunningConfig(device, credentials) {
    const profile = this.resolveProfile(device);
    const outputs = await this.runCommands(device, credentials, [
      { label: 'config', command: profile.config },
    ]);
    let config = outputs.config;
    if (config && profile.configHeader) {
      const lines = config.split('\n');
      if (profile.configHeader.test(lines[0])) config = lines.slice(1).join('\n').trim();
    }
    if (!config || config.length === 0) {
      throw new Error('SSH returned an empty running configuration');
    }
    if (profile === PLATFORM_PROFILES.junos) assertJunosConfigReadable(config);
    return config;
  }

  /**
   * LLDP/CDP neighbors over the CLI, plus the device's own LLDP identity when
   * the profile can read it. One SSH session for all of it.
   * @returns {Promise<{neighbors: Object[], identity: {chassisId, sysName}}>}
   */
  async getNeighbors(device, credentials) {
    const profile = this.resolveProfile(device);
    if (!profile.neighbors) {
      throw new Error('No neighbor commands for this CLI platform');
    }
    const commands = profile.neighbors.map((n, i) => ({ label: `n${i}`, command: n.command }));
    if (profile.identity) commands.push({ label: 'identity', command: profile.identity.command });
    const outputs = await this.runCommands(device, credentials, commands);

    // The same neighbor can appear in both CDP and LLDP: keep the first seen
    // per local port + remote name (CDP is listed first, and names the far end
    // the way Cisco does).
    const seen = new Set();
    const neighbors = [];
    profile.neighbors.forEach((n, i) => {
      for (const neighbor of n.parse(outputs[`n${i}`] || '')) {
        const key = `${normalizePortName(neighbor.localPort)}|${(neighbor.sysName || neighbor.chassisId).toLowerCase().split('.')[0]}`;
        if (seen.has(key)) continue;
        seen.add(key);
        neighbors.push(neighbor);
      }
    });
    const identity = profile.identity
      ? profile.identity.parse(outputs.identity || '')
      : { chassisId: null, sysName: null };
    return { neighbors, identity };
  }

  /**
   * Pull `show version` output (used by the firmware/system pollers).
   */
  async getVersion(device, credentials) {
    const outputs = await this.runCommands(device, credentials, [
      { label: 'version', command: this.resolveProfile(device).version },
    ]);
    return outputs.version || '';
  }

  /**
   * Verify SSH reachability and authentication without pulling config.
   * Returns a shape compatible with the REST testConnection result.
   */
  async testConnection(device, credentials) {
    const startTime = Date.now();
    try {
      const version = await this.getVersion(device, credentials);
      return {
        success: true,
        message: 'SSH connection successful',
        transport: 'ssh',
        testedAt: new Date().toISOString(),
        responseTime: Date.now() - startTime,
        preview: version.split('\n').slice(0, 3).join('\n'),
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
        transport: 'ssh',
        testedAt: new Date().toISOString(),
        responseTime: Date.now() - startTime,
      };
    }
  }
}

module.exports = new SshDeviceService();
module.exports.driveShell = driveShell;
module.exports.stripEcho = stripEcho;
