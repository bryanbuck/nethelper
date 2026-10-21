/**
 * Every place that names the release version agrees with VERSION, so a release
 * bump can't miss one. The release workflow also checks that the tag is
 * v<VERSION> (.github/workflows/release.yml).
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const read = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');
const VERSION = read('VERSION').trim();

describe('release version', () => {
  test('VERSION is a semantic version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/);
  });

  test.each(['backend/package.json', 'frontend/package.json'])('%s version', (file) => {
    expect(JSON.parse(read(file)).version).toBe(VERSION);
  });

  test('docker-compose.yml image tags and build arg default to it', () => {
    const defaults = [...read('deploy/docker-compose.yml').matchAll(/\$\{NETHELPER_VERSION:-([^}]+)\}/g)].map((m) => m[1]);
    expect(defaults.length).toBeGreaterThanOrEqual(3);
    defaults.forEach((v) => expect(v).toBe(VERSION));
  });

  test('the frontend Dockerfile build arg defaults to it', () => {
    expect(read('frontend/Dockerfile')).toMatch(new RegExp(`^ARG VITE_APP_VERSION=${VERSION.replace(/\./g, '\\.')}$`, 'm'));
  });
});
