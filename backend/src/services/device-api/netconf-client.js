const { Client } = require('ssh2');
const { debugLog, Services } = require('../../utils/debug-logger');

const logger = debugLog.createLogger(Services.DEVICE);

/**
 * NETCONF client (RFC 6241 / RFC 6242) over the ssh2 `netconf` subsystem.
 *
 * Hand-rolled rather than pulled from npm: the NETCONF packages on npm are
 * unmaintained (the `netconf` package's last release was 2022), and the
 * protocol is small enough that owning it beats depending on abandonware. We
 * already depend on ssh2, so this adds no new dependencies.
 *
 * Why NETCONF instead of screen-scraping the CLI: messages are explicitly
 * framed, so there is no prompt-matching, echo-stripping, or paging to get
 * wrong. The transport tells us where a response ends.
 *
 * Framing (RFC 6242) has a trap worth stating plainly: the <hello> exchange is
 * ALWAYS terminated by the end-of-message delimiter `]]>]]>`, because neither
 * side knows the other's capabilities yet. Only once both peers have advertised
 * `base:1.1` do subsequent messages switch to chunked framing. Getting this
 * backwards is the classic hand-rolled-NETCONF bug.
 */

const DEFAULT_PORT = 830;
const END_OF_MESSAGE = ']]>]]>';
const BASE_1_0 = 'urn:ietf:params:netconf:base:1.0';
const BASE_1_1 = 'urn:ietf:params:netconf:base:1.1';

// Network gear frequently offers only legacy KEX/host-key/cipher algorithms.
// Mirrors ssh-device.service.js so both transports reach the same devices.
const LEGACY_ALGORITHMS = {
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
};

class NetconfClient {
  /**
   * @param {Object} options
   * @param {string} options.host
   * @param {number} [options.port=830]
   * @param {string} options.username
   * @param {string} options.password
   * @param {number} [options.connectTimeout]
   * @param {number} [options.commandTimeout]
   */
  constructor({ host, port, username, password, connectTimeout, commandTimeout } = {}) {
    this.host = host;
    this.port = port || parseInt(process.env.NETCONF_PORT, 10) || DEFAULT_PORT;
    this.username = username;
    this.password = password;
    this.connectTimeout = connectTimeout || parseInt(process.env.SSH_CONNECT_TIMEOUT, 10) || 15000;
    this.commandTimeout = commandTimeout || parseInt(process.env.SSH_COMMAND_TIMEOUT, 10) || 45000;

    this.conn = null;
    this.stream = null;
    this.buffer = '';
    this.serverCapabilities = [];
    this.chunked = false; // set after the hello exchange
    this.messageId = 0;
    this.pending = null; // { resolve, reject, timer } for the in-flight rpc
  }

  get connected() {
    return Boolean(this.stream);
  }

  /**
   * Connect, open the `netconf` subsystem, and complete the hello exchange.
   * Rejects with a `code` of 'NETCONF_UNAVAILABLE' when the device answers SSH
   * but refuses the subsystem — the signal callers use to fall back to the CLI.
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (!this.host) return reject(new Error('NETCONF requires an IP address'));
      if (!this.username || !this.password) {
        return reject(new Error('NETCONF requires a username and password credential'));
      }

      const conn = new Client();
      this.conn = conn;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        try { conn.end(); } catch { /* already closed */ }
        reject(error);
      };

      const timer = setTimeout(
        () => fail(new Error(`NETCONF connection timed out after ${this.connectTimeout}ms`)),
        this.connectTimeout
      );

      conn.on('ready', () => {
        conn.subsys('netconf', (err, stream) => {
          if (err) {
            clearTimeout(timer);
            // The device authenticated but would not start the subsystem —
            // almost always `set system services netconf ssh` is not
            // configured. Distinguish this from a genuine failure so the
            // caller can fall back to the CLI transport.
            const unavailable = new Error(
              `Device does not offer the NETCONF subsystem (${err.message}). `
              + 'Enable it with `set system services netconf ssh`, or it will be reached over the CLI instead.'
            );
            unavailable.code = 'NETCONF_UNAVAILABLE';
            return fail(unavailable);
          }

          this.stream = stream;
          stream.on('data', (data) => this.onData(data));
          stream.on('close', () => this.onClose());
          stream.stderr?.on('data', (data) => {
            logger.debug(`NETCONF stderr from ${this.host}: ${data.toString('utf8').trim()}`);
          });

          // Wait for the server hello, then send ours.
          this.awaitHello()
            .then(() => {
              clearTimeout(timer);
              settled = true;
              resolve(this);
            })
            .catch((error) => {
              clearTimeout(timer);
              fail(error);
            });
        });
      });

      conn.on('error', (err) => {
        clearTimeout(timer);
        fail(new Error(err.level === 'client-authentication'
          ? `NETCONF connection failed: the device rejected the username or password (${err.message})`
          : `NETCONF connection failed: ${err.message}`));
      });

      conn.connect({
        host: this.host,
        port: this.port,
        username: this.username,
        password: this.password,
        readyTimeout: this.connectTimeout,
        algorithms: LEGACY_ALGORITHMS,
      });
    });
  }

  /**
   * Read the server's <hello>, then send ours. Both hellos are end-of-message
   * framed regardless of the capabilities they advertise (RFC 6242 s4.3);
   * chunked framing only applies afterwards, and only if both peers offered
   * base:1.1.
   */
  awaitHello() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Timed out waiting for the NETCONF server <hello>')),
        this.connectTimeout
      );

      this.pending = {
        resolve: (xml) => {
          clearTimeout(timer);
          this.serverCapabilities = [...xml.matchAll(/<capability>\s*([^<\s]+)\s*<\/capability>/g)]
            .map((m) => m[1]);

          const bothSupport11 = this.serverCapabilities.includes(BASE_1_1);

          // Our hello must be sent with the OLD framing; the switch to chunked
          // (if any) takes effect only for messages after the exchange.
          const hello = '<?xml version="1.0" encoding="UTF-8"?>'
            + '<hello xmlns="urn:ietf:params:xml:ns:netconf:base:1.0">'
            + '<capabilities>'
            + `<capability>${BASE_1_0}</capability>`
            + (bothSupport11 ? `<capability>${BASE_1_1}</capability>` : '')
            + '</capabilities>'
            + '</hello>';
          this.stream.write(hello + '\n' + END_OF_MESSAGE + '\n');

          this.chunked = bothSupport11;
          logger.debug(
            `NETCONF hello complete with ${this.host}: `
            + `${this.serverCapabilities.length} capabilities, framing=${this.chunked ? 'chunked (1.1)' : 'eom (1.0)'}`
          );
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
    });
  }

  /**
   * Feed incoming bytes through the active framing and resolve a complete
   * message when one arrives.
   */
  onData(data) {
    this.buffer += data.toString('utf8');

    for (;;) {
      // Which framing applies is decided per message, not just per session:
      // the <hello> exchange is always ]]>]]>-terminated (RFC 6242 s4.3), and
      // only afterwards do we switch to chunked. So in a chunked session, look
      // for a chunk header first and fall back to the end-of-message delimiter
      // (a server may still answer an early error the old way).
      if (this.chunked && /^\s*\n#(?:\d+|#)\n/.test(this.buffer)) {
        const message = this.readChunked();
        if (message === null) return; // need more bytes
        this.deliver(message.trim());
        continue;
      }

      const eom = this.buffer.indexOf(END_OF_MESSAGE);
      if (eom !== -1) {
        const message = this.buffer.slice(0, eom);
        this.buffer = this.buffer.slice(eom + END_OF_MESSAGE.length);
        this.deliver(message.trim());
        continue;
      }

      return; // incomplete
    }
  }

  /**
   * Decode one chunked-framed message (RFC 6242 s4.2):
   *   chunk        = LF '#' chunk-size LF chunk-data
   *   end-of-chunks= LF '#' '#' LF
   * Returns null when the buffer does not yet hold a complete message; the
   * buffer is only consumed once a full message is decoded.
   */
  readChunked() {
    let offset = 0;
    let message = '';

    for (;;) {
      // Tolerate stray whitespace between chunks (devices differ on whether a
      // trailing newline follows the previous chunk's data).
      const header = /^\s*\n#(\d+|#)\n/.exec(this.buffer.slice(offset));
      if (!header) return null; // need more bytes (or not chunk-framed yet)

      if (header[1] === '#') {
        // End of chunks: the message is complete.
        this.buffer = this.buffer.slice(offset + header[0].length);
        return message;
      }

      const size = parseInt(header[1], 10);
      const start = offset + header[0].length;
      if (this.buffer.length < start + size) return null; // partial chunk

      message += this.buffer.slice(start, start + size);
      offset = start + size;
    }
  }

  /** Hand a decoded message to whatever is waiting for it. */
  deliver(message) {
    const pending = this.pending;
    this.pending = null;
    if (!pending) {
      logger.debug(`NETCONF unsolicited message from ${this.host} (ignored): ${message.slice(0, 120)}`);
      return;
    }
    pending.resolve(message);
  }

  onClose() {
    this.stream = null;
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      pending.reject(new Error('NETCONF session closed before a reply arrived'));
    }
  }

  /**
   * Send an RPC and resolve its <rpc-reply> body as XML text.
   * @param {string} innerXml - the RPC operation, e.g. '<get-software-information/>'
   * @returns {Promise<string>} raw rpc-reply XML
   */
  rpc(innerXml) {
    return new Promise((resolve, reject) => {
      if (!this.stream) return reject(new Error('NETCONF session is not open'));
      if (this.pending) return reject(new Error('A NETCONF RPC is already in flight'));

      const id = ++this.messageId;
      const xml = '<?xml version="1.0" encoding="UTF-8"?>'
        + `<rpc xmlns="urn:ietf:params:xml:ns:netconf:base:1.0" message-id="${id}">`
        + innerXml
        + '</rpc>';

      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`NETCONF RPC timed out after ${this.commandTimeout}ms`));
      }, this.commandTimeout);

      this.pending = {
        resolve: (reply) => {
          clearTimeout(timer);
          const error = this.parseRpcError(reply);
          if (error) return reject(error);
          resolve(reply);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };

      this.stream.write(this.frame(xml));
    });
  }

  /** Apply the framing negotiated during the hello exchange. */
  frame(xml) {
    if (!this.chunked) return `${xml}\n${END_OF_MESSAGE}\n`;
    return `\n#${Buffer.byteLength(xml, 'utf8')}\n${xml}\n##\n`;
  }

  /** Turn an <rpc-error> in a reply into a real Error, or return null. */
  parseRpcError(reply) {
    if (!/<(?:\w+:)?rpc-error[\s>]/.test(reply)) return null;
    const message = this.extractText(reply, 'error-message')
      || this.extractText(reply, 'error-info')
      || 'unknown error';
    const severity = this.extractText(reply, 'error-severity');
    // A warning-severity rpc-error is not fatal (Junos emits these for things
    // like an empty configuration section).
    if (severity && severity.toLowerCase() === 'warning') return null;
    return new Error(`NETCONF RPC error: ${message.trim()}`);
  }

  /**
   * Text content of the first matching element, namespace-agnostic.
   * Deliberately not a full XML parser: we need a handful of leaf values and
   * one CDATA-ish config blob, and adding an XML dependency to read those
   * would be a poor trade.
   */
  extractText(xml, tag) {
    const match = new RegExp(`<(?:[\\w.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`).exec(xml);
    return match ? this.decodeEntities(match[1]) : null;
  }

  decodeEntities(text) {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /** Politely end the session, then tear down the transport. */
  async close() {
    if (this.stream) {
      try {
        await this.rpc('<close-session/>');
      } catch {
        // The device often drops the channel the moment it sees close-session;
        // that is not an error worth surfacing.
      }
    }
    this.stream = null;
    if (this.conn) {
      try { this.conn.end(); } catch { /* already closed */ }
      this.conn = null;
    }
  }
}

module.exports = NetconfClient;
module.exports.NETCONF_UNAVAILABLE = 'NETCONF_UNAVAILABLE';
