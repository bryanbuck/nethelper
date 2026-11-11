/**
 * deploy/install.sh and deploy/systemd/nethelper-admin, run for real in a temp
 * tree. Docker is a fake on PATH that logs its arguments, so the installer's
 * whole flow runs without a Docker host. The upgrade commands get a fake curl
 * serving a release tarball built here, and fake systemctl/npm/id.
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
      up) [ -z "\${FAKE_UP_FAIL:-}" ] || exit 1 ;;
      exec)
        case "$*" in
          *count-users*) echo "\${FAKE_USERS:-0}" ;;
          *app-backup.js*)
            [ -z "\${FAKE_BACKUP_FAIL:-}" ] || { echo "Application backup failed: pg_dump is not installed" >&2; exit 1; }
            echo "archive: nethelper-1.2.3-20261111T000000Z.tar.gz" ;;
        esac ;;
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

  test('restore needs an archive, and root to switch to the service user', () => {
    const envFile = path.join(tmp, 'backend.env');
    let r = run(['restore'], envFile);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('usage: nethelper-admin restore <archive>');
    if (process.getuid && process.getuid() !== 0) {
      // --dry-run never stops the service; it then needs root like every script command
      r = run(['restore', '/tmp/x.tar.gz', '--dry-run'], envFile);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('run as root');
    }
  });

  test('rejects an unknown command', () => {
    const r = run(['frobnicate'], path.join(tmp, 'backend.env'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('unknown command');
  });
});

// ---------------------------------------------------------------- upgrades

// Serves files from $FAKE_RELEASES by the URL's last path segment.
const FAKE_CURL = `#!/bin/sh
dest=; url=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) dest=$2; shift ;;
    --max-time) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
printf '%s\\n' "$url" >> "$FAKE_CURL_LOG"
case "$url" in
  */health/ready) [ -z "\${FAKE_HEALTH_FAIL:-}" ]; exit ;;
  */releases/latest) src="$FAKE_RELEASES/latest.json" ;;
  *) src="$FAKE_RELEASES/$(basename "$url")" ;;
esac
[ -f "$src" ] || exit 22
cp "$src" "$dest"
`;

const LOGGING_TOOL = (name, body = '') => `#!/bin/sh
printf '${name} %s\\n' "$*" >> "$FAKE_TOOL_LOG"
${body}
exit 0
`;

/** A NetHelper tree with the real deploy scripts and the given migrations. */
function makeTree(dir, version, migrations, extra = {}) {
  fs.mkdirSync(path.join(dir, 'deploy/systemd'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'deploy/nginx'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'frontend/nginx'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'frontend/dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'VERSION'), `${version}\n`);
  for (const file of ['install.sh', 'upgrade-lib.sh', '.env.example', 'systemd/nethelper-admin']) {
    fs.copyFileSync(path.join(REPO, 'deploy', file), path.join(dir, 'deploy', file));
  }
  fs.writeFileSync(path.join(dir, 'deploy/systemd/nethelper-backend.service'), extra.unit || '[Service]\n');
  fs.writeFileSync(path.join(dir, 'deploy/nginx/nethelper.conf'), 'server {}\n');
  fs.writeFileSync(path.join(dir, 'frontend/nginx/security-headers.conf'), '# headers\n');
  fs.writeFileSync(path.join(dir, 'frontend/dist/index.html'), `<!-- ${version} -->\n`);
  fs.mkdirSync(path.join(dir, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'backend/package.json'), '{}\n');
  for (const migration of migrations) {
    fs.mkdirSync(path.join(dir, 'backend/prisma/migrations', migration), { recursive: true });
    fs.writeFileSync(path.join(dir, 'backend/prisma/migrations', migration, 'migration.sql'), '-- sql\n');
  }
}

/** Publish nethelper-<version>.tar.gz + .sha256 into the fake release folder. */
function publish(releases, version, migrations, extra = {}) {
  const build = fs.mkdtempSync(path.join(releases, 'build-'));
  makeTree(path.join(build, `nethelper-${version}`), version, migrations, extra);
  const name = `nethelper-${version}.tar.gz`;
  execFileSync('tar', ['czf', path.join(releases, name), '-C', build, `nethelper-${version}`]);
  const sum = execFileSync('sha256sum', [name], { cwd: releases, encoding: 'utf8' });
  fs.writeFileSync(path.join(releases, `${name}.sha256`), sum);
  fs.rmSync(build, { recursive: true, force: true });
}

describe('upgrade commands', () => {
  let site;
  let tree;
  let releases;
  let dockerLog;
  let toolLog;
  let env;
  const version = (dir) => fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim();
  const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n') : []);
  const leftovers = () => fs.readdirSync(site).filter((entry) => entry.startsWith('.nethelper-upgrade'));

  beforeEach(() => {
    site = path.join(tmp, 'site');
    tree = path.join(site, 'nethelper');
    releases = path.join(tmp, 'releases');
    fs.mkdirSync(releases);
    fs.mkdirSync(path.join(tmp, 'bin'));
    makeTree(tree, '1.2.3', ['001_init']);
    fs.writeFileSync(path.join(tree, 'deploy/.env'), 'POSTGRES_PASSWORD=keepme\nHTTP_PORT=9000\n');
    fs.writeFileSync(path.join(releases, 'latest.json'), '{\n  "url": "x",\n  "tag_name": "v1.3.0",\n  "name": "NetHelper 1.3.0"\n}\n');
    publish(releases, '1.3.0', ['001_init', '002_more'], { unit: '[Service]\n# changed\n' });
    fs.writeFileSync(path.join(tmp, 'bin/docker'), FAKE_DOCKER, { mode: 0o755 });
    fs.writeFileSync(path.join(tmp, 'bin/curl'), FAKE_CURL, { mode: 0o755 });
    dockerLog = path.join(tmp, 'docker.log');
    toolLog = path.join(tmp, 'tools.log');
    env = {
      PATH: `${path.join(tmp, 'bin')}:${process.env.PATH}`,
      FAKE_DOCKER_LOG: dockerLog,
      FAKE_CURL_LOG: path.join(tmp, 'curl.log'),
      FAKE_TOOL_LOG: toolLog,
      FAKE_RELEASES: releases,
    };
  });

  describe('install.sh --upgrade', () => {
    const upgrade = (args = [], extraEnv = {}) =>
      spawnSync('sh', [path.join(tree, 'deploy/install.sh'), '--upgrade', ...args], {
        input: '',
        encoding: 'utf8',
        env: { ...env, ...extraEnv },
      });

    test('backs up, swaps the trees, carries the settings over and runs the new installer', () => {
      fs.writeFileSync(path.join(tree, 'deploy/docker-compose.override.yml'), 'services: {}\n');
      const r = upgrade();
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(version(tree)).toBe('1.3.0');
      expect(version(`${tree}.previous`)).toBe('1.2.3');
      expect(fs.readFileSync(path.join(tree, 'deploy/.env'), 'utf8')).toContain('POSTGRES_PASSWORD=keepme\nHTTP_PORT=9000\n');
      expect(fs.readFileSync(path.join(tree, 'deploy/docker-compose.override.yml'), 'utf8')).toBe('services: {}\n');
      expect(leftovers()).toEqual([]);
      expect(r.stdout).toContain('Backup written: nethelper-1.2.3-20261111T000000Z.tar.gz');

      const calls = lines(dockerLog);
      const backup = calls.indexOf('compose exec -T backend node scripts/app-backup.js');
      const pull = calls.indexOf('compose pull backend frontend');
      const up = calls.indexOf('compose up -d');
      expect(backup).toBeGreaterThan(-1);
      expect(pull).toBeGreaterThan(backup);
      expect(up).toBeGreaterThan(pull);
      // The new installer ran with users untouched
      expect(calls.some((c) => c.includes('create-admin'))).toBe(false);
    });

    test('a download that fails its checksum changes nothing', () => {
      fs.writeFileSync(path.join(releases, 'nethelper-1.3.0.tar.gz.sha256'), `${'0'.repeat(64)}  nethelper-1.3.0.tar.gz\n`);
      const r = upgrade();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("doesn't match its checksum");
      expect(version(tree)).toBe('1.2.3');
      expect(fs.existsSync(`${tree}.previous`)).toBe(false);
      expect(leftovers()).toEqual([]);
      expect(lines(dockerLog).some((c) => c.includes('app-backup.js') || c === 'compose up -d')).toBe(false);
    });

    test('a failed backup stops before the swap; --no-backup goes ahead without one', () => {
      let r = upgrade([], { FAKE_BACKUP_FAIL: '1' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('the backup failed');
      expect(version(tree)).toBe('1.2.3');
      expect(fs.existsSync(`${tree}.previous`)).toBe(false);
      expect(leftovers()).toEqual([]);

      fs.rmSync(dockerLog);
      r = upgrade(['--no-backup'], { FAKE_BACKUP_FAIL: '1' });
      expect(r.status).toBe(0);
      expect(version(tree)).toBe('1.3.0');
      expect(lines(dockerLog).some((c) => c.includes('app-backup.js'))).toBe(false);
    });

    test('refuses a git checkout, and a pinned NETHELPER_VERSION', () => {
      fs.mkdirSync(path.join(tree, '.git'));
      let r = upgrade();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('git pull');
      fs.rmSync(path.join(tree, '.git'), { recursive: true });

      fs.appendFileSync(path.join(tree, 'deploy/.env'), 'NETHELPER_VERSION=1.2.3\n');
      r = upgrade();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('pins NETHELPER_VERSION=1.2.3');
      expect(version(tree)).toBe('1.2.3');
      expect(fs.existsSync(path.join(tmp, 'curl.log'))).toBe(false);
    });

    test('already on the newest release: nothing to do', () => {
      fs.writeFileSync(path.join(releases, 'latest.json'), '{ "tag_name": "v1.2.3" }\n');
      const r = upgrade();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('already NetHelper 1.2.3');
      expect(fs.existsSync(`${tree}.previous`)).toBe(false);
      expect(leftovers()).toEqual([]);
    });

    test('--version picks a release; a version that is not one is refused', () => {
      publish(releases, '1.4.0-beta.1', ['001_init']);
      let r = upgrade(['--version', 'v1.4.0-beta.1']);
      expect(r.status).toBe(0);
      expect(version(tree)).toBe('1.4.0-beta.1');

      r = upgrade(['--version', '../../etc']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('not a version');
    });

    test('refuses a release older than the database', () => {
      publish(releases, '1.1.0', []);
      const r = upgrade(['--version', '1.1.0']);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("Downgrading isn't supported");
      expect(version(tree)).toBe('1.2.3');
    });

    test('when the new version does not start, says how to go back and whether the database changed', () => {
      let r = upgrade([], { FAKE_UP_FAIL: '1' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('NetHelper 1.3.0 did not come up healthy');
      expect(r.stdout).toContain(`The 1.2.3 tree is kept at: ${tree}.previous`);
      expect(r.stdout).toContain('Backup taken before the upgrade: nethelper-1.2.3-20261111T000000Z.tar.gz');
      expect(r.stdout).toContain('002_more');
      expect(r.stdout).toContain('restore the backup before starting 1.2.3');

      // Back to 1.2.3 by hand, then a release with no new migrations
      fs.rmSync(tree, { recursive: true });
      fs.renameSync(`${tree}.previous`, tree);
      publish(releases, '1.2.4', ['001_init']);
      r = upgrade(['--version', '1.2.4', '--no-backup'], { FAKE_UP_FAIL: '1' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('1.2.4 changes nothing in the database');
      expect(r.stdout).toContain('No backup was taken by this upgrade');
    });

    test('keeps one previous tree: the next upgrade replaces it', () => {
      expect(upgrade().status).toBe(0);
      publish(releases, '1.5.0', ['001_init', '002_more']);
      const r = upgrade(['--version', '1.5.0']);
      expect(r.status).toBe(0);
      expect(version(tree)).toBe('1.5.0');
      expect(version(`${tree}.previous`)).toBe('1.3.0');
      expect(r.stdout).toContain('Removing the tree kept by the upgrade before this one');
    });

    test('never deletes a .previous folder that is not a NetHelper tree', () => {
      fs.mkdirSync(`${tree}.previous`);
      fs.writeFileSync(path.join(`${tree}.previous`, 'mine.txt'), 'keep\n');
      const r = upgrade();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('move it away first');
      expect(fs.readFileSync(path.join(`${tree}.previous`, 'mine.txt'), 'utf8')).toBe('keep\n');
      expect(version(tree)).toBe('1.2.3');
    });

    test('--version and --no-backup need --upgrade', () => {
      const r = spawnSync('sh', [path.join(tree, 'deploy/install.sh'), '--no-backup'], { input: '', encoding: 'utf8', env });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('only apply to --upgrade');
    });
  });

  describe('nethelper-admin upgrade', () => {
    beforeEach(() => {
      // "root", and the host tools the upgrade drives
      fs.writeFileSync(path.join(tmp, 'bin/id'), '#!/bin/sh\necho 0\n', { mode: 0o755 });
      fs.writeFileSync(path.join(tmp, 'bin/npm'), LOGGING_TOOL('npm', '[ -z "${FAKE_NPM_FAIL:-}" ] || { echo "npm ERR! boom"; exit 1; }'), { mode: 0o755 });
      fs.writeFileSync(path.join(tmp, 'bin/npx'), LOGGING_TOOL('npx'), { mode: 0o755 });
      fs.writeFileSync(path.join(tmp, 'bin/systemctl'), LOGGING_TOOL('systemctl'), { mode: 0o755 });
      fs.writeFileSync(path.join(tmp, 'backend.env'), 'PORT=3055\n');
    });
    const upgrade = (args = [], extraEnv = {}) =>
      spawnSync('sh', [path.join(tree, 'deploy/systemd/nethelper-admin'), 'upgrade', '--no-backup', ...args], {
        input: '',
        encoding: 'utf8',
        env: { ...env, NETHELPER_HOME: tree, NETHELPER_ENV: path.join(tmp, 'backend.env'), NETHELPER_HEALTH_TIMEOUT: '0', ...extraEnv },
      });

    test('prepares the new tree, stops, swaps, starts and waits for health', () => {
      const r = upgrade();
      expect(r.stderr).toBe('');
      expect(r.status).toBe(0);
      expect(version(tree)).toBe('1.3.0');
      expect(version(`${tree}.previous`)).toBe('1.2.3');
      expect(leftovers()).toEqual([]);
      expect(lines(toolLog)).toEqual([
        'npm ci --omit=dev --no-audit --no-fund',
        'npx prisma generate',
        'systemctl is-active --quiet nethelper-backend',
        'systemctl stop nethelper-backend',
        'systemctl start nethelper-backend',
      ]);
      expect(lines(path.join(tmp, 'curl.log')).pop()).toBe('http://127.0.0.1:3055/health/ready');
      // The unit file differs between the two releases; the others don't
      expect(r.stdout).toContain(`${tree}/deploy/systemd/nethelper-backend.service`);
      expect(r.stdout).not.toContain(`${tree}/deploy/nginx/nethelper.conf`);
    });

    test('a dependency install that fails leaves the running tree alone', () => {
      const r = upgrade([], { FAKE_NPM_FAIL: '1' });
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('npm ERR! boom');
      expect(r.stderr).toContain('nothing was changed');
      expect(version(tree)).toBe('1.2.3');
      expect(lines(toolLog).some((l) => l.startsWith('systemctl'))).toBe(false);
      expect(leftovers()).toEqual([]);
    });

    test('a service that does not come up healthy gets the way back', () => {
      const r = upgrade([], { FAKE_HEALTH_FAIL: '1' });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('NetHelper 1.3.0 did not come up healthy');
      expect(r.stdout).toContain('systemctl stop nethelper-backend');
      expect(r.stdout).toContain('002_more');
      expect(r.stdout).toContain('journalctl -u nethelper-backend');
    });

    test('refuses a git checkout and needs root', () => {
      fs.mkdirSync(path.join(tree, '.git'));
      let r = upgrade();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('git checkout');
      fs.rmSync(path.join(tree, '.git'), { recursive: true });

      fs.writeFileSync(path.join(tmp, 'bin/id'), '#!/bin/sh\necho 1000\n', { mode: 0o755 });
      r = upgrade();
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain('run as root');
    });
  });
});
