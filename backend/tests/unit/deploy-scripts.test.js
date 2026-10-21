/**
 * deploy/install.sh and deploy/systemd/nethelper-admin, run for real in a temp
 * tree. Docker is a fake on PATH that logs its arguments, so the installer's
 * whole flow runs without a Docker host.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { validateEnv } = require('../../src/config/env');

const REPO = path.resolve(__dirname, '../../..');
const SECRETS = ['POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'];
const HEX64 = /^[0-9a-f]{64}$/;

const FAKE_DOCKER = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$1" in
  info) exit 0 ;;
  inspect) echo healthy; exit 0 ;;
  compose)
    shift
    case "$1" in
      version) echo "\${FAKE_COMPOSE_VERSION:-2.29.1}" ;;
      pull) [ -z "\${FAKE_PULL_FAIL:-}" ] || exit 1 ;;
      ps) echo "id-$3" ;;
      exec) case "$*" in *count-users*) echo "\${FAKE_USERS:-0}" ;; esac ;;
    esac ;;
esac
exit 0
`;

function parseEnv(text) {
  const env = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nethelper-deploy-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('deploy/install.sh', () => {
  let deployDir;
  let envFile;
  let log;

  beforeEach(() => {
    deployDir = path.join(tmp, 'deploy');
    fs.mkdirSync(deployDir);
    fs.copyFileSync(path.join(REPO, 'deploy/install.sh'), path.join(deployDir, 'install.sh'));
    fs.copyFileSync(path.join(REPO, 'deploy/.env.example'), path.join(deployDir, '.env.example'));
    fs.writeFileSync(path.join(tmp, 'VERSION'), '1.2.3\n');
    fs.mkdirSync(path.join(tmp, 'bin'));
    fs.writeFileSync(path.join(tmp, 'bin/docker'), FAKE_DOCKER, { mode: 0o755 });
    envFile = path.join(deployDir, '.env');
    log = path.join(tmp, 'docker.log');
  });

  function install(args, extraEnv = {}) {
    const result = spawnSync('sh', [path.join(deployDir, 'install.sh'), ...args], {
      input: '', // not a TTY: never prompts
      encoding: 'utf8',
      env: {
        PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: log,
        ...extraEnv,
      },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
    return { ...result, calls };
  }
  const readEnv = () => parseEnv(fs.readFileSync(envFile, 'utf8'));

  test('--env-only writes five distinct hex secrets to a 0600 .env and touches no docker', () => {
    const r = install(['--env-only', '-y']);
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
    const env = readEnv();
    const values = SECRETS.map((k) => env[k]);
    values.forEach((v) => expect(v).toMatch(HEX64));
    expect(new Set(values).size).toBe(5);
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o600);
    expect(env.COMPOSE_FILE).toBeUndefined();
    expect(env.NETHELPER_VERSION).toBeUndefined();
  });

  test('the generated secrets pass the backend production checks', () => {
    install(['--env-only', '-y']);
    const env = readEnv();
    const backendEnv = {
      NODE_ENV: 'production',
      DATABASE_URL: `postgresql://nethelper:${env.POSTGRES_PASSWORD}@postgres:5432/nethelper?schema=public`,
      JWT_SECRET: env.JWT_SECRET,
      JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
      ENCRYPTION_KEY: env.ENCRYPTION_KEY,
    };
    expect(validateEnv(backendEnv)).toEqual([]);
  });

  test('a second run changes nothing; an empty secret is filled and set values kept', () => {
    install(['--env-only', '-y']);
    const first = fs.readFileSync(envFile, 'utf8');
    install(['--env-only', '-y']);
    expect(fs.readFileSync(envFile, 'utf8')).toBe(first);

    const before = readEnv();
    fs.writeFileSync(envFile, first.replace(/^REDIS_PASSWORD=.*$/m, 'REDIS_PASSWORD='));
    const r = install(['--env-only', '-y']);
    expect(r.stdout).toContain('Generated: REDIS_PASSWORD');
    const after = readEnv();
    expect(after.REDIS_PASSWORD).toMatch(HEX64);
    expect(after.REDIS_PASSWORD).not.toBe(before.REDIS_PASSWORD);
    for (const key of SECRETS.filter((k) => k !== 'REDIS_PASSWORD')) expect(after[key]).toBe(before[key]);
  });

  test('--host-network sets COMPOSE_FILE (with an existing override file) and --http-port sets HTTP_PORT', () => {
    fs.writeFileSync(path.join(deployDir, 'docker-compose.override.yml'), 'services: {}\n');
    install(['--env-only', '-y', '--host-network', '--http-port', '9090']);
    const env = readEnv();
    expect(env.COMPOSE_FILE).toBe('docker-compose.yml:docker-compose.host-network.yml:docker-compose.override.yml');
    expect(env.HTTP_PORT).toBe('9090');
    expect(fs.readFileSync(envFile, 'utf8').match(/^COMPOSE_FILE=/gm)).toHaveLength(1);
  });

  test('--host-network leaves a COMPOSE_FILE that is already set', () => {
    fs.writeFileSync(envFile, 'COMPOSE_FILE=docker-compose.yml:custom.yml\n');
    const r = install(['--env-only', '-y', '--host-network']);
    expect(readEnv().COMPOSE_FILE).toBe('docker-compose.yml:custom.yml');
    expect(r.stderr).toContain('left it alone');
  });

  test('pulls the release images, starts, waits for health and creates the first admin', () => {
    const r = install(['-y', '--admin-email', 'admin@example.com', '--admin-name', 'Ada Admin']);
    expect(r.status).toBe(0);
    expect(r.calls).toContain('compose pull backend frontend');
    expect(r.calls).not.toContain('compose build');
    expect(r.calls).toContain('compose up -d');
    expect(r.calls).toContain('inspect --format {{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}} id-backend');
    expect(r.calls).toContain(
      'compose exec -T backend node scripts/user-manager.js create-admin --if-no-users --email admin@example.com --name Ada Admin'
    );
    expect(r.stdout).toContain('NetHelper is running: http://');
  });

  test('passes NETHELPER_ADMIN_PASSWORD by name, never its value', () => {
    const r = install(['-y', '--admin-email', 'a@example.com', '--admin-name', 'Ada'], {
      NETHELPER_ADMIN_PASSWORD: 'correct-horse-battery',
    });
    expect(r.status).toBe(0);
    const create = r.calls.find((c) => c.includes('create-admin'));
    expect(create).toContain('exec -T -e NETHELPER_ADMIN_PASSWORD backend');
    expect(r.calls.join('\n')).not.toContain('correct-horse-battery');
  });

  test('falls back to a local build when the pull fails', () => {
    const r = install(['-y', '--no-admin'], { FAKE_PULL_FAIL: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('docker login ghcr.io');
    const pull = r.calls.indexOf('compose pull backend frontend');
    expect(pull).toBeGreaterThanOrEqual(0);
    expect(r.calls.indexOf('compose build')).toBeGreaterThan(pull);
  });

  test('builds locally from a git checkout that is not the release tag', () => {
    execFileSync('git', ['init', '-q', tmp]);
    const r = install(['-y', '--no-admin']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("isn't the v1.2.3 release tag");
    expect(r.calls).not.toContain('compose pull backend frontend');
    expect(r.calls).toContain('compose build');
  });

  test('skips the admin when users exist, and when no email is given', () => {
    let r = install(['-y'], { FAKE_USERS: '3' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('3 user(s) already exist');
    expect(r.calls.some((c) => c.includes('create-admin'))).toBe(false);

    fs.rmSync(log);
    r = install(['-y']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('No admin email and name given; skipped');
    expect(r.calls.some((c) => c.includes('create-admin'))).toBe(false);
  });

  test('warns about a NETHELPER_VERSION pin that differs from the tree', () => {
    install(['--env-only', '-y']);
    fs.appendFileSync(envFile, 'NETHELPER_VERSION=0.9.0\n');
    const r = install(['-y', '--no-admin']);
    expect(r.stderr).toContain('pins NETHELPER_VERSION=0.9.0 but this tree is 1.2.3');
  });

  test('refuses the host-network override on Compose older than 2.24', () => {
    const r = install(['-y', '--host-network'], { FAKE_COMPOSE_VERSION: 'v2.20.2' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('needs Compose 2.24+');
    expect(r.calls).not.toContain('compose up -d');
  });
});

describe('deploy/systemd/nethelper-admin', () => {
  const script = path.join(REPO, 'deploy/systemd/nethelper-admin');
  const run = (args, envFile) =>
    spawnSync('sh', [script, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, NETHELPER_HOME: REPO, NETHELPER_ENV: envFile },
    });

  test('init-env writes a 0640 settings file whose passwords match what it prints', () => {
    const envFile = path.join(tmp, 'backend.env');
    const r = run(['init-env'], envFile);
    expect(r.status).toBe(0);
    expect(fs.statSync(envFile).mode & 0o777).toBe(0o640);

    const env = parseEnv(fs.readFileSync(envFile, 'utf8'));
    const db = /Database password[^:]*\): ([0-9a-f]{64})/.exec(r.stdout)[1];
    const redis = /Redis password[^:]*: +([0-9a-f]{64})/.exec(r.stdout)[1];
    expect(env.DATABASE_URL).toBe(`postgresql://nethelper:${db}@localhost:5432/nethelper?schema=public`);
    expect(env.REDIS_PASSWORD).toBe(redis);
    expect(validateEnv({ ...env, NODE_ENV: 'production' })).toEqual([]);
  });

  test('init-env never overwrites an existing file', () => {
    const envFile = path.join(tmp, 'backend.env');
    fs.writeFileSync(envFile, 'KEEP=1\n');
    const r = run(['init-env'], envFile);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('already exists');
    expect(fs.readFileSync(envFile, 'utf8')).toBe('KEEP=1\n');
  });

  test('rejects an unknown command', () => {
    const r = run(['frobnicate'], path.join(tmp, 'backend.env'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('unknown command');
  });
});
