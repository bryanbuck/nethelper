/**
 * The general API rate limit (middleware/rate-limit.js): per signed-in user,
 * per IP otherwise, and a JSON 429 with Retry-After.
 */
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { apiLimiter, rateLimitKey } = require('../../src/middleware/rate-limit');

const SECRET = 'test-secret-for-rate-limit-0123456789';
let savedSecret;
beforeAll(() => {
  savedSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = SECRET;
});
afterAll(() => {
  process.env.JWT_SECRET = savedSecret;
});

const token = (userId, secret = SECRET) => `Bearer ${jwt.sign({ userId }, secret)}`;

function app(max = 2) {
  const a = express();
  a.use('/api/', apiLimiter({ windowMs: 60000, max }));
  a.get('/api/ping', (req, res) => res.json({ ok: true }));
  return a;
}

describe('rateLimitKey', () => {
  test('a valid token keys by user; a bad or missing one by IP', () => {
    expect(rateLimitKey({ headers: { authorization: token('u1') }, ip: '127.0.0.1' })).toBe('user:u1');
    expect(rateLimitKey({ headers: { authorization: token('u1', 'other-secret') }, ip: '127.0.0.1' })).toBe('ip:127.0.0.1');
    expect(rateLimitKey({ headers: {}, ip: '127.0.0.1' })).toBe('ip:127.0.0.1');
  });
});

describe('apiLimiter', () => {
  test('two users behind one proxy have their own budgets', async () => {
    const a = app();
    for (let i = 0; i < 2; i++) {
      expect((await request(a).get('/api/ping').set('Authorization', token('u1'))).status).toBe(200);
    }
    expect((await request(a).get('/api/ping').set('Authorization', token('u1'))).status).toBe(429);
    expect((await request(a).get('/api/ping').set('Authorization', token('u2'))).status).toBe(200);
  });

  test('a limited request gets JSON and Retry-After', async () => {
    const a = app(1);
    await request(a).get('/api/ping');
    const res = await request(a).get('/api/ping');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
  });
});
