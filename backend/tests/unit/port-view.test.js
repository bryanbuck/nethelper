/**
 * Port Identity read/note side (services/ports/port-view.service.js), with
 * Prisma mocked.
 */
const mockPrisma = {
  device: { findUnique: jest.fn(), findMany: jest.fn(async () => []) },
  portReadState: { findMany: jest.fn(async () => []) },
  portClient: { findMany: jest.fn(async () => []) },
  portNote: {
    findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null), upsert: jest.fn(), delete: jest.fn(),
  },
  portNoteRevision: { create: jest.fn(), findMany: jest.fn(async () => []) },
  deviceLink: { findMany: jest.fn(async () => []) },
  deviceTopologyState: { findUnique: jest.fn(async () => null) },
  $queryRaw: jest.fn(async () => []),
};
mockPrisma.$transaction = jest.fn(async (arg) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg)));

jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/services/ports/port-client.service', () => ({ intervalMs: 30 * 60 * 1000 }));

const portView = require('../../src/services/ports/port-view.service');

const { comparePorts, PortError } = portView;
const NOW = new Date('2026-11-10T12:00:00Z');
const ago = (min) => new Date(NOW.getTime() - min * 60 * 1000);
const DEVICE = { id: 'd1', name: 'Sw-Studio' };

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.device.findUnique.mockResolvedValue(DEVICE);
  // Back to empty tables: clearAllMocks keeps implementations set by a test.
  for (const fn of [mockPrisma.device.findMany, mockPrisma.portReadState.findMany, mockPrisma.portClient.findMany,
    mockPrisma.portNote.findMany, mockPrisma.portNoteRevision.findMany, mockPrisma.deviceLink.findMany, mockPrisma.$queryRaw]) {
    fn.mockResolvedValue([]);
  }
  mockPrisma.portNote.findUnique.mockResolvedValue(null);
  mockPrisma.deviceTopologyState.findUnique.mockResolvedValue(null);
});

describe('comparePorts', () => {
  it('sorts ports naturally and LAGs last', () => {
    expect(['1/1/10', 'lag1', '1/1/2', '1/1/1', 'ge-0/0/10', 'ge-0/0/2'].sort(comparePorts))
      .toEqual(['1/1/1', '1/1/2', '1/1/10', 'ge-0/0/2', 'ge-0/0/10', 'lag1']);
  });
});

describe('getPorts', () => {
  it('merges read summaries, sightings, notes, neighbors and VLANs per port', async () => {
    mockPrisma.portReadState.findMany.mockResolvedValue([{
      source: 'device-rest', readAt: ago(5), lastSuccessAt: ago(5), createdAt: ago(60 * 24 * 40), error: null,
      portSummary: {
        '1/1/4': { label: '1/1/4', description: 'IP Phone + USB-C dock', macCount: 2, uplink: false, linkUp: true },
        '1/1/13': { label: '1/1/13', macCount: 56, uplink: true, linkUp: true },
        '1/1/9': { label: '1/1/9', macCount: 0, uplink: false, linkUp: false },
      },
    }]);
    mockPrisma.portClient.findMany.mockResolvedValue([
      { id: 'c1', port: '1/1/4', mac: 'aa:00:00:00:00:01', state: 'present', firstSeen: ago(100), lastSeen: ago(5), sources: ['mac-table'] },
      { id: 'c2', port: '1/1/4', mac: 'aa:00:00:00:00:02', state: 'gone', goneAt: ago(60), goneReason: 'link-down', lastSeen: ago(90) },
      { id: 'c3', port: '1/1/9', mac: 'aa:00:00:00:00:03', state: 'gone', goneAt: ago(60 * 24 * 20), goneReason: 'omitted', lastSeen: ago(60 * 24 * 20) },
      { id: 'c4', port: '1/1/9', mac: 'aa:00:00:00:00:04', state: 'gone', goneAt: ago(60 * 24 * 25), goneReason: 'omitted', lastSeen: ago(60 * 24 * 25) },
    ]);
    mockPrisma.portNote.findMany.mockResolvedValue([{
      port: '1/1/4', portLabel: '1/1/4', label: 'Desk 3', kind: 'auto', expectedMac: 'aa:00:00:00:00:01', updatedAt: ago(10), updatedBy: { id: 'u1', name: 'Admin' },
    }]);
    mockPrisma.deviceLink.findMany.mockResolvedValue([{
      localPort: '1/1/13', remoteSysName: 'Sw-CoreA', remoteMac: 'bb:00:00:00:00:01', remoteCapabilities: ['bridge', 'router'], source: 'lldp',
    }]);
    mockPrisma.device.findMany.mockResolvedValue([{ id: 'core', name: 'Sw-CoreA', macAddress: 'BB-00-00-00-00-01' }]);
    mockPrisma.deviceTopologyState.findUnique.mockResolvedValue({
      vlans: { vlans: [], ports: { '1/1/4': { port: '1/1/4', mode: 'access', untagged: 20, tagged: [18] } }, routed: [] },
    });

    const view = await portView.getPorts('d1', { now: NOW });

    expect(view.ports.map((p) => p.port)).toEqual(['1/1/4', '1/1/9', '1/1/13']);
    const [phone, idle, uplink] = view.ports;
    expect(phone).toMatchObject({
      description: 'IP Phone + USB-C dock', linkUp: true, note: { label: 'Desk 3', updatedBy: { name: 'Admin' } },
      expected: { mac: 'aa:00:00:00:00:01', present: true }, vlan: { mode: 'access', untagged: 20, tagged: [18] }, goneCount: 1,
    });
    expect(phone.clients.map((c) => [c.id, c.freshness])).toEqual([['c1', 'confirmed'], ['c2', 'gone']]);
    // Nothing live and nothing gone this week: still shows who was there last.
    expect(idle.clients.map((c) => c.id)).toEqual(['c3']);
    expect(idle.goneCount).toBe(2);
    expect(uplink).toMatchObject({ uplink: true, kind: { kind: 'uplink' }, neighbors: [{ sysName: 'Sw-CoreA', device: { id: 'core' } }] });
    expect(view.observingSince).toEqual(ago(60 * 24 * 40));
  });

  it('calls clients stale once reads have failed for twice the interval', async () => {
    mockPrisma.portReadState.findMany.mockResolvedValue([{
      source: 'device-rest', readAt: ago(5), lastSuccessAt: ago(90), createdAt: ago(1000), error: 'ETIMEDOUT', portSummary: {},
    }]);
    mockPrisma.portClient.findMany.mockResolvedValue([{ id: 'c1', port: '1/1/4', mac: 'aa:00:00:00:00:01', state: 'present', lastSeen: ago(90) }]);
    const view = await portView.getPorts('d1', { now: NOW });
    expect(view.ports[0].clients[0]).toMatchObject({ freshness: 'stale' });
    expect(view.reads).toEqual([expect.objectContaining({ error: 'ETIMEDOUT' })]);
  });

  it('a note alone makes a port appear (a switch nothing reads)', async () => {
    mockPrisma.portNote.findMany.mockResolvedValue([{ port: '2', portLabel: '2', label: 'Printer', kind: 'auto' }]);
    const view = await portView.getPorts('d1', { now: NOW });
    expect(view.ports).toEqual([expect.objectContaining({ port: '2', label: '2', note: expect.objectContaining({ label: 'Printer' }) })]);
  });

  it('404s for an unknown device', async () => {
    mockPrisma.device.findUnique.mockResolvedValue(null);
    await expect(portView.getPorts('nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('notes', () => {
  it('cleanNote trims, normalizes the MAC, and rejects bad values', () => {
    expect(portView.cleanNote({ label: '  Room 214 ', expectedMac: 'AA-BB-CC-00-11-22', kind: '', bogus: 'x' }))
      .toEqual({ label: 'Room 214', expectedMac: 'aa:bb:cc:00:11:22', kind: 'auto' });
    expect(() => portView.cleanNote({ kind: 'printer' })).toThrow(PortError);
    expect(() => portView.cleanNote({ label: 'x'.repeat(65) })).toThrow(/64/);
    expect(() => portView.cleanNote({ expectedMac: 'nope' })).toThrow(/MAC/);
  });

  it('setNote upserts by normalized port and writes a revision with the values after', async () => {
    mockPrisma.portNote.upsert.mockImplementation(async ({ create }) => ({ ...create, updatedAt: NOW, updatedBy: { id: 'u1', name: 'Admin' } }));
    const note = await portView.setNote('d1', 'GigabitEthernet1/0/4', { label: 'Desk 3', portLabel: 'Gi1/0/4' }, 'u1');

    const args = mockPrisma.portNote.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ deviceId_port: { deviceId: 'd1', port: 'gi1/0/4' } });
    expect(args.create).toMatchObject({ portLabel: 'Gi1/0/4', label: 'Desk 3', updatedById: 'u1' });
    expect(mockPrisma.portNoteRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ port: 'gi1/0/4', action: 'set', values: expect.objectContaining({ label: 'Desk 3' }), userId: 'u1' }),
    });
    expect(note).toMatchObject({ label: 'Desk 3', updatedBy: { name: 'Admin' } });
  });

  it('a save that leaves nothing in the note clears it', async () => {
    mockPrisma.portNote.findUnique.mockResolvedValue({ id: 'n1', label: 'Desk 3', kind: 'auto' });
    expect(await portView.setNote('d1', '1/1/4', { label: '' }, 'u1')).toBeNull();
    expect(mockPrisma.portNote.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.portNote.delete).toHaveBeenCalledWith({ where: { id: 'n1' } });
    expect(mockPrisma.portNoteRevision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'clear' }) });
  });

  it('clearNote on a port without a note does nothing', async () => {
    expect(await portView.clearNote('d1', '1/1/4', 'u1')).toBe(false);
    expect(mockPrisma.portNoteRevision.create).not.toHaveBeenCalled();
  });
});

describe('search', () => {
  it('matches a MAC fragment in any spelling through the raw query', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ id: 'c1' }]);
    mockPrisma.portClient.findMany.mockResolvedValue([]);
    await portView.search('AA-BB.CC');
    expect(mockPrisma.$queryRaw.mock.calls[0].slice(1)).toEqual(['%aabbcc%']);
    expect(mockPrisma.portClient.findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ id: { in: ['c1'] } }]));
  });

  it('matches an IP prefix and text fields, but not MAC for plain words', async () => {
    await portView.search('192.168.20');
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.portClient.findMany.mock.calls[0][0].where.OR).toEqual(expect.arrayContaining([{ ip: { startsWith: '192.168.20' } }]));
    await portView.search('printer');
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    const noteWhere = mockPrisma.portNote.findMany.mock.calls[1][0].where.OR;
    expect(noteWhere).toEqual(expect.arrayContaining([{ label: { contains: 'printer', mode: 'insensitive' } }]));
    expect(noteWhere.some((c) => 'expectedMac' in c)).toBe(false);
  });

  it('refuses a one-character search', async () => {
    await expect(portView.search('a')).rejects.toBeInstanceOf(PortError);
  });
});
