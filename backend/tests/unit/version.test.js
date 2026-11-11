const { compareVersions, isPrerelease, normalizeVersion } = require('../../src/utils/version');

describe('utils/version', () => {
  test('orders releases and pre-releases the way semver does', () => {
    const ordered = ['0.9.0-beta.8', '0.9.0-beta.10', '0.9.0-rc.1', '0.9.0', '0.9.1-beta.1', '0.9.1', '0.10.0', '1.0.0'];
    for (let i = 0; i < ordered.length - 1; i += 1) {
      expect(compareVersions(ordered[i], ordered[i + 1])).toBe(-1);
      expect(compareVersions(ordered[i + 1], ordered[i])).toBe(1);
    }
    expect(compareVersions('0.9.0', '0.9.0')).toBe(0);
  });

  test('ignores a leading v and build metadata', () => {
    expect(compareVersions('v0.9.1', '0.9.1+build.5')).toBe(0);
    expect(normalizeVersion('v0.9.1-beta.2')).toBe('0.9.1-beta.2');
  });

  test('a shorter pre-release sorts first; numbers sort before words', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0-beta.1')).toBe(-1);
    expect(compareVersions('1.0.0-1', '1.0.0-beta')).toBe(-1);
  });

  test('anything that is not a version compares as null', () => {
    expect(compareVersions('latest', '0.9.0')).toBeNull();
    expect(compareVersions('0.9', '0.9.0')).toBeNull();
    expect(normalizeVersion('nightly')).toBeNull();
  });

  test('isPrerelease', () => {
    expect(isPrerelease('0.9.1-beta.1')).toBe(true);
    expect(isPrerelease('0.9.1')).toBe(false);
    expect(isPrerelease('')).toBe(false);
  });
});
