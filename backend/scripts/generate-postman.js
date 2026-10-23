#!/usr/bin/env node
/**
 * Build the Postman collection from the live Express route tables, so it can't
 * lag the API. Every route under /api/v1 becomes one request, grouped by router;
 * request bodies and query parameters come from the routes' express-validator
 * chains (routes that read their body by hand get an empty JSON body).
 *
 * Usage (from backend/):
 *   node scripts/generate-postman.js           # rewrite the collection
 *   node scripts/generate-postman.js --check   # exit 1 if it is out of date
 *
 * tests/unit/postman-collection.test.js runs the check in CI. The collection
 * holds no credentials: sign-in uses the empty {{email}}/{{password}}
 * variables, and the Login request stores the tokens it gets back.
 */
const fs = require('fs');
const path = require('path');

const OUTPUT = path.join(__dirname, '..', 'NetHelper_API_Collection.postman_collection.json');

// Mount prefix (app.js) → router file, in nav order.
const ROUTERS = [
  ['auth', 'auth.routes'],
  ['users', 'users.routes'],
  ['devices', 'device.routes'],
  ['device-api', 'device-api-test.routes'],
  ['discovery', 'discovery.routes'],
  ['backups', 'backup.routes'],
  ['topology', 'topology.routes'],
  ['alerts', 'alert.routes'],
  ['activity', 'activity.routes'],
  ['automations', 'automation.routes'],
  ['schedules', 'schedule.routes'],
  ['executions', 'execution.routes'],
  ['settings', 'settings.routes'],
  ['system', 'system.routes'],
];

const SECRET_FIELD = /password|secret|token|apikey|privatekey|passphrase/i;

const LOGIN_SCRIPT = [
  'if (pm.response.code === 200) {',
  '    const responseJson = pm.response.json();',
  '    if (responseJson.success && responseJson.data) {',
  "        pm.collectionVariables.set('accessToken', responseJson.data.accessToken);",
  "        pm.collectionVariables.set('refreshToken', responseJson.data.refreshToken);",
  '    }',
  '}',
];

function validationsOf(route) {
  return route.stack
    .map((layer) => layer.handle && layer.handle.builder)
    .filter(Boolean);
}

// A placeholder value from the chain's validators.
function sampleValue(field, builder) {
  if (field === 'refreshToken') return '{{refreshToken}}';
  if (SECRET_FIELD.test(field)) return '';
  for (const item of builder.stack) {
    const name = item.validator && item.validator.name;
    // isArray/isObject are custom validators in express-validator 7: no name.
    const source = item.constructor.name === 'CustomValidation' ? String(item.validator) : '';
    if (name === 'isIn' && Array.isArray(item.options[0])) return item.options[0][0];
    if (name === 'isUUID') return '<uuid>';
    if (name === 'isEmail') return 'user@example.com';
    if (name === 'isIP') return '192.0.2.10';
    if (name === 'isBoolean') return false;
    if (name === 'isInt' || name === 'isFloat' || name === 'isNumeric') return 0;
    // isObject's source also mentions Array.isArray, so test it first.
    if (source.includes("typeof value === 'object'")) return {};
    if (source.includes('Array.isArray')) return [];
  }
  return '<string>';
}

function setPath(target, field, value) {
  const parts = field.split('.');
  let node = target;
  for (const part of parts.slice(0, -1)) {
    if (part === '*') return;
    if (typeof node[part] !== 'object' || node[part] === null || Array.isArray(node[part])) node[part] = {};
    node = node[part];
  }
  node[parts[parts.length - 1]] = value;
}

function describeFields(builders, location) {
  const fields = [];
  for (const builder of builders) {
    if (!builder.locations.includes(location)) continue;
    for (const field of builder.fields) {
      if (fields.some((f) => f.field === field)) continue;
      fields.push({ field, builder, optional: Boolean(builder.optional) });
    }
  }
  return fields;
}

function buildBody(builders) {
  const fields = describeFields(builders, 'body');
  const body = {};
  for (const { field, builder } of fields) {
    if (field.endsWith('.*')) {
      // Element validator: give the array one sample element.
      const parent = field.slice(0, -2);
      setPath(body, parent, [sampleValue(parent, builder)]);
    } else if (!field.includes('*')) {
      const value = sampleValue(field, builder);
      // Keep an array already filled in by its element validator.
      const existing = field.split('.').reduce((n, k) => (n && typeof n === 'object' ? n[k] : undefined), body);
      if (!(Array.isArray(existing) && existing.length)) setPath(body, field, value);
    }
  }
  const required = fields.filter((f) => !f.optional && !f.field.includes('*')).map((f) => f.field);
  return { body, required };
}

function hasAuth(router, layerIndex) {
  const before = router.stack.slice(0, layerIndex);
  if (before.some((layer) => !layer.route && layer.name === 'authenticate')) return true;
  return router.stack[layerIndex].route.stack.some((layer) => layer.name === 'authenticate');
}

function urlFor(prefix, routePath, query) {
  const segments = [prefix, ...routePath.split('/').filter(Boolean)];
  const variables = segments
    .filter((s) => s.startsWith(':'))
    .map((s) => ({ key: s.slice(1), value: '' }));
  const url = {
    raw: `{{baseUrl}}/${segments.join('/')}`,
    host: ['{{baseUrl}}'],
    path: segments,
  };
  if (query.length) {
    url.query = query.map((q) => ({ key: q.field, value: '', disabled: true }));
  }
  if (variables.length) url.variable = variables;
  return url;
}

function buildRequest(prefix, router, layerIndex, method) {
  const route = router.stack[layerIndex].route;
  const builders = validationsOf(route);
  const query = describeFields(builders, 'query').filter((q) => !q.field.includes('*'));
  const request = {
    method,
    header: [],
    url: urlFor(prefix, route.path, query),
  };
  if (!hasAuth(router, layerIndex)) request.auth = { type: 'noauth' };

  if (['POST', 'PUT', 'PATCH'].includes(method)) {
    let { body, required } = buildBody(builders);
    if (prefix === 'auth' && route.path === '/login') {
      body = { email: '{{email}}', password: '{{password}}' };
    }
    request.header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = { mode: 'raw', raw: JSON.stringify(body, null, 2) };
    if (required.length) request.description = `Required: ${required.join(', ')}.`;
  }

  const item = { name: `${method} /${prefix}${route.path === '/' ? '' : route.path}`, request, response: [] };
  if (prefix === 'auth' && route.path === '/login') {
    item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: LOGIN_SCRIPT } }];
  }
  return item;
}

function healthFolder() {
  const probe = (name, segments) => ({
    name,
    request: {
      method: 'GET',
      header: [],
      auth: { type: 'noauth' },
      url: { raw: `{{serverUrl}}/${segments.join('/')}`, host: ['{{serverUrl}}'], path: segments },
    },
    response: [],
  });
  return {
    name: 'health',
    item: [probe('GET /health', ['health']), probe('GET /health/ready', ['health', 'ready'])],
  };
}

function buildCollection() {
  const folders = [healthFolder()];
  for (const [prefix, file] of ROUTERS) {
    const router = require(path.join(__dirname, '..', 'src', 'routes', file));
    const items = [];
    router.stack.forEach((layer, index) => {
      if (!layer.route) return;
      for (const method of Object.keys(layer.route.methods)) {
        items.push(buildRequest(prefix, router, index, method.toUpperCase()));
      }
    });
    folders.push({ name: prefix, item: items });
  }

  return {
    info: {
      name: 'NetHelper API',
      description:
        'Generated from the backend route tables by backend/scripts/generate-postman.js; do not edit by hand. ' +
        'Set the email and password variables (they are empty on purpose), run auth → POST /auth/login, ' +
        'and the other requests use the token it stores. Path variables are left blank to fill in.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
    variable: [
      { key: 'serverUrl', value: 'http://localhost:3000' },
      { key: 'baseUrl', value: '{{serverUrl}}/api/v1' },
      { key: 'email', value: '' },
      { key: 'password', value: '' },
      { key: 'accessToken', value: '' },
      { key: 'refreshToken', value: '' },
    ],
    item: folders,
  };
}

function render() {
  return `${JSON.stringify(buildCollection(), null, 2)}\n`;
}

if (require.main === module) {
  const output = render();
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : '';
    if (current !== output) {
      console.error('Postman collection is out of date: run node scripts/generate-postman.js');
      process.exit(1);
    }
    console.log('Postman collection is up to date.');
    process.exit(0);
  }
  fs.writeFileSync(OUTPUT, output);
  const count = buildCollection().item.reduce((n, folder) => n + folder.item.length, 0);
  console.log(`Wrote ${path.relative(process.cwd(), OUTPUT)} (${count} requests).`);
  // Route modules open Redis/Bull handles on require; don't wait for them.
  process.exit(0);
}

module.exports = { buildCollection, render, OUTPUT, ROUTERS };
