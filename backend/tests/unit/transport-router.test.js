const { resolveTransport } = require('../../src/utils/transport-router');
const { detectPlatform, detectVendor, isCxRestCapable, useSshTransport } = require('../../src/utils/device-platform');
const { TRANSPORT_MATRIX, PLATFORMS } = require('../../src/constants/vendors');

const direct = (fields) => ({ managementMode: 'direct', type: 'switch', ...fields });
const cloud = (fields) => ({ managementMode: 'cloud', type: 'switch', ...fields });

describe('utils/transport-router resolveTransport', () => {
  // Pinned expectations: a change here changes how NetHelper reaches real
  // devices, so it should be deliberate.
  test.each([
    // [label, device, config, test, poll]
    ['direct AOS-CX', direct({ vendor: 'aruba', platform: 'aos-cx' }), ['device-rest'], ['device-rest'], ['device-rest']],
    ['direct AOS-S', direct({ vendor: 'aruba', platform: 'aos-s' }), ['ssh'], ['ssh'], ['ssh']],
    ['direct Junos (NETCONF, SSH fallback)', direct({ vendor: 'juniper', platform: 'junos' }),
      ['device-rest', 'ssh'], ['device-rest', 'ssh'], ['device-rest', 'ssh']],
    ['direct IOS-XE', direct({ vendor: 'cisco', platform: 'ios-xe' }), ['ssh'], ['ssh'], ['ssh']],
    ['direct Meraki (no direct transport)', direct({ vendor: 'cisco', platform: 'meraki' }), [], [], []],
    ['unclassified switch', direct({ vendor: 'aruba', model: 'mystery' }), ['ssh'], ['device-rest'], ['ssh']],
    ['unclassified AP', direct({ type: 'access_point', vendor: 'aruba' }), ['ssh'], ['ssh'], ['ssh']],
    ['cloud AOS-CX keeps device REST first', cloud({ vendor: 'aruba', platform: 'aos-cx' }),
      ['device-rest', 'cloud'], ['device-rest', 'cloud'], ['device-rest', 'cloud']],
    ['cloud AOS-S never SSHes', cloud({ vendor: 'aruba', platform: 'aos-s' }), ['cloud'], ['cloud'], ['cloud']],
    ['cloud Mist switch (Junos)', cloud({ vendor: 'juniper', platform: 'junos' }),
      ['device-rest', 'cloud'], ['device-rest', 'cloud'], ['device-rest', 'cloud']],
    ['cloud Mist AP', cloud({ type: 'access_point', vendor: 'juniper', platform: null }), ['cloud'], ['cloud'], ['cloud']],
    ['cloud Central AP', cloud({ type: 'access_point', vendor: 'aruba' }), ['cloud'], ['cloud'], ['cloud']],
  ])('%s', (_label, device, config, testOp, poll) => {
    expect(resolveTransport(device, 'config')).toEqual(config);
    expect(resolveTransport(device, 'test')).toEqual(testOp);
    expect(resolveTransport(device, 'poll')).toEqual(poll);
  });

  test('rejects an unknown operation', () => {
    expect(() => resolveTransport(direct({}), 'reboot')).toThrow(/Unknown transport operation/);
  });

  test('returns a copy, not the matrix row', () => {
    const result = resolveTransport(direct({ vendor: 'aruba', platform: 'aos-s' }), 'config');
    result.push('cloud');
    expect(TRANSPORT_MATRIX['aruba/aos-s'].config).toEqual(['ssh']);
  });

  test('every platform has a matrix row under its vendor', () => {
    for (const [id, platform] of Object.entries(PLATFORMS)) {
      expect(TRANSPORT_MATRIX[`${platform.vendor}/${id}`]).toBeDefined();
    }
  });
});

describe('utils/device-platform', () => {
  test('the platform column wins over model heuristics', () => {
    expect(detectPlatform({ platform: 'aos-s', model: '6300M' })).toBe('aos-s');
  });

  test('ignores an invalid platform value', () => {
    expect(detectPlatform({ platform: 'bogus', model: '6300M' })).toBe('aos-cx');
  });

  test.each([
    ['6300M', 'aos-cx'],
    ['8360-32Y4C', 'aos-cx'],
    ['6400', 'aos-cx'],
    ['Aruba CX 6100', 'aos-cx'],
    ['2930F', 'aos-s'],
    ['5406R', 'aos-s'],
    ['3810M', 'aos-s'],
    ['AP-515', 'unknown'],
  ])('legacy Aruba model %s -> %s', (model, platform) => {
    expect(detectPlatform({ vendor: 'aruba', model })).toBe(platform);
  });

  test('uses the reported OS before the model', () => {
    expect(detectPlatform({ metadata: { operatingSystem: 'AOS-Switch' }, model: '6300M' })).toBe('aos-s');
  });

  test('never applies Aruba heuristics to another vendor', () => {
    expect(detectPlatform({ vendor: 'juniper', model: '6300' })).toBe('unknown');
  });

  test('detectVendor falls back to the platform vendor, then aruba', () => {
    expect(detectVendor({ vendor: 'cisco' })).toBe('cisco');
    expect(detectVendor({ platform: 'junos' })).toBe('juniper');
    expect(detectVendor({})).toBe('aruba');
  });

  test('only switches are CX REST capable', () => {
    expect(isCxRestCapable({ type: 'switch', platform: 'aos-cx' })).toBe(true);
    expect(isCxRestCapable({ type: 'gateway', platform: 'aos-cx' })).toBe(false);
  });

  test('useSshTransport', () => {
    expect(useSshTransport({ managementMode: 'cloud', type: 'switch', platform: 'aos-s' })).toBe(false);
    expect(useSshTransport({ type: 'switch', platform: 'aos-cx' })).toBe(false);
    expect(useSshTransport({ type: 'switch', vendor: 'aruba', model: 'mystery' })).toBe(false);
    expect(useSshTransport({ type: 'switch', platform: 'aos-s' })).toBe(true);
    expect(useSshTransport({ type: 'access_point', vendor: 'aruba' })).toBe(true);
  });
});
