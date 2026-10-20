/**
 * A rejected CX login: a real 6200F answers 401 with the body "Login failed.\n".
 * The error used to be "Login failed with status 401: Unauthorized", which
 * dropped the switch's reply and didn't say the password was the problem.
 */
jest.mock('axios', () => ({ post: jest.fn() }));
const axios = require('axios');
const CXSwitchAPI = require('../../src/services/device-api/cx-switch-api');

const device = { id: 'd1', name: 'Sw-Studio', ipAddress: '192.0.2.14', type: 'switch', vendor: 'aruba', platform: 'aos-cx' };

test('a 401 says the switch rejected the credentials and keeps its reply', async () => {
  axios.post.mockResolvedValue({ status: 401, statusText: 'Unauthorized', data: 'Login failed.\n', headers: {} });
  const api = new CXSwitchAPI(device, { username: 'nethelper', password: 'wrong' });
  await expect(api.login()).rejects.toThrow('The switch rejected the username or password (HTTP 401: Login failed.)');
});
