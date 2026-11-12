/**
 * A stand-in Cisco IOS switch for the smoke test: an SSH server that answers
 * the few commands NetHelper's `ios-xe` profile sends, the way a privilege-15
 * login on the lab's Catalyst 3560E did (backend/tests/fixtures/ios-live/):
 * the prompt "<hostname>#", the command echoed back, the output, the prompt.
 *
 * `show running-config` returns the text of `configFile`, read on every call,
 * so the test changes the "switch's" config by writing that file.
 */
const fs = require('fs');
const { Server, utils } = require('ssh2');

const VERSION = `Cisco IOS Software, C3560E Software (C3560E-UNIVERSALK9-M), Version 15.0(1)SE2, RELEASE SOFTWARE (fc3)
Technical Support: http://www.cisco.com/techsupport

ROM: Bootstrap program is C3560E boot loader

E2E-SW uptime is 1 week, 2 days, 3 hours, 4 minutes
System image file is "flash:c3560e-universalk9-mz.150-1.SE2.bin"

cisco WS-C3560E-24PD-S (PowerPC405) processor (revision A0) with 131072K bytes of memory.
Base ethernet MAC Address       : 02:00:00:E2:E0:01
Model number                    : WS-C3560E-24PD-S
System serial number            : E2E0000TEST

Switch Ports Model              SW Version            SW Image
------ ----- -----              ----------            ----------
*    1 28    WS-C3560E-24PD     15.0(1)SE2            C3560E-UNIVERSALK9-M

Configuration register is 0xF`;

const EMPTY_NEIGHBORS = '\nTotal entries displayed: 0\n';

function startFakeSwitch({
  host = '0.0.0.0', port = 2222, username, password, configFile, hostname = 'E2E-SW',
}) {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
  const prompt = `${hostname}#`;
  const log = [];

  const answer = (command) => {
    const cmd = command.trim();
    log.push(cmd);
    if (cmd === '') return '';
    if (cmd === 'terminal length 0') return '';
    if (cmd === 'show running-config') return fs.readFileSync(configFile, 'utf8');
    if (cmd === 'show version') return VERSION;
    if (/^show (cdp|lldp) neighbors/.test(cmd)) return EMPTY_NEIGHBORS;
    return `                ^\n% Invalid input detected at '^' marker.\n`;
  };

  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      if (ctx.username === username && ctx.method === 'password' && ctx.password === password) return ctx.accept();
      // Advertise password only, like the lab switch.
      return ctx.reject(['password']);
    });
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();
        session.on('pty', (ok) => ok && ok());
        session.on('shell', (acceptShell) => {
          const stream = acceptShell();
          const crlf = (text) => text.replace(/\r?\n/g, '\r\n');
          stream.write(`\r\n${prompt}`);
          let line = '';
          stream.on('data', (data) => {
            for (const ch of data.toString('utf8')) {
              if (ch === '\r' || ch === '\n') {
                if (ch === '\n' && line === '' && stream.lastWasCr) {
                  stream.lastWasCr = false;
                  continue;
                }
                stream.lastWasCr = ch === '\r';
                const out = answer(line);
                line = '';
                stream.write(`\r\n${out ? crlf(out.endsWith('\n') ? out : `${out}\n`) : ''}${prompt}`);
              } else {
                stream.lastWasCr = false;
                line += ch;
                stream.write(ch); // echo, one character at a time like IOS
              }
            }
          });
        });
        session.on('exec', (acceptExec, _reject, info) => {
          const stream = acceptExec();
          stream.write(answer(info.command).replace(/\r?\n/g, '\r\n'));
          stream.exit(0);
          stream.end();
        });
      });
    });
    client.on('error', () => {});
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve({
      port: server.address().port,
      log,
      close: () => new Promise((done) => server.close(() => done())),
    }));
  });
}

module.exports = { startFakeSwitch };
