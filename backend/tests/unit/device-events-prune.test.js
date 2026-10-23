/**
 * device-events prune: old events go, except each device's newest ping.* and
 * cloud.* event, which is its History lane's starting state.
 */
const mockPrisma = {
  $queryRaw: jest.fn(async () => [{ id: 'keep-ping' }, { id: 'keep-cloud' }]),
  deviceEvent: { deleteMany: jest.fn(async () => ({ count: 3 })) },
};
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));
jest.mock('../../src/websocket/socket.handler', () => ({ getIO: () => { throw new Error('no io'); } }));

const { prune } = require('../../src/services/device-events.service');

beforeEach(() => jest.clearAllMocks());

test('keeps each device\'s latest state event per lane, whatever its age', async () => {
  expect(await prune()).toBe(3);
  const sql = mockPrisma.$queryRaw.mock.calls[0][0].join('?');
  expect(sql).toMatch(/DISTINCT ON \("deviceId", split_part\("type", '\.', 1\)\)/);
  expect(sql).toMatch(/'ping\.%'.*'cloud\.%'/s);
  const { where } = mockPrisma.deviceEvent.deleteMany.mock.calls[0][0];
  expect(where.id).toEqual({ notIn: ['keep-ping', 'keep-cloud'] });
  expect(where.occurredAt.lt).toBeInstanceOf(Date);
});

test('with no state events, it prunes by age alone', async () => {
  mockPrisma.$queryRaw.mockResolvedValueOnce([]);
  await prune();
  expect(mockPrisma.deviceEvent.deleteMany.mock.calls[0][0].where.id).toBeUndefined();
});
