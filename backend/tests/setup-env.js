// Runs before every test file, ahead of any module that reads process.env at
// load time. Tests never touch the real database, Redis, or .env: anything
// that needs Prisma mocks config/database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/nethelper_test';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012345';
process.env.JWT_EXPIRES_IN = '1h';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.ENCRYPTION_KEY = 'test-encryption-key-0123456789abcdef012345';
// High enough that the auth suite's deliberate failures don't trip the limiter.
process.env.AUTH_RATE_LIMIT_MAX = '1000';
