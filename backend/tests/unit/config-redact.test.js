const { redactConfigSecrets, isConfigSecretKey } = require('../../src/utils/config-redact');

describe('redactConfigSecrets', () => {
  const saved = process.env.ENCRYPTION_KEY;
  afterAll(() => { process.env.ENCRYPTION_KEY = saved; });
  beforeEach(() => { process.env.ENCRYPTION_KEY = 'test-key-for-hmac-fingerprints-0123456789'; });

  test('matches secret keys across naming styles, not keys that describe them', () => {
    for (const key of ['psk', 'password', 'shared-secret', 'plaintext-value', 'api_key', 'privateKey', 'community']) {
      expect(isConfigSecretKey(key)).toBe(true);
    }
    for (const key of ['secret-type', 'password_policy', 'auth', 'ssid', 'tokenTtl']) {
      expect(isConfigSecretKey(key)).toBe(false);
    }
  });

  test('fingerprints change with the secret and not otherwise; the input is untouched', () => {
    const input = { wlans: [{ ssid: 'Corp', auth: { type: 'psk', psk: 'hunter2hunter2' } }], password_policy: { enabled: true } };
    const once = redactConfigSecrets(input);
    expect(once.wlans[0].auth.psk).toMatch(/^\[REDACTED hmac:[0-9a-f]{16}\]$/);
    expect(once.wlans[0].auth.type).toBe('psk');
    expect(once.password_policy).toEqual({ enabled: true });
    expect(redactConfigSecrets(input)).toEqual(once);
    const rotated = redactConfigSecrets({ wlans: [{ ssid: 'Corp', auth: { type: 'psk', psk: 'changed-secret' } }] });
    expect(rotated.wlans[0].auth.psk).not.toBe(once.wlans[0].auth.psk);
    expect(input.wlans[0].auth.psk).toBe('hunter2hunter2');
  });

  test('empty values, flags and nested secret containers', () => {
    const out = redactConfigSecrets({ password: '', secret: true, keys: { psk: 'x' }, token: ['a', 'b'] });
    expect(out.password).toBe('');
    expect(out.secret).toBe(true);
    expect(out.keys.psk).toMatch(/REDACTED/);
    expect(out.token).toHaveLength(2);
    expect(out.token[0]).toMatch(/REDACTED/);
  });

  test('without a key it masks without a fingerprint', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(redactConfigSecrets({ psk: 'x' })).toEqual({ psk: '[REDACTED]' });
  });
});
