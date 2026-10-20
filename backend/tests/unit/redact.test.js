const { redact, isSecretKey, MASK } = require('../../src/utils/redact');

describe('utils/redact', () => {
  test('masks secret-looking keys at any depth without mutating the input', () => {
    const input = {
      user: 'admin',
      password: 'pw',
      nested: { clientSecret: 'cs', api_key: 'k', list: [{ token: 't', name: 'x' }] },
      headers: { Authorization: 'Bearer abc' },
    };
    const out = redact(input);
    expect(out).toEqual({
      user: 'admin',
      password: MASK,
      nested: { clientSecret: MASK, api_key: MASK, list: [{ token: MASK, name: 'x' }] },
      headers: { Authorization: MASK },
    });
    expect(input.password).toBe('pw');
  });

  test('leaves descriptive keys alone', () => {
    for (const key of ['hasPassword', 'tokenLength', 'authHeaderType', 'credentialId', 'tokenPrefix']) {
      expect(isSecretKey(key)).toBe(false);
    }
    expect(redact({ hasPassword: true, refreshTokenLength: 200 })).toEqual({ hasPassword: true, refreshTokenLength: 200 });
  });

  test('survives cycles', () => {
    const a = { name: 'a' };
    a.self = a;
    expect(redact(a)).toEqual({ name: 'a', self: '[Truncated]' });
  });
});
