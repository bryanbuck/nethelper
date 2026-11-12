// The smoke test: sign in, add a device with a new credential, test it, back
// it up twice with a config change between, see the change in the diff, and
// take an application backup. Against a real stack: the real images (in CI,
// built and started by deploy/install.sh), a stand-in Cisco IOS switch over
// SSH (../fake-switch.js), pg_dump and tar inside the backend image.
//
// What it creates is removed at the end (device, credential, archive), so it
// can also run against a dev stack.
const { test, expect } = require('@playwright/test');
const { SWITCH, writeConfig } = require('./env');

const RUN = Date.now().toString(36);
const DEVICE_NAME = `E2E-SW-${RUN}`;
const CREDENTIAL_NAME = `E2E switch login ${RUN}`;
const CHANGED = `changed-by-e2e-${RUN}`;

test.describe.configure({ mode: 'serial' });

let token = null;
const created = { deviceId: null, credentialId: null, archive: null };

/** Authenticated API call with the browser's session token. */
async function api(request, method, path, data) {
  const response = await request[method](`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    ...(data !== undefined && { data }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${path}: HTTP ${response.status()} ${JSON.stringify(body)}`);
  return body;
}

/** Open a v-select by its label inside `scope` and pick an option. */
async function choose(page, scope, label, option) {
  await scope.locator('.v-input', { has: page.getByText(label, { exact: true }) }).locator('.v-field').click();
  await page.locator('.v-overlay--active .v-list-item', { hasText: option }).first().click();
}

async function successfulBackups(request) {
  const { data } = await api(request, 'get', `/backups?deviceId=${created.deviceId}&status=success`);
  return data;
}

test('sign in, add a device, back up twice, see the diff, take an app backup', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await test.step('sign in', async () => {
    await page.goto('/login');
    await page.getByLabel('Email Address').fill(process.env.E2E_ADMIN_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(process.env.E2E_ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).not.toHaveURL(/\/login/);
    token = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(token).toBeTruthy();
  });

  await test.step('add a device, with its credential made from the device form', async () => {
    await page.goto('/devices');
    await page.getByRole('button', { name: 'Add Device' }).click();
    const dialog = page.locator('.v-dialog', { hasText: 'Add New Device' });
    await dialog.getByLabel('Device Name').fill(DEVICE_NAME);
    await choose(page, dialog, 'Device Type', 'Switch');
    await choose(page, dialog, 'Vendor', 'Cisco');
    await choose(page, dialog, 'Platform', 'IOS / IOS-XE');
    await dialog.getByLabel('IP Address').fill(SWITCH.host);

    // "Add credential" is the first entry of the credential list.
    await choose(page, dialog, 'Device Credential', 'Add credential');
    const form = page.locator('.v-dialog', { hasText: 'Add API Credential' });
    await form.getByLabel('Credential Name').fill(CREDENTIAL_NAME);
    await form.getByLabel('Username').fill(SWITCH.username);
    await form.getByLabel('Password', { exact: true }).fill(SWITCH.password);
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(form).toBeHidden();
    await expect(dialog.locator('.v-select', { hasText: CREDENTIAL_NAME })).toBeVisible();

    await dialog.getByRole('button', { name: 'Add Device' }).click();
    await expect(dialog).toBeHidden();

    const { data: devices } = await api(request, 'get', '/devices');
    const device = devices.find((d) => d.name === DEVICE_NAME);
    expect(device).toBeTruthy();
    created.deviceId = device.id;
    created.credentialId = device.apiCredentialId;
    expect(created.credentialId).toBeTruthy();
  });

  await test.step('the connection test reaches the switch', async () => {
    // The UI's test is on Settings -> Connection Test; this checks the same
    // endpoint, which must contact the device to pass.
    const { data: result } = await api(request, 'post', `/device-api/test/${created.deviceId}`);
    expect(result, JSON.stringify(result)).toMatchObject({ success: true, transport: 'ssh' });
  });

  await test.step('back up from the device page', async () => {
    await page.goto(`/devices/${created.deviceId}`);
    await expect(page.getByText(DEVICE_NAME).first()).toBeVisible();
    await page.getByRole('button', { name: 'Back Up Now' }).click();
    await expect.poll(async () => (await successfulBackups(request)).length, { timeout: 120000 }).toBe(1);
  });

  await test.step('change the switch config and back up again', async () => {
    writeConfig(CHANGED);
    await page.getByRole('button', { name: 'Back Up Now' }).click();
    await expect.poll(async () => (await successfulBackups(request)).length, { timeout: 120000 }).toBe(2);
    const [newest] = await successfulBackups(request);
    expect(newest.hasChanges).toBe(true);
  });

  await test.step('the History tab compares the two backups', async () => {
    await page.goto(`/devices/${created.deviceId}?tab=history`);
    await page.getByRole('button', { name: 'Compare' }).first().click();
    const diff = page.locator('.v-dialog', { hasText: 'Compare Backups' });
    await expect(diff.locator('.diff-line.diff-add', { hasText: `description ${CHANGED}` })).toBeVisible();
    await expect(diff.locator('.diff-line.diff-remove', { hasText: 'description first' })).toBeVisible();
    // The banner and change stamp are cleaned out: only the real change shows.
    await expect(diff.locator('.diff-line.diff-add')).toHaveCount(1);
    await diff.getByRole('button', { name: 'Close' }).click();
  });

  await test.step('take an application backup', async () => {
    const before = new Set((await api(request, 'get', '/app-backups')).data.archives.map((a) => a.name));
    await page.goto('/settings?tab=app-backup');
    const runNow = page.getByRole('button', { name: 'Run now' });
    await expect(runNow).toBeEnabled({ timeout: 30000 }); // disabled while pg_dump/tar are missing
    await runNow.click();
    await expect.poll(async () => {
      const { archives } = (await api(request, 'get', '/app-backups')).data;
      created.archive = archives.find((a) => !before.has(a.name))?.name || null;
      return created.archive;
    }, { timeout: 180000 }).toBeTruthy();
    await expect(page.getByText(created.archive, { exact: true })).toBeVisible();
    const { runs } = (await api(request, 'get', '/app-backups')).data;
    expect(runs[0]).toMatchObject({ status: 'success', fileName: created.archive });
  });

  expect(errors, errors.join('\n')).toEqual([]);
});

test.afterAll(async ({ request }) => {
  if (!token) return;
  const quiet = (p) => p.catch((error) => console.warn(`cleanup: ${error.message}`));
  if (created.deviceId) await quiet(api(request, 'delete', `/devices/${created.deviceId}`));
  if (created.credentialId) await quiet(api(request, 'delete', `/settings/api-credentials/${created.credentialId}`));
  if (created.archive) await quiet(api(request, 'delete', `/app-backups/${encodeURIComponent(created.archive)}`));
});
