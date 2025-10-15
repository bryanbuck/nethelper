#!/usr/bin/env node
/**
 * Test Login Script
 * This script tests the complete login flow to verify backend authentication is working
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testLogin(email, password) {
  log('\n╔════════════════════════════════════════╗', 'blue');
  log('║     LOGIN FUNCTIONALITY TEST           ║', 'blue');
  log('╚════════════════════════════════════════╝', 'blue');

  try {
    // Step 1: Database Connection
    log('\n[1/6] Testing database connection...', 'cyan');
    await prisma.$connect();
    log('✓ Database connected successfully', 'green');

    // Step 2: Find User
    log('\n[2/6] Looking up user by email...', 'cyan');
    log(`Email: ${email}`, 'yellow');

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      log('✗ User not found in database', 'red');
      log('\nAvailable users:', 'yellow');
      const allUsers = await prisma.user.findMany({
        select: { email: true, name: true, role: true }
      });
      allUsers.forEach(u => {
        log(`  - ${u.email} (${u.name}, ${u.role})`, 'yellow');
      });
      return false;
    }

    log('✓ User found', 'green');
    log(`  ID: ${user.id}`, 'yellow');
    log(`  Name: ${user.name}`, 'yellow');
    log(`  Role: ${user.role}`, 'yellow');
    log(`  Created: ${user.createdAt}`, 'yellow');
    log(`  Last Login: ${user.lastLogin || 'Never'}`, 'yellow');

    // Step 3: Password Hash Check
    log('\n[3/6] Checking stored password hash...', 'cyan');
    if (!user.password) {
      log('✗ No password hash stored for user', 'red');
      return false;
    }
    log('✓ Password hash exists', 'green');
    log(`  Hash: ${user.password.substring(0, 20)}...`, 'yellow');

    // Step 4: Password Verification
    log('\n[4/6] Verifying password...', 'cyan');
    log(`  Testing password: "${password}"`, 'yellow');

    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      log('✗ Password verification FAILED', 'red');
      log('\nDebugging Info:', 'yellow');
      log(`  - Password length: ${password.length}`, 'yellow');
      log(`  - Hash starts with: ${user.password.substring(0, 7)}`, 'yellow');

      // Test if password needs to be hashed
      log('\nTrying to create a test hash to compare...', 'cyan');
      const testHash = await bcrypt.hash(password, 12);
      log(`  Test hash: ${testHash.substring(0, 20)}...`, 'yellow');
      log(`  Stored hash: ${user.password.substring(0, 20)}...`, 'yellow');

      return false;
    }

    log('✓ Password verification SUCCESSFUL', 'green');

    // Step 5: JWT Token Generation
    log('\n[5/6] Generating JWT tokens...', 'cyan');

    if (!process.env.JWT_SECRET) {
      log('✗ JWT_SECRET not configured in .env', 'red');
      return false;
    }
    if (!process.env.JWT_REFRESH_SECRET) {
      log('✗ JWT_REFRESH_SECRET not configured in .env', 'red');
      return false;
    }

    const accessToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
    );

    const refreshToken = jwt.sign(
      { userId: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
    );

    log('✓ JWT tokens generated successfully', 'green');
    log(`  Access token length: ${accessToken.length}`, 'yellow');
    log(`  Refresh token length: ${refreshToken.length}`, 'yellow');
    log(`  Access token: ${accessToken.substring(0, 30)}...`, 'yellow');

    // Step 6: Verify Token
    log('\n[6/6] Verifying generated token...', 'cyan');
    const decoded = jwt.verify(accessToken, process.env.JWT_SECRET);
    log('✓ Token verification successful', 'green');
    log(`  Decoded userId: ${decoded.userId}`, 'yellow');
    log(`  Token expires: ${new Date(decoded.exp * 1000).toLocaleString()}`, 'yellow');

    // Success Summary
    log('\n' + '═'.repeat(50), 'green');
    log('SUCCESS! All login components are working correctly', 'green');
    log('═'.repeat(50), 'green');

    log('\nLogin Response (mimicking API):', 'cyan');
    const loginResponse = {
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        },
        accessToken: accessToken.substring(0, 50) + '...',
        refreshToken: refreshToken.substring(0, 50) + '...'
      }
    };
    console.log(JSON.stringify(loginResponse, null, 2));

    // Test actual API endpoint
    log('\n' + '─'.repeat(50), 'blue');
    log('NEXT STEP: Test the actual API endpoint', 'bright');
    log('─'.repeat(50), 'blue');
    log('\nRun this curl command to test the real API:', 'cyan');
    log(`\ncurl -X POST http://localhost:${process.env.PORT || 3000}/api/v1/auth/login \\`, 'yellow');
    log(`  -H "Content-Type: application/json" \\`, 'yellow');
    log(`  -d '{"email":"${email}","password":"${password}"}'`, 'yellow');

    return true;

  } catch (error) {
    log(`\n✗ ERROR: ${error.message}`, 'red');
    log('\nStack trace:', 'red');
    console.error(error);
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    log('Usage: node scripts/test-login.js <email> [password]', 'yellow');
    log('\nExample:', 'cyan');
    log('  node scripts/test-login.js admin@example.com mypassword123', 'yellow');
    log('\nOr run interactively without password:', 'cyan');
    log('  node scripts/test-login.js admin@example.com', 'yellow');

    // Show available users
    await prisma.$connect();
    log('\nAvailable users in database:', 'cyan');
    const users = await prisma.user.findMany({
      select: { email: true, name: true, role: true }
    });
    users.forEach(u => {
      log(`  - ${u.email} (${u.name}, ${u.role})`, 'yellow');
    });
    await prisma.$disconnect();

    process.exit(1);
  }

  const email = args[0];
  let password = args[1];

  // If password not provided, prompt for it
  if (!password) {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    password = await new Promise((resolve) => {
      rl.question('Password: ', (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }

  const success = await testLogin(email, password);
  process.exit(success ? 0 : 1);
}

main().catch((error) => {
  log(`Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});
