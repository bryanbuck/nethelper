const request = require('supertest');

const mockDb = { $queryRaw: jest.fn() };
const mockRedis = { ping: jest.fn() };
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockDb }));
jest.mock('../../src/config/redis', () => ({ getRedis: () => mockRedis }));

const app = require('../../src/app');
const { version } = require('../../package.json');

describe('health endpoints', () => {
  test('/health is a liveness probe that needs no dependencies', async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'healthy', version });
  });

  test('/health/ready is 200 when the database and Redis answer', async () => {
    mockDb.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
    mockRedis.ping.mockResolvedValue('PONG');
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ready', checks: { database: 'up', redis: 'up' } });
  });

  test('/health/ready is 503 and names the failed dependency without details', async () => {
    mockDb.$queryRaw.mockResolvedValue([]);
    mockRedis.ping.mockRejectedValue(new Error('ECONNREFUSED 10.0.0.5:6379'));
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ database: 'up', redis: 'down' });
    expect(JSON.stringify(res.body)).not.toContain('ECONNREFUSED');
  });

  test('/health/ready treats "not initialized" as down', async () => {
    mockDb.$queryRaw.mockImplementation(() => {
      throw new Error('Database not initialized');
    });
    mockRedis.ping.mockResolvedValue('PONG');
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe('down');
  });
});
