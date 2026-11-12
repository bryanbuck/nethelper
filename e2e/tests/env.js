// Settings shared by the global setup and the spec, from the environment.
const fs = require('fs');
const path = require('path');

const SWITCH = {
  // The address NetHelper (the backend) uses to reach the stand-in switch.
  host: process.env.E2E_SWITCH_HOST || '127.0.0.1',
  // Where it listens on this machine.
  bind: process.env.E2E_SWITCH_BIND || '0.0.0.0',
  // Must equal the backend's SSH_PORT: NetHelper has one SSH port for every device.
  port: Number(process.env.E2E_SWITCH_PORT || 2222),
  username: 'e2e-switch',
  password: 'e2e-switch-password',
};

const configFile = path.join(__dirname, '..', '.state', 'running-config.txt');

// The stand-in's running config; `description` is what the test changes.
function writeConfig(description) {
  fs.writeFileSync(configFile, [
    'Building configuration...',
    '',
    'Current configuration : 412 bytes',
    '!',
    `! Last configuration change at ${new Date().toUTCString()} by e2e`,
    '!',
    'version 15.0',
    'service timestamps log datetime msec',
    '!',
    'hostname E2E-SW',
    '!',
    'interface GigabitEthernet0/1',
    ` description ${description}`,
    ' switchport mode access',
    '!',
    'interface GigabitEthernet0/2',
    ' shutdown',
    '!',
    'end',
    '',
  ].join('\n'));
}

module.exports = { SWITCH, configFile, writeConfig };
