jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../src/utils/logger', () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const axios = require('axios');
const service = require('../../src/services/update-check.service');
const { pickLatest, MIN_RECHECK_MS } = service;

const release = (tag, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: /-/.test(tag),
  html_url: `https://github.com/bryanbuck/nethelper/releases/tag/${tag}`,
  published_at: '2026-11-01T00:00:00Z',
  ...extra,
});

beforeEach(() => {
  axios.get.mockReset();
  delete process.env.UPDATE_CHECK_ENABLED;
  Object.assign(service, { current: '0.9.0', latest: null, checkedAt: null, error: null, lastAttempt: 0, inFlight: null });
});
afterEach(() => service.stop());

describe('pickLatest', () => {
  test('takes the highest release, whatever order GitHub lists them in', () => {
    const latest = pickLatest([release('v0.9.1'), release('v0.10.0'), release('v0.9.2')], '0.9.0');
    expect(latest).toEqual({
      version: '0.10.0',
      url: 'https://github.com/bryanbuck/nethelper/releases/tag/v0.10.0',
      publishedAt: '2026-11-01T00:00:00Z',
    });
  });

  test('a release install is never offered a pre-release; a pre-release install is', () => {
    const list = [release('v0.9.1-beta.1'), release('v0.9.0')];
    expect(pickLatest(list, '0.9.0').version).toBe('0.9.0');
    expect(pickLatest(list, '0.9.0-beta.8').version).toBe('0.9.1-beta.1');
  });

  test('skips drafts and tags that are not versions', () => {
    const list = [release('v2.0.0', { draft: true }), release('nightly'), release('v0.9.1')];
    expect(pickLatest(list, '0.9.0').version).toBe('0.9.1');
  });

  test('never passes on a link that is not the project release page', () => {
    const latest = pickLatest([release('v0.9.1', { html_url: 'https://example.com/x' })], '0.9.0');
    expect(latest.url).toBe('https://github.com/bryanbuck/nethelper/releases/tag/v0.9.1');
  });

  test('null for an empty or malformed list', () => {
    expect(pickLatest([], '0.9.0')).toBeNull();
    expect(pickLatest({ message: 'Not Found' }, '0.9.0')).toBeNull();
  });
});

describe('update check', () => {
  test('reports a newer release', async () => {
    axios.get.mockResolvedValue({ data: [release('v0.9.1')] });
    const status = await service.check({ force: true });
    expect(status).toMatchObject({ enabled: true, current: '0.9.0', updateAvailable: true, error: null });
    expect(status.latest.version).toBe('0.9.1');
    expect(status.checkedAt).toEqual(expect.any(String));
    const [url, options] = axios.get.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/bryanbuck/nethelper/releases?per_page=20');
    expect(options.headers['User-Agent']).toBe('NetHelper');
    expect(options.headers.Authorization).toBeUndefined();
  });

  test('nothing to offer when the running version is the newest', async () => {
    axios.get.mockResolvedValue({ data: [release('v0.9.0'), release('v0.9.1-beta.1')] });
    const status = await service.check({ force: true });
    expect(status.updateAvailable).toBe(false);
    expect(status.latest.version).toBe('0.9.0');
  });

  test('a failed check keeps the last answer and says why', async () => {
    axios.get.mockResolvedValueOnce({ data: [release('v0.9.1')] });
    await service.check({ force: true });
    axios.get.mockRejectedValueOnce(Object.assign(new Error('getaddrinfo'), { code: 'ENOTFOUND' }));
    const status = await service.check({ force: true });
    expect(status.updateAvailable).toBe(true);
    expect(status.latest.version).toBe('0.9.1');
    expect(status.error).toMatch(/ENOTFOUND/);
  });

  test('names GitHub rate limiting', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('403'), { response: { status: 403 } }));
    expect((await service.check({ force: true })).error).toMatch(/rate-limiting/);
  });

  test('a second check inside a minute makes no request', async () => {
    axios.get.mockResolvedValue({ data: [release('v0.9.1')] });
    await service.check();
    await service.check();
    expect(axios.get).toHaveBeenCalledTimes(1);
    service.lastAttempt = Date.now() - MIN_RECHECK_MS - 1;
    await service.check();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  test('concurrent checks share one request', async () => {
    axios.get.mockResolvedValue({ data: [release('v0.9.1')] });
    await Promise.all([service.check({ force: true }), service.check({ force: true })]);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('turned off: no request, no timers, nothing offered', async () => {
    process.env.UPDATE_CHECK_ENABLED = 'false';
    service.latest = { version: '0.9.1', url: 'x', publishedAt: null };
    service.start();
    expect(service.interval).toBeNull();
    const status = await service.check({ force: true });
    expect(axios.get).not.toHaveBeenCalled();
    expect(status).toMatchObject({ enabled: false, updateAvailable: false });
  });
});
