/**
 * A rejected CX login: a real 6200F answers 401 with the body "Login failed.\n".
 * The error used to be "Login failed with status 401: Unauthorized", which
 * dropped the switch's reply and didn't say the password was the problem.
 */
jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');
const CXSwitchAPI = require('../../src/services/device-api/cx-switch-api');

const device = { id: 'd1', name: 'Sw-Access1', ipAddress: '192.0.2.14', type: 'switch', vendor: 'aruba', platform: 'aos-cx' };

test('a 401 says the switch rejected the credentials and keeps its reply', async () => {
  axios.post.mockResolvedValue({ status: 401, statusText: 'Unauthorized', data: 'Login failed.\n', headers: {} });
  const api = new CXSwitchAPI(device, { username: 'nethelper', password: 'wrong' });
  await expect(api.login()).rejects.toThrow('The switch rejected the username or password (HTTP 401: Login failed.)');
});

describe('request timeouts', () => {
  test('login and logout carry a timeout, so a silent switch cannot hold the caller', async () => {
    axios.post.mockResolvedValue({ status: 200, statusText: 'OK', data: '', headers: { 'set-cookie': ['id=abc; Path=/'] } });
    const api = new CXSwitchAPI({ name: 'sw', ipAddress: '10.0.0.2' }, { username: 'u', password: 'p' });
    await api.login();
    await api.logout();
    expect(axios.post).toHaveBeenCalledTimes(2);
    for (const call of axios.post.mock.calls) expect(call[2].timeout).toBe(15000);
  });

  test('the request timeout defaults to 30 s and follows CX_REST_TIMEOUT', () => {
    const device = { name: 'sw', ipAddress: '10.0.0.2' };
    expect(new CXSwitchAPI(device, {}).requestTimeout).toBe(30000);
    process.env.CX_REST_TIMEOUT = '5000';
    try {
      expect(new CXSwitchAPI(device, {}).requestTimeout).toBe(5000);
    } finally {
      delete process.env.CX_REST_TIMEOUT;
    }
  });
});
