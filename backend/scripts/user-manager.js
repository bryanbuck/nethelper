#!/usr/bin/env node
/**
 * NetHelper user administration.
 *
 *   npm run user:manage
 *       Interactive menu: list, create, edit, reset password, delete.
 *
 *   npm run user:manage -- create-admin --email <email> --name "<name>"
 *       Non-interactive, for first-run bootstrap and scripted installs. The
 *       password comes from NETHELPER_ADMIN_PASSWORD (min 12 characters); if
 *       that is unset, a random one is generated and printed once.
 */
require('dotenv').config();
const crypto = require('crypto');
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { deleteUserPreservingData } = require('../src/services/user-lifecycle');
const { normalizeEmail } = require('../src/utils/email');

const prisma = new PrismaClient();

// Created on first use, so the non-interactive command never holds stdin open.
let rl;
function getReadline() {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const VALID_ROLES = ['admin', 'operator', 'viewer'];

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function question(prompt) {
  return new Promise((resolve) => {
    getReadline().question(prompt, resolve);
  });
}

function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateRole(role) {
  return VALID_ROLES.includes(role.toLowerCase());
}

async function listUsers() {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' }
    });

    if (users.length === 0) {
      console.log(colorize('\nNo users found in the database.', 'yellow'));
      return [];
    }

    console.log(colorize('\n=== USERS ===', 'cyan'));
    users.forEach((user, index) => {
      const roleColor = user.role === 'admin' ? 'red' : user.role === 'operator' ? 'yellow' : 'blue';
      console.log(`${colorize(index + 1 + '.', 'bright')} ${colorize(user.email, 'green')} ${colorize(`[${user.role.toUpperCase()}]`, roleColor)}`);
      console.log(`   Name: ${user.name || 'Not set'}`);
      console.log(`   ID: ${user.id}`);
      console.log(`   Created: ${user.createdAt.toLocaleString()}`);
      console.log(`   Last Login: ${user.lastLogin ? user.lastLogin.toLocaleString() : 'Never'}`);
      console.log('');
    });

    return users;
  } catch (error) {
    console.error(colorize(`Error listing users: ${error.message}`, 'red'));
    return [];
  }
}

async function createUser() {
  console.log(colorize('\n=== CREATE NEW USER ===', 'green'));

  try {
    // Get email
    let email;
    while (true) {
      email = normalizeEmail(await question('Email: '));
      if (!email) {
        console.log(colorize('Email is required.', 'red'));
        continue;
      }
      if (!validateEmail(email)) {
        console.log(colorize('Please enter a valid email address.', 'red'));
        continue;
      }

      // Check if email already exists
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        console.log(colorize('A user with this email already exists.', 'red'));
        continue;
      }
      break;
    }

    // Get name
    let name;
    while (true) {
      name = await question('Full Name: ');
      if (!name.trim()) {
        console.log(colorize('Name is required.', 'red'));
        continue;
      }
      break;
    }

    // Get password
    let password;
    while (true) {
      password = await question('Password (min 12 characters): ');
      if (!password) {
        console.log(colorize('Password is required.', 'red'));
        continue;
      }
      if (password.length < 12) {
        console.log(colorize('Password must be at least 12 characters.', 'red'));
        continue;
      }
      break;
    }

    // Get role
    let role;
    while (true) {
      console.log(colorize('\nAvailable roles:', 'blue'));
      console.log('1. admin    - Full system access');
      console.log('2. operator - Can manage devices and run automations');
      console.log('3. viewer   - Read-only access');
      
      role = await question('Role (admin/operator/viewer) [viewer]: ');
      if (!role.trim()) {
        role = 'viewer';
      }
      if (!validateRole(role)) {
        console.log(colorize('Invalid role. Please choose admin, operator, or viewer.', 'red'));
        continue;
      }
      break;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        name: name.trim(),
        password: hashedPassword,
        role: role.toLowerCase()
      }
    });

    console.log(colorize('\n✓ User created successfully!', 'green'));
    console.log(`Email: ${user.email}`);
    console.log(`Name: ${user.name}`);
    console.log(`Role: ${user.role}`);
    console.log(`ID: ${user.id}`);

  } catch (error) {
    console.error(colorize(`Error creating user: ${error.message}`, 'red'));
  }
}

async function selectAndManageUser(users) {
  if (users.length === 0) return;

  console.log(colorize('\n=== SELECT USER TO MANAGE ===', 'magenta'));
  const selection = await question(`Select user (1-${users.length}) or 'b' to go back: `);

  if (selection.toLowerCase() === 'b') {
    return;
  }

  const userIndex = parseInt(selection) - 1;
  if (isNaN(userIndex) || userIndex < 0 || userIndex >= users.length) {
    console.log(colorize('Invalid selection.', 'red'));
    return;
  }

  const selectedUser = users[userIndex];
  await manageUser(selectedUser);
}

async function manageUser(user) {
  while (true) {
    console.log(colorize(`\n=== MANAGING: ${user.email} ===`, 'cyan'));
    console.log('1. Update user details');
    console.log('2. Change password');
    console.log('3. Delete user');
    console.log('4. Back to main menu');

    const choice = await question('Choose an option (1-4): ');

    switch (choice) {
      case '1':
        user = await updateUser(user);
        break;
      case '2':
        await changePassword(user);
        break;
      case '3':
        const deleted = await deleteUser(user);
        if (deleted) return;
        break;
      case '4':
        return;
      default:
        console.log(colorize('Invalid choice. Please select 1-4.', 'red'));
    }
  }
}

async function updateUser(user) {
  console.log(colorize('\n=== UPDATE USER DETAILS ===', 'yellow'));
  console.log(`Current email: ${user.email}`);
  console.log(`Current name: ${user.name}`);
  console.log(`Current role: ${user.role}`);

  try {
    // Update email
    let newEmail = normalizeEmail(await question(`New email [${user.email}]: `));
    if (newEmail && newEmail !== user.email) {
      if (!validateEmail(newEmail)) {
        console.log(colorize('Invalid email format.', 'red'));
        return user;
      }
      // Check if email already exists
      const existingUser = await prisma.user.findUnique({ where: { email: newEmail } });
      if (existingUser) {
        console.log(colorize('A user with this email already exists.', 'red'));
        return user;
      }
    } else {
      newEmail = user.email;
    }

    // Update name
    let newName = await question(`New name [${user.name}]: `);
    if (!newName.trim()) {
      newName = user.name;
    }

    // Update role
    let newRole;
    while (true) {
      console.log(colorize('\nAvailable roles:', 'blue'));
      console.log('1. admin    - Full system access');
      console.log('2. operator - Can manage devices and run automations');
      console.log('3. viewer   - Read-only access');
      
      newRole = await question(`New role [${user.role}]: `);
      if (!newRole.trim()) {
        newRole = user.role;
        break;
      }
      if (!validateRole(newRole)) {
        console.log(colorize('Invalid role. Please choose admin, operator, or viewer.', 'red'));
        continue;
      }
      break;
    }

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        email: newEmail.trim(),
        name: newName.trim(),
        role: newRole.toLowerCase()
      }
    });

    console.log(colorize('\n✓ User updated successfully!', 'green'));
    return updatedUser;

  } catch (error) {
    console.error(colorize(`Error updating user: ${error.message}`, 'red'));
    return user;
  }
}

async function changePassword(user) {
  console.log(colorize('\n=== CHANGE PASSWORD ===', 'yellow'));
  console.log(`User: ${user.email}`);

  try {
    let newPassword;
    while (true) {
      newPassword = await question('New password (min 12 characters): ');
      if (!newPassword) {
        console.log(colorize('Password is required.', 'red'));
        continue;
      }
      if (newPassword.length < 12) {
        console.log(colorize('Password must be at least 12 characters.', 'red'));
        continue;
      }
      break;
    }

    const confirmPassword = await question('Confirm new password: ');
    if (newPassword !== confirmPassword) {
      console.log(colorize('Passwords do not match.', 'red'));
      return;
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: user.id },
      data: { 
        password: hashedPassword,
        refreshToken: null // Invalidate existing refresh tokens
      }
    });

    console.log(colorize('\n✓ Password changed successfully!', 'green'));

  } catch (error) {
    console.error(colorize(`Error changing password: ${error.message}`, 'red'));
  }
}

async function deleteUser(user) {
  console.log(colorize('\n=== DELETE USER ===', 'red'));
  console.log(`User: ${user.email} (${user.name})`);
  console.log(colorize('⚠️  WARNING: This action cannot be undone!', 'yellow'));

  const confirmation = await question('Are you sure you want to delete this user? (type "DELETE" to confirm): ');
  
  if (confirmation !== 'DELETE') {
    console.log(colorize('User deletion cancelled.', 'yellow'));
    return false;
  }

  try {
    // Shared records the user created (cloud integrations, credentials, the
    // Git mirror config, automations) go to the longest-standing other admin
    // rather than being cascade-deleted with the account.
    const newOwner = await prisma.user.findFirst({
      where: { role: 'admin', id: { not: user.id } },
      orderBy: { createdAt: 'asc' },
    });
    if (!newOwner) {
      console.log(colorize('Cannot delete the only admin. Create or promote another admin first.', 'red'));
      return false;
    }

    const reassigned = await deleteUserPreservingData(prisma, user.id, newOwner.id);
    console.log(colorize('\n✓ User deleted successfully!', 'green'));
    if (Object.keys(reassigned).length) {
      console.log(`Records transferred to ${newOwner.email}: ${JSON.stringify(reassigned)}`);
    }
    return true;

  } catch (error) {
    console.error(colorize(`Error deleting user: ${error.message}`, 'red'));
    return false;
  }
}

async function mainMenu() {
  while (true) {
    console.log(colorize('\n╔════════════════════════════════╗', 'blue'));
    console.log(colorize('║        USER MANAGER            ║', 'blue'));
    console.log(colorize('╚════════════════════════════════╝', 'blue'));
    console.log('1. List all users');
    console.log('2. Create new user');
    console.log('3. Manage existing user');
    console.log('4. Exit');

    const choice = await question('\nChoose an option (1-4): ');

    switch (choice) {
      case '1':
        await listUsers();
        break;
      case '2':
        await createUser();
        break;
      case '3':
        const users = await listUsers();
        if (users.length > 0) {
          await selectAndManageUser(users);
        }
        break;
      case '4':
        console.log(colorize('\nGoodbye!', 'green'));
        await prisma.$disconnect();
        rl?.close();
        process.exit(0);
        break;
      default:
        console.log(colorize('Invalid choice. Please select 1-4.', 'red'));
    }
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log(colorize('\n\nShutting down...', 'yellow'));
  await prisma.$disconnect();
  rl?.close();
  process.exit(0);
});

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(args[i]);
    if (!match) throw new Error(`Unexpected argument: ${args[i]}`);
    flags[match[1]] = match[2] !== undefined ? match[2] : args[++i];
  }
  return flags;
}

async function createAdminCommand(args) {
  const { email, name } = parseFlags(args);
  if (!email) throw new Error('--email <address> is required');
  if (!validateEmail(email)) throw new Error(`Not a valid email address: ${email}`);
  if (!name || name.trim().length < 2) throw new Error('--name "<full name>" is required');

  const provided = process.env.NETHELPER_ADMIN_PASSWORD;
  if (provided !== undefined && provided.length < 12) {
    throw new Error('NETHELPER_ADMIN_PASSWORD must be at least 12 characters');
  }
  const password = provided || crypto.randomBytes(18).toString('base64url');

  const normalizedEmail = normalizeEmail(email);
  if (await prisma.user.findUnique({ where: { email: normalizedEmail } })) {
    throw new Error(`A user with email ${normalizedEmail} already exists`);
  }

  await prisma.user.create({
    data: {
      email: normalizedEmail,
      name: name.trim(),
      role: 'admin',
      password: await bcrypt.hash(password, 12),
    },
  });

  console.log(`Created admin ${normalizedEmail}.`);
  if (!provided) {
    console.log(`Generated password (shown once; change it after signing in): ${password}`);
  }
}

const [command, ...commandArgs] = process.argv.slice(2);

if (command === 'create-admin') {
  createAdminCommand(commandArgs)
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
      console.error(colorize(error.message, 'red'));
      await prisma.$disconnect();
      process.exit(1);
    });
} else if (command) {
  console.error(`Unknown command "${command}". Run with no arguments for the interactive menu, or use create-admin.`);
  process.exit(2);
} else {
  console.log(colorize('Welcome to the User Management Console!', 'bright'));
  console.log(colorize('Press Ctrl+C at any time to exit.', 'yellow'));

  mainMenu().catch(async (error) => {
    console.error(colorize(`Fatal error: ${error.message}`, 'red'));
    await prisma.$disconnect();
    process.exit(1);
  });
}