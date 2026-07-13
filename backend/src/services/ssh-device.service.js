const { Client } = require('ssh2');
const { detectPlatform } = require('../utils/device-platform');
const { debugLog, Services } = require('../utils/debug-logger');

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
const PLATFORM_PROFILES = {
  'aos-s': {
    paging: 'no page',
    config: 'show running-config',
    version: 'show version',
  },
  'aos-cx': {
    paging: 'no page',
    config: 'show running-config',
    version: 'show version',
  },
  // Junos (Juniper EX/SRX/MX). `| display set` yields flat, diffable
  // set-statements rather than the nested brace format.
  junos: {
    paging: 'set cli screen-length 0',
    config: 'show configuration | display set',
    version: 'show version',
  },
  // Cisco IOS / IOS-XE (Catalyst)
  'ios-xe': {
    paging: 'terminal length 0',
    config: 'show running-config',
    version: 'show version',
  },
  // Generic IOS-like fallback (CLI gear we could not classify)
  generic: {
    paging: 'terminal length 0',
    config: 'show running-config',
    version: 'show version',
  },
};

// Prompt at end of a command's output: hostname followed by '#', '>', or '$'.
const PROMPT_REGEX = /[\r\n][^\r\n]*[#>$]\s?$/;

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
          // Queue: disable paging first, then each requested command.
          const queue = [
            { label: '_paging', command: profile.paging },
            ...commands,
          ];
          const outputs = {};
          let buffer = '';
          let index = -1;
          let waitingForPrompt = false;

          const sendNext = () => {
            index++;
            if (index >= queue.length) {
              clearTimeout(overallTimer);
              // Strip internal paging step before returning
              delete outputs._paging;
              return finish(null, outputs);
            }
            buffer = '';
            waitingForPrompt = true;
            stream.write(queue[index].command + '\n');
          };

          stream.on('data', (data) => {
            buffer += data.toString('utf8');
            if (waitingForPrompt && PROMPT_REGEX.test(buffer)) {
              waitingForPrompt = false;
              const current = queue[index];
              outputs[current.label] = this.stripEcho(buffer, current.command);
              sendNext();
            }
          });

          stream.on('close', () => {
            clearTimeout(overallTimer);
            if (!settled) {
              delete outputs._paging;
              finish(null, outputs);
            }
          });

          stream.stderr.on('data', (data) => {
            logger.debug(`SSH stderr from ${device.name}: ${data.toString('utf8').trim()}`);
          });

          // Kick off once the initial banner/prompt settles.
          setTimeout(sendNext, 600);
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
   * Remove the echoed command line and the trailing prompt line from raw
   * shell output, leaving just the command result.
   */
  stripEcho(raw, command) {
    let text = raw.replace(/\r\n/g, '\n');
    const lines = text.split('\n');
    // Drop the first line if it echoes the command we sent.
    if (lines.length && lines[0].includes(command)) lines.shift();
    // Drop the trailing prompt line.
    if (lines.length && /[#>$]\s*$/.test(lines[lines.length - 1])) lines.pop();
    return lines.join('\n').trim();
  }

  /**
   * Pull the running configuration as text.
   */
  async getRunningConfig(device, credentials) {
    const outputs = await this.runCommands(device, credentials, [
      { label: 'config', command: this.resolveProfile(device).config },
    ]);
    const config = outputs.config;
    if (!config || config.length === 0) {
      throw new Error('SSH returned an empty running configuration');
    }
    return config;
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
