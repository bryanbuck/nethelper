/**
 * driveShell against a fake interactive shell. The AOS-CX case reproduces the
 * 6200F (ML.10.16): the pty echoes typed input at once, but the CLI shows its
 * first prompt seconds later. Typing before that prompt used to shift every
 * output by one, so the "running config" came back as the `no page` echo.
 */
const { EventEmitter } = require('events');
const { driveShell, stripEcho } = require('../../src/services/ssh-device.service');

const TIMING = { settleMs: 20, nudgeMs: 1000 };

/**
 * A fake CLI. `respond(command)` returns its output; the prompt follows.
 * Input typed before `ready()` is echoed immediately but executed only after
 * the banner and first prompt, like the real switch.
 */
function fakeShell({ prompt = 'Sw-Access1# ', banner = '', respond }) {
  const stream = new EventEmitter();
  const pending = [];
  let ready = false;
  stream.written = [];
  const emit = (text) => stream.emit('data', Buffer.from(text));
  const run = (command) => {
    if (command === '') return emit(`\r\n${prompt}`);
    emit(`${command}\r\n${respond(command)}${prompt}`);
  };
  stream.write = (text) => {
    stream.written.push(text);
    const command = text.replace(/\n$/, '');
    if (ready) return setImmediate(() => run(command));
    emit(`${command}\r\n`); // local echo only
    pending.push(command);
  };
  stream.ready = () => {
    ready = true;
    emit(`${banner}${prompt}`);
    for (const command of pending.splice(0)) setImmediate(() => run(command));
  };
  return stream;
}

const CONFIG = 'Current configuration:\r\n!\r\nhostname Sw-Access1\r\n!\r\n';
const cxRespond = (command) => {
  if (command === 'no page') return '';
  if (command === 'show running-config') return CONFIG;
  return `% Unknown command\r\n`;
};

const drive = (stream, queue, timing = TIMING) =>
  new Promise((resolve, reject) => driveShell(stream, queue, (err, out) => (err ? reject(err) : resolve(out)), timing));

const QUEUE = [
  { label: '_paging', command: 'no page' },
  { label: 'config', command: 'show running-config' },
];

describe('driveShell', () => {
  test('waits for a slow first prompt instead of typing into the banner (AOS-CX)', async () => {
    const stream = fakeShell({ banner: 'Last login: 2026-10-16\r\n', respond: cxRespond });
    const result = drive(stream, QUEUE);
    // Nothing is typed before the prompt appears.
    await new Promise((r) => setTimeout(r, 50));
    expect(stream.written).toEqual([]);
    stream.ready();

    const out = await result;
    expect(out.config).toBe('Current configuration:\n!\nhostname Sw-Access1\n!');
    expect(out._paging).toBe('');
    expect(stream.written).toEqual(['no page\n', 'show running-config\n']);
  });

  test('a config line ending in # or > is not mistaken for the prompt', async () => {
    const tricky = 'banner motd ####\r\ninterface 1/1/1\r\n    description uplink->core>\r\n';
    const stream = fakeShell({ respond: (c) => (c === 'show running-config' ? tricky : '') });
    const result = drive(stream, QUEUE);
    stream.ready();
    const out = await result;
    expect(out.config).toBe('banner motd ####\ninterface 1/1/1\n    description uplink->core>');
  });

  test('a banner of # lines is not taken as the first prompt', async () => {
    const stream = fakeShell({ banner: '##########\r\n# Authorized use only #\r\n##########\r\n', respond: cxRespond });
    const result = drive(stream, QUEUE);
    stream.ready();
    const out = await result;
    expect(out.config).toContain('hostname Sw-Access1');
    expect(stream.written).toEqual(['no page\n', 'show running-config\n']);
  });

  test('answers "Press any key to continue" (AOS-S)', async () => {
    const stream = new EventEmitter();
    stream.written = [];
    stream.write = (text) => {
      stream.written.push(text);
      const command = text.replace(/\n$/, '');
      setImmediate(() => {
        if (stream.written.length === 1) return stream.emit('data', Buffer.from('\r\nHP-2930F# '));
        const body = command === 'show running-config' ? 'hostname "HP-2930F"\r\n' : '';
        stream.emit('data', Buffer.from(`${command}\r\n${body}HP-2930F# `));
      });
    };
    const result = drive(stream, QUEUE);
    stream.emit('data', Buffer.from('HPE Networking\r\nPress any key to continue'));
    const out = await result;
    expect(stream.written[0]).toBe('\n');
    expect(out.config).toBe('hostname "HP-2930F"');
  });

  test('nudges with a newline when no prompt appears', async () => {
    const stream = fakeShell({ respond: cxRespond });
    stream.write = jest.fn((text) => {
      if (text === '\n') setImmediate(() => stream.emit('data', Buffer.from('\r\nSw-Access1# ')));
      else setImmediate(() => stream.emit('data', Buffer.from(`${text.trim()}\r\n${cxRespond(text.trim())}Sw-Access1# `)));
    });
    const out = await drive(stream, QUEUE, { settleMs: 10, nudgeMs: 30 });
    expect(stream.write.mock.calls[0][0]).toBe('\n');
    expect(out.config).toContain('hostname Sw-Access1');
  });

  test('returns what it has when the stream closes early', async () => {
    const stream = new EventEmitter();
    stream.write = jest.fn();
    const result = drive(stream, QUEUE);
    stream.emit('close');
    await expect(result).resolves.toEqual({});
  });
});

describe('stripEcho', () => {
  test('drops the echoed command and the exact prompt line', () => {
    expect(stripEcho('show version\r\nAOS-CX ML.10.16\r\nSw-Access1# ', 'show version', 'Sw-Access1#'))
      .toBe('AOS-CX ML.10.16');
  });

  test('keeps a last output line that only looks like a prompt', () => {
    expect(stripEcho('cmd\nline ending in #\nSw-Access1#', 'cmd', 'Sw-Access1#')).toBe('line ending in #');
  });
});

describe('getRunningConfig', () => {
  const service = require('../../src/services/ssh-device.service');
  const creds = { username: 'u', password: 'p' };
  afterEach(() => jest.restoreAllMocks());

  test('drops the AOS-CX "Current configuration:" header', async () => {
    jest.spyOn(service, 'runCommands').mockResolvedValue({ config: 'Current configuration:\n!\nhostname Sw-Access1' });
    await expect(service.getRunningConfig({ ipAddress: '10.0.0.1', vendor: 'aruba', platform: 'aos-cx' }, creds))
      .resolves.toBe('!\nhostname Sw-Access1');
  });

  test('leaves other platforms untouched', async () => {
    jest.spyOn(service, 'runCommands').mockResolvedValue({ config: 'Current configuration:\nhostname X' });
    await expect(service.getRunningConfig({ ipAddress: '10.0.0.1', vendor: 'cisco', platform: 'ios-xe' }, creds))
      .resolves.toBe('Current configuration:\nhostname X');
  });

  test('refuses a CLI error instead of storing it as a config (AOS-S operator login)', async () => {
    // What a real 2930F answers an operator's `show running-config`.
    jest.spyOn(service, 'runCommands').mockResolvedValue({ config: 'Invalid input: running-config' });
    await expect(service.getRunningConfig({ ipAddress: '10.0.0.1', vendor: 'aruba', platform: 'aos-s' }, creds))
      .rejects.toMatchObject({ code: 'CONFIG_ACCESS_DENIED', message: expect.stringMatching(/operator login.*manager account/) });
  });

  test('keeps a config that merely mentions an error word', async () => {
    const config = 'hostname "sw"\nbanner motd "Error: unauthorized access prohibited"\nvlan 1\n   name "DEFAULT_VLAN"';
    jest.spyOn(service, 'runCommands').mockResolvedValue({ config });
    await expect(service.getRunningConfig({ ipAddress: '10.0.0.1', vendor: 'aruba', platform: 'aos-s' }, creds))
      .resolves.toBe(config);
  });
});

describe('AOS-S on real hardware (2930F, WC.16.11)', () => {
  const aosS = require('../../src/services/topology/parsers/aos-s');
  const { chunks } = require('../fixtures/aos-s-live/ssh-session.json');

  // Replays the captured session: everything up to the first typed command on
  // connect, then each command's chunks when that command is typed.
  function replayShell() {
    const stream = new EventEmitter();
    const turns = [[]];
    for (const chunk of chunks) {
      if (typeof chunk === 'string') turns[turns.length - 1].push(chunk);
      else turns.push([]);
    }
    let turn = 0;
    const play = (n) => setImmediate(() => {
      for (const text of turns[n] || []) stream.emit('data', Buffer.from(text));
    });
    stream.written = [];
    stream.write = (text) => {
      stream.written.push(text);
      if (text === '\n') return; // "press any key": the next screen is in the same turn
      turn += 1;
      play(turn);
    };
    stream.start = () => {
      // The banner and "Press any key" arrive first; the prompt after the key.
      const [banner, pressKey, ...rest] = turns[0];
      stream.emit('data', Buffer.from(banner));
      stream.emit('data', Buffer.from(pressKey));
      setImmediate(() => rest.forEach((text) => stream.emit('data', Buffer.from(text))));
    };
    return stream;
  }

  test('finds the operator prompt drawn with cursor moves and reads every command', async () => {
    const stream = replayShell();
    const result = drive(stream, [
      { label: '_paging', command: 'no page' },
      { label: 'version', command: 'show version' },
      { label: 'identity', command: 'show lldp info local-device' },
      { label: 'neighbors', command: 'show lldp info remote-device detail' },
    ]);
    stream.start();
    const out = await result;

    expect(stream.written).toEqual([
      '\n', 'no page\n', 'show version\n', 'show lldp info local-device\n', 'show lldp info remote-device detail\n',
    ]);
    expect(out._paging).toBe('');
    // The echo arrived as "show versi" + cursor move + "on": none of it is kept.
    expect(out.version.split('\n')[0]).toMatch(/^Image stamp:/);
    expect(out.version).toContain('WC.16.11.0015');
    expect(out.version).not.toMatch(/Lab-Core>|show versi/);
    // A cursor move after a line break (the screen scrolling) adds no blank line.
    expect(out.identity).toContain('Address: 203.0.113.10\n     Type: ipv4\n     Address: 203.0.113.14');
  });

  test('the LLDP parsers read the real output', async () => {
    const stream = replayShell();
    const result = drive(stream, [
      { label: '_paging', command: 'no page' },
      { label: 'version', command: 'show version' },
      { label: 'identity', command: 'show lldp info local-device' },
      { label: 'neighbors', command: 'show lldp info remote-device detail' },
    ]);
    stream.start();
    const out = await result;

    const neighbors = aosS.parseRemoteDetail(out.neighbors);
    expect(neighbors.map((n) => [n.localPort, n.sysName, n.portId])).toEqual([
      ['1', 'Sw-CoreA', '1/1/4'],
      ['2', 'Sw-CoreB', '1/1/4'],
      ['4', 'Lab-Edge2', '1/1/1'],
      ['5', 'JNEX-01', 'ge-0/0/11'],
    ]);
    // AOS-S prints MACs as 02aa00-0000a1 (not the manual's spaced form); matching uses .mac.
    expect(neighbors[0].mac).toBe('02:aa:00:00:00:a1');
    expect(aosS.parseLocalDevice(out.identity)).toEqual({ chassisId: '02:aa:00:00:00:01', sysName: 'Lab-Core' });
  });
});
