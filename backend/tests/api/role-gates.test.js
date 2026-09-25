/**
 * Authorization sweep: walks every router's route table, so a new mutating
 * route without an authorize(...) guard fails this test instead of shipping.
 */
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createFakePrisma } = require('../helpers/fake-prisma');

const mockPrisma = createFakePrisma();
jest.mock('../../src/config/database', () => ({ getPrisma: () => mockPrisma }));

const app = require('../../src/app');

const ROUTERS = {
  devices: require('../../src/routes/device.routes'),
  automations: require('../../src/routes/automation.routes'),
  schedules: require('../../src/routes/schedule.routes'),
  executions: require('../../src/routes/execution.routes'),
  settings: require('../../src/routes/settings.routes'),
  'device-api': require('../../src/routes/device-api-test.routes'),
  discovery: require('../../src/routes/discovery.routes'),
  backups: require('../../src/routes/backup.routes'),
};

// Reads that are still restricted, because the response carries secrets or
// full device configs.
const RESTRICTED_READS = [
  'GET /backups/:backupId/content',
  'GET /backups/:backupId/download',
  'GET /backups/:backupId/diff/:otherId',
  'GET /settings/git-backup',
];

// Operator-level actions that only admins may take.
const ADMIN_ONLY = [
  'DELETE /devices/:deviceId',
  'POST /devices/:deviceId/command',
  'DELETE /devices/groups/:groupId',
  'POST /settings/cloud-integrations',
  'PUT /settings/cloud-integrations/:id',
  'POST /settings/cloud-integrations/:id/test',
  'DELETE /settings/cloud-integrations/:id',
  'POST /settings/aruba-central',
  'POST /settings/aruba-central/test',
  'DELETE /settings/aruba-central/:id',
  'PUT /settings/git-backup',
  'POST /settings/git-backup/test',
  'DELETE /settings/git-backup',
  'DELETE /discovery/scans/:scanId',
  'DELETE /backups/:backupId',
  'DELETE /backups/schedules/:scheduleId',
];

const UUID = '00000000-0000-4000-8000-000000000000';

function routeTable() {
  const routes = [];
  for (const [prefix, router] of Object.entries(ROUTERS)) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ method: method.toUpperCase(), path: `/${prefix}${layer.route.path}` });
      }
    }
  }
  return routes;
}

const key = (r) => `${r.method} ${r.path}`;
const url = (path) => `/api/v1${path.replace(/:\w+/g, UUID)}`;

async function call(route, token) {
  const req = request(app)[route.method.toLowerCase()](url(route.path));
  if (token) req.set('Authorization', `Bearer ${token}`);
  return route.method === 'GET' ? req : req.send({});
}

let viewerToken;
let operatorToken;
beforeAll(async () => {
  const viewer = await mockPrisma.user.create({ data: { email: 'v@example.com', name: 'Viewer', role: 'viewer', password: 'x' } });
  const operator = await mockPrisma.user.create({ data: { email: 'o@example.com', name: 'Operator', role: 'operator', password: 'x' } });
  viewerToken = jwt.sign({ userId: viewer.id }, process.env.JWT_SECRET);
  operatorToken = jwt.sign({ userId: operator.id }, process.env.JWT_SECRET);
});

const routes = routeTable();
const mutating = routes.filter((r) => r.method !== 'GET');

test('the sweep found the routers', () => {
  expect(mutating.length).toBeGreaterThan(30);
  const known = new Set(routes.map(key));
  for (const k of [...RESTRICTED_READS, ...ADMIN_ONLY]) expect(known).toContain(k);
});

test.each(routes.map((r) => [key(r), r]))('%s requires a token', async (_k, route) => {
  const res = await call(route);
  expect(res.status).toBe(401);
});

test.each(mutating.map((r) => [key(r), r]))('%s is forbidden to a viewer', async (_k, route) => {
  const res = await call(route, viewerToken);
  expect(res.status).toBe(403);
});

test.each(RESTRICTED_READS.map((k) => [k]))('%s is forbidden to a viewer', async (k) => {
  const [method, path] = k.split(' ');
  const res = await call({ method, path }, viewerToken);
  expect(res.status).toBe(403);
});

test.each(ADMIN_ONLY.map((k) => [k]))('%s is forbidden to an operator', async (k) => {
  const [method, path] = k.split(' ');
  const res = await call({ method, path }, operatorToken);
  expect(res.status).toBe(403);
});

test('no static route is shadowed by an earlier parameter route', () => {
  const shadowed = [];
  for (const [prefix, router] of Object.entries(ROUTERS)) {
    const layers = router.stack.filter((l) => l.route);
    layers.forEach((layer, i) => {
      if (layer.route.path.includes(':')) return;
      for (const earlier of layers.slice(0, i)) {
        const sameMethod = Object.keys(layer.route.methods).some((m) => earlier.route.methods[m]);
        if (sameMethod && earlier.regexp.test(layer.route.path)) {
          shadowed.push(`/${prefix}${layer.route.path} (by /${prefix}${earlier.route.path})`);
        }
      }
    });
  }
  expect(shadowed).toEqual([]);
});
