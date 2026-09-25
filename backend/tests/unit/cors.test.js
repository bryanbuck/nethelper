const { allowedOrigins } = require('../../src/config/cors');

const allows = (origins, origin) => origins.some((o) => (o instanceof RegExp ? o.test(origin) : o === origin));

describe('config/cors allowedOrigins', () => {
  test('production allows exactly CORS_ORIGINS plus FRONTEND_URL', () => {
    const origins = allowedOrigins({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://nethelper.example.com/, https://ops.example.com',
      FRONTEND_URL: 'https://nethelper.example.com',
    });
    expect(origins).toEqual(['https://nethelper.example.com', 'https://ops.example.com']);
    expect(allows(origins, 'http://localhost:5173')).toBe(false);
    expect(allows(origins, 'http://192.168.1.10:5173')).toBe(false);
  });

  test('development also allows localhost, private LAN, and .local origins', () => {
    const origins = allowedOrigins({ NODE_ENV: 'development' });
    for (const origin of [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://10.0.0.5:5173',
      'http://172.20.1.1',
      'http://192.168.1.10:5173',
      'http://dev-nethelper.buck.local:5173',
    ]) {
      expect(allows(origins, origin)).toBe(true);
    }
    for (const origin of ['http://172.32.0.1', 'https://evil.example.com', 'http://localhost.evil.com']) {
      expect(allows(origins, origin)).toBe(false);
    }
  });
});
