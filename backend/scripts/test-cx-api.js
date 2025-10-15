#!/usr/bin/env node

/**
 * CX Switch API Integration Test Script
 *
 * This script provides a quick way to test the CX switch API integration
 * without needing to use Postman or cURL.
 *
 * Usage:
 *   node scripts/test-cx-api.js
 *
 * Configuration:
 *   Set the following environment variables or edit the config below:
 *   - SWITCH_IP: IP address of the CX switch
 *   - SWITCH_USERNAME: Admin username
 *   - SWITCH_PASSWORD: Admin password
 *   - BACKEND_URL: Backend API URL (default: http://localhost:3000)
 *   - JWT_TOKEN: Your JWT token for authentication
 */

const axios = require('axios');
const readline = require('readline');

// Configuration
const config = {
  switchIp: process.env.SWITCH_IP || '192.168.1.1',
  username: process.env.SWITCH_USERNAME || 'admin',
  password: process.env.SWITCH_PASSWORD || '',
  backendUrl: process.env.BACKEND_URL || 'http://localhost:3000',
  jwtToken: process.env.JWT_TOKEN || '',
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Helper functions
function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function success(message) {
  log(`✓ ${message}`, colors.green);
}

function error(message) {
  log(`✗ ${message}`, colors.red);
}

function info(message) {
  log(`ℹ ${message}`, colors.cyan);
}

function warn(message) {
  log(`⚠ ${message}`, colors.yellow);
}

function section(message) {
  console.log();
  log(`${'='.repeat(60)}`, colors.bright);
  log(message, colors.bright);
  log(`${'='.repeat(60)}`, colors.bright);
}

// Prompt for input if needed
async function promptForInput(question, envValue) {
  if (envValue) {
    return envValue;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Main test function
async function testCXAPI() {
  try {
    section('CX Switch API Integration Test');

    // Check configuration
    info('Configuration:');
    console.log(`  Backend URL: ${config.backendUrl}`);
    console.log(`  Switch IP: ${config.switchIp}`);
    console.log(`  Username: ${config.username}`);
    console.log(`  Password: ${config.password ? '***' : '(not set)'}`);
    console.log(`  JWT Token: ${config.jwtToken ? '***' : '(not set)'}`);

    // Prompt for missing values
    if (!config.password) {
      config.password = await promptForInput('Enter switch password: ');
    }

    if (!config.jwtToken) {
      warn('No JWT token provided. You may need to authenticate first.');
      config.jwtToken = await promptForInput('Enter JWT token (or press Enter to skip): ');
    }

    // Test 1: Get supported device types
    section('Test 1: Get Supported Device Types');
    try {
      const response = await axios.get(
        `${config.backendUrl}/api/v1/device-api/supported-types`,
        {
          headers: config.jwtToken ? {
            'Authorization': `Bearer ${config.jwtToken}`,
          } : {},
        }
      );

      success('Successfully retrieved supported device types');
      console.log('Supported types:');
      response.data.data.forEach(type => {
        const status = type.implemented ? colors.green + '✓' : colors.yellow + '✗';
        console.log(`  ${status} ${type.name} (${type.type})${colors.reset}`);
        console.log(`    ${type.description}`);
      });
    } catch (err) {
      error(`Failed to get supported types: ${err.message}`);
      if (err.response?.status === 401) {
        error('Authentication failed. Please provide a valid JWT token.');
        return;
      }
    }

    // Test 2: Manual connection test
    section('Test 2: Manual Connection Test');
    info(`Testing connection to ${config.switchIp}...`);

    const startTime = Date.now();
    try {
      const response = await axios.post(
        `${config.backendUrl}/api/v1/device-api/test-manual`,
        {
          deviceIp: config.switchIp,
          username: config.username,
          password: config.password,
          deviceType: 'cx_switch',
        },
        {
          headers: {
            'Authorization': `Bearer ${config.jwtToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const responseTime = Date.now() - startTime;

      if (response.data.success && response.data.data.success) {
        success('Connection test successful!');
        console.log(`  Response time: ${responseTime}ms`);

        if (response.data.data.deviceInfo) {
          console.log('  Device Information:');
          console.log(`    Hostname: ${response.data.data.deviceInfo.hostname}`);
          console.log(`    Model: ${response.data.data.deviceInfo.model}`);
          console.log(`    Version: ${response.data.data.deviceInfo.version}`);
        }
      } else {
        error('Connection test failed');
        console.log(`  Message: ${response.data.data.message}`);
      }
    } catch (err) {
      const responseTime = Date.now() - startTime;
      error(`Connection test failed (${responseTime}ms)`);

      if (err.response?.data) {
        console.log(`  Error: ${err.response.data.error || err.response.data.message}`);
        if (err.response.data.data?.message) {
          console.log(`  Details: ${err.response.data.data.message}`);
        }
      } else {
        console.log(`  Error: ${err.message}`);
      }

      // Provide troubleshooting hints
      console.log();
      warn('Troubleshooting hints:');
      console.log('  1. Verify switch is reachable: ping', config.switchIp);
      console.log('  2. Verify HTTPS is accessible: curl -k https://' + config.switchIp);
      console.log('  3. Check switch configuration: show https-server');
      console.log('  4. Verify credentials: show running-config user');
    }

    section('Test Complete');
    success('All tests completed');

  } catch (err) {
    error(`Unexpected error: ${err.message}`);
    console.error(err);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  testCXAPI().then(() => {
    console.log();
    info('For more detailed testing, see: docs/CX_API_TEST_PLAN.md');
    process.exit(0);
  }).catch(err => {
    error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { testCXAPI };
