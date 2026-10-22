const { deviceStorageKey, normalizeSerial, macVariants } = require('../../src/utils/device-key');

describe('utils/device-key', () => {
  test('storage key is the serial when present, else device-<id>', () => {
    expect(deviceStorageKey({ id: 'abc', serial: 'SG12345' })).toBe('SG12345');
    expect(deviceStorageKey({ id: 'abc', serial: '  SG12345 ' })).toBe('SG12345');
    expect(deviceStorageKey({ id: 'abc', serial: null })).toBe('device-abc');
    expect(deviceStorageKey({ id: 'abc', serial: '   ' })).toBe('device-abc');
  });

  test('normalizeSerial stores blanks as null and leaves undefined alone', () => {
    expect(normalizeSerial(undefined)).toBeUndefined();
    expect(normalizeSerial('')).toBeNull();
    expect(normalizeSerial('   ')).toBeNull();
    expect(normalizeSerial(null)).toBeNull();
    expect(normalizeSerial(' SG1 ')).toBe('SG1');
  });

  test('macVariants lists the spellings providers store a MAC in', () => {
    expect(macVariants('4C4AB43B7980')).toEqual(['4c:4a:b4:3b:79:80', '4c4ab43b7980', '4c-4a-b4-3b-79-80', '4c4a.b43b.7980']);
    expect(macVariants('not a mac')).toEqual([]);
  });
});
