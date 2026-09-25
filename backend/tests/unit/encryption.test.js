const encryption = require('../../src/utils/encryption');

function withKey(key, fn) {
  const saved = process.env.ENCRYPTION_KEY;
  if (key === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = key;
  try {
    return fn();
  } finally {
    process.env.ENCRYPTION_KEY = saved;
  }
}

describe('utils/encryption', () => {
  test('round-trips a value', () => {
    const cipher = encryption.encrypt('s3cret!');
    expect(cipher).not.toContain('s3cret');
    expect(cipher.split(':')).toHaveLength(4);
    expect(encryption.decrypt(cipher)).toBe('s3cret!');
  });

  test('uses a fresh salt and IV every time', () => {
    expect(encryption.encrypt('same')).not.toBe(encryption.encrypt('same'));
  });

  test('fails to decrypt under a different key', () => {
    const cipher = encryption.encrypt('s3cret!');
    expect(() => withKey('another-key-0123456789abcdef0123456789', () => encryption.decrypt(cipher)))
      .toThrow('Failed to decrypt data');
  });

  test('rejects tampered ciphertext (GCM auth tag)', () => {
    const [salt, iv, body, tag] = encryption.encrypt('s3cret!').split(':');
    const flipped = (body[0] === 'a' ? 'b' : 'a') + body.slice(1);
    expect(() => encryption.decrypt([salt, iv, flipped, tag].join(':'))).toThrow('Failed to decrypt data');
  });

  test('has no fallback key', () => {
    expect(() => withKey(undefined, () => encryption.encrypt('x'))).toThrow('Failed to encrypt data');
    expect(() => withKey(undefined, () => encryption.key)).toThrow(/ENCRYPTION_KEY is not set/);
  });

  test('passes empty values through as null', () => {
    expect(encryption.encrypt('')).toBeNull();
    expect(encryption.decrypt(null)).toBeNull();
  });

  test('field helpers encrypt, decrypt, and mask only the named fields', () => {
    const row = { username: 'admin', password: 'pw', apiKey: 'k', apiSecret: 's' };
    const enc = encryption.encryptFields(row);
    expect(enc.username).toBe('admin');
    expect(enc.password).not.toBe('pw');
    expect(encryption.decryptFields(enc)).toEqual(row);
    expect(encryption.maskFields(row)).toEqual({ ...row, password: '***', apiSecret: '***' });
    expect(row.password).toBe('pw'); // inputs are not mutated
  });
});
