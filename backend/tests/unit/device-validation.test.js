const express = require('express');
const request = require('supertest');
const { validateDevice } = require('../../src/middleware/validation.middleware');

const ID = 'b48dcfc0-06f2-466e-8cb8-0eef143294ca';

const app = express();
app.use(express.json());
app.put('/devices/:deviceId', validateDevice.update, (req, res) => res.json({ ok: true }));

const put = (body) => request(app).put(`/devices/${ID}`).send(body);

describe('device update validation', () => {
  it.each(['4c4ab4004080', '4C:4A:B4:00:40:80', '4c-4a-b4-00-40-80', '4c4a.b400.4080'])(
    'accepts MAC %s',
    async (macAddress) => {
      expect((await put({ macAddress })).status).toBe(200);
    },
  );

  it.each(['', null])('accepts an empty MAC (%p)', async (macAddress) => {
    expect((await put({ macAddress })).status).toBe(200);
  });

  it('rejects a malformed MAC and says why', async () => {
    const res = await put({ macAddress: '4c:4a-b4:00:40:80' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid MAC address');
  });
});

describe('device update validation: optional fields', () => {
  it.each(['', null])('accepts a blank IP address (%p): a cloud device may have none', async (ipAddress) => {
    expect((await put({ ipAddress })).status).toBe(200);
  });

  it('rejects a malformed IP address', async () => {
    const res = await put({ ipAddress: '10.0.0' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid IP address');
  });

  it.each(['', null])('accepts a blank location (%p)', async (location) => {
    expect((await put({ location })).status).toBe(200);
  });
});
