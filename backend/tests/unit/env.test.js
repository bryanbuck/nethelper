const { validateEnv } = require('../../src/config/env');

const STRONG = {
  DATABASE_URL: 'postgresql://u:p@db/nethelper',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  ENCRYPTION_KEY: 'c'.repeat(40),
};

describe('config/env validateEnv', () => {
  test('accepts a complete config and writes defaults back', () => {
    const env = { ...STRONG, NODE_ENV: 'production' };
    expect(validateEnv(env)).toEqual([]);
    expect(env.PORT).toBe('3000');
    expect(env.JWT_EXPIRES_IN).toBe('1h');
    expect(env.AUTH_RATE_LIMIT_MAX).toBe('10');
  });

  test.each(['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'])(
    'missing %s is fatal even in development',
    (key) => {
      const env = { ...STRONG, NODE_ENV: 'development' };
      delete env[key];
      expect(() => validateEnv(env)).toThrow(key);
    }
  );

  test.each([
    ['a placeholder secret', { JWT_SECRET: 'your-super-secret-jwt-key' }, /placeholder/],
    ['the legacy default encryption key', { ENCRYPTION_KEY: 'default-key-change-this-in-production-for-security' }, /placeholder/],
    ['a short secret', { ENCRYPTION_KEY: 'short' }, /shorter than 32/],
    ['identical JWT secrets', { JWT_REFRESH_SECRET: 'a'.repeat(40) }, /must be different/],
  ])('%s is fatal in production and a warning in development', (_label, override, pattern) => {
    expect(() => validateEnv({ ...STRONG, ...override, NODE_ENV: 'production' })).toThrow(pattern);
    const warnings = validateEnv({ ...STRONG, ...override, NODE_ENV: 'development' });
    expect(warnings.join('\n')).toMatch(pattern);
  });

  test('rejects an unknown NODE_ENV', () => {
    expect(() => validateEnv({ ...STRONG, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
