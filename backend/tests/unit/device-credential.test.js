/**
 * Bulk device-credential assignment: which devices are linked, replaced,
 * unlinked, or skipped, and what is written. Prisma and the live monitor are
 * mocked.
 */
const calls = [];
const mockTx = {
  device: {
    updateMany: jest.fn(async (args) => {
      calls.push(['device.updateMany', args]);
      return { count: args.where.id.in.length };
    }),
  },
};
const mockPrisma = {
  apiCredential: { findUnique: jest.fn() },
  device: { findMany: jest.fn() },
  $transaction: jest.fn(async (fn) => fn(mockTx)),
};
const mockMonitor = {
  refresh: jest.fn(async () => {}),
  setAlwaysOn: jest.fn(async () => {}),
};

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/live/state-monitor.service', () => mockMonitor);

const deviceCredentials = require('../../src/services/device-credential.service');
const { classify, usesDeviceCredential, CredentialAssignError } = deviceCredentials;

const cx = (over = {}) => ({
  id: 'd-cx', name: 'sw-1', type: 'switch', vendor: 'aruba', platform: 'aos-cx', model: '6200F',
  ipAddress: '10.0.0.2', managementMode: 'direct', apiCredentialId: null, apiCredential: null,
  liveMonitoring: false, ...over,
});
const centralAp = (over = {}) => ({
  id: 'd-ap', name: 'ap-1', type: 'access_point', vendor: 'aruba', platform: null, model: 'AP-515',
  ipAddress: '10.0.1.5', managementMode: 'cloud', apiCredentialId: null, apiCredential: null,
  liveMonitoring: false, ...over,
});

beforeEach(() => {
  calls.length = 0;
  jest.clearAllMocks();
  mockPrisma.apiCredential.findUnique.mockResolvedValue({ id: 'cred-1', name: 'CX admin', type: 'switch' });
});

describe('usesDeviceCredential', () => {
  test('AOS-CX switches use one, Central-managed too (local REST reads)', () => {
    expect(usesDeviceCredential(cx())).toBe(true);
    expect(usesDeviceCredential(cx({ managementMode: 'cloud' }))).toBe(true);
  });

  test('a cloud-managed AP and a Meraki device do not', () => {
    expect(usesDeviceCredential(centralAp())).toBe(false);
    expect(usesDeviceCredential(cx({ vendor: 'cisco', platform: 'meraki', managementMode: 'direct' }))).toBe(false);
  });

  test('direct SSH platforms do', () => {
    expect(usesDeviceCredential(cx({ platform: 'aos-s' }))).toBe(true);
    expect(usesDeviceCredential(cx({ vendor: 'juniper', platform: 'junos' }))).toBe(true);
  });
});

describe('classify', () => {
  test('link, replace, unchanged', () => {
    expect(classify(cx(), 'cred-1').outcome).toBe('link');
    expect(classify(cx({ apiCredentialId: 'cred-2' }), 'cred-1').outcome).toBe('replace');
    expect(classify(cx({ apiCredentialId: 'cred-1' }), 'cred-1').outcome).toBe('unchanged');
  });

  test('a device without an IP is linked with a warning', () => {
    const r = classify(cx({ ipAddress: null }), 'cred-1');
    expect(r.outcome).toBe('link');
    expect(r.warning).toMatch(/No IP/);
  });

  test('a cloud-only device is skipped with a reason', () => {
    const r = classify(centralAp(), 'cred-1');
    expect(r.outcome).toBe('skip');
    expect(r.reason).toMatch(/cloud/);
  });

  test('unlinking warns when live monitoring will be turned off', () => {
    expect(classify(cx({ apiCredentialId: 'cred-1', liveMonitoring: true }), null))
      .toMatchObject({ outcome: 'unlink', warning: expect.stringMatching(/Live monitoring/) });
    expect(classify(cx(), null).outcome).toBe('unchanged');
  });
});

describe('plan', () => {
  test('reports every requested device, including missing ones, and changes nothing', async () => {
    mockPrisma.device.findMany.mockResolvedValue([cx(), centralAp()]);
    const result = await deviceCredentials.plan(['d-cx', 'd-ap', 'd-gone'], 'cred-1');
    expect(result.credential).toEqual({ id: 'cred-1', name: 'CX admin', type: 'switch' });
    expect(result.devices.map((d) => [d.id, d.outcome])).toEqual([
      ['d-cx', 'link'], ['d-ap', 'skip'], ['d-gone', 'skip'],
    ]);
    expect(result.counts).toMatchObject({ link: 1, skip: 2 });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  test('warns, without skipping, when the credential was made for another device class', async () => {
    mockPrisma.apiCredential.findUnique.mockResolvedValue({ id: 'cred-ap', name: 'Lab APs', type: 'ap' });
    mockPrisma.device.findMany.mockResolvedValue([cx()]);
    const result = await deviceCredentials.plan(['d-cx'], 'cred-ap');
    expect(result.devices[0]).toMatchObject({ outcome: 'link', warning: 'This credential is for access points' });
  });

  test('an unknown credential is a 404', async () => {
    mockPrisma.apiCredential.findUnique.mockResolvedValue(null);
    await expect(deviceCredentials.plan(['d-cx'], 'cred-x')).rejects.toMatchObject({
      name: 'CredentialAssignError', statusCode: 404,
    });
  });

  test('an empty selection is refused', async () => {
    await expect(deviceCredentials.plan([], 'cred-1')).rejects.toBeInstanceOf(CredentialAssignError);
  });
});

describe('assign', () => {
  test('links and replaces in one transaction, leaves skipped and unchanged rows alone', async () => {
    const rows = [cx(), cx({ id: 'd-cx2', apiCredentialId: 'cred-2' }), cx({ id: 'd-cx3', apiCredentialId: 'cred-1' }), centralAp()];
    mockPrisma.device.findMany.mockResolvedValueOnce(rows).mockResolvedValueOnce(rows.slice(0, 2));
    const result = await deviceCredentials.assign(rows.map((d) => d.id), 'cred-1');

    expect(result.updated).toBe(2);
    expect(calls).toEqual([
      ['device.updateMany', {
        where: { id: { in: ['d-cx', 'd-cx2'] } },
        data: expect.objectContaining({ apiCredentialId: 'cred-1' }),
      }],
    ]);
    expect(mockMonitor.refresh).toHaveBeenCalledTimes(2);
    expect(mockMonitor.setAlwaysOn).not.toHaveBeenCalled();
  });

  test('unlinking also turns live monitoring off', async () => {
    const watched = cx({ apiCredentialId: 'cred-1', liveMonitoring: true });
    mockPrisma.device.findMany.mockResolvedValueOnce([watched]).mockResolvedValueOnce([{ ...watched, apiCredentialId: null, liveMonitoring: false }]);
    const result = await deviceCredentials.assign(['d-cx'], null);

    expect(result.updated).toBe(1);
    expect(mockPrisma.apiCredential.findUnique).not.toHaveBeenCalled();
    expect(calls[0][1].data).toMatchObject({ apiCredentialId: null, liveMonitoring: false });
    expect(mockMonitor.setAlwaysOn).toHaveBeenCalledWith(expect.objectContaining({ id: 'd-cx' }), false);
  });

  test('nothing to change writes nothing', async () => {
    mockPrisma.device.findMany.mockResolvedValue([centralAp()]);
    const result = await deviceCredentials.assign(['d-ap'], 'cred-1');
    expect(result.updated).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
