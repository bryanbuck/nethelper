// Starts the stand-in switch for the whole run; the returned function stops it.
const fs = require('fs');
const path = require('path');
const { startFakeSwitch } = require('./fake-switch');
const { SWITCH, configFile, writeConfig } = require('./tests/env');

module.exports = async () => {
  for (const name of ['E2E_ADMIN_EMAIL', 'E2E_ADMIN_PASSWORD']) {
    if (!process.env[name]) throw new Error(`Set ${name} (an admin of the NetHelper under test)`);
  }
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  writeConfig('first');
  const sw = await startFakeSwitch({
    host: SWITCH.bind, port: SWITCH.port, username: SWITCH.username, password: SWITCH.password, configFile,
  });
  console.log(`Stand-in switch listening on ${SWITCH.bind}:${sw.port}; NetHelper reaches it at ${SWITCH.host}`);
  return async () => sw.close();
};
