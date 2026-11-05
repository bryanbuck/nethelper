const { cxFirmwareImages, runningVersion } = require('../../src/utils/firmware-images');
const live = require('../fixtures/aos-cx-live/firmware.json');

const at = new Date('2026-11-04T21:00:00Z');

test('normalizes a live AOS-CX /firmware reply', () => {
  expect(cxFirmwareImages(live['booted-primary'], at)).toEqual({
    primary: 'ML.10.16.1010',
    secondary: 'ML.10.16.1006',
    defaultImage: 'primary',
    bootedImage: 'primary',
    running: 'ML.10.16.1010',
    source: 'aos-cx-rest',
    checkedAt: '2026-11-04T21:00:00.000Z',
  });
});

test('unknown image names become null, and an empty reply is no images', () => {
  const images = cxFirmwareImages({ primary_version: 'X', default_image: 'tertiary', booted_image: '' }, at);
  expect(images.defaultImage).toBeNull();
  expect(images.bootedImage).toBeNull();
  expect(cxFirmwareImages({ default_image: 'primary' }, at)).toBeNull();
  expect(cxFirmwareImages(null)).toBeNull();
});

test('runningVersion prefers the reported version, then the booted partition', () => {
  expect(runningVersion(cxFirmwareImages(live['booted-secondary'], at))).toBe('FL.10.16.1006');
  expect(runningVersion({ primary: 'A', secondary: 'B', bootedImage: 'secondary', running: null })).toBe('B');
  expect(runningVersion({ primary: 'A', bootedImage: null, running: null })).toBeNull();
  expect(runningVersion(null)).toBeNull();
});
