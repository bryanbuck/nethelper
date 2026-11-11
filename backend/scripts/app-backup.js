#!/usr/bin/env node
/**
 * Take one application backup now, with the saved App Backup settings
 * (Settings -> App Backup: encryption, history, retention), and print the
 * archive's name. The upgrade commands (deploy/install.sh --upgrade,
 * nethelper-admin upgrade) run it before they change anything.
 *
 * Usage (from backend/; NetHelper may be running):
 *   node scripts/app-backup.js [--trigger upgrade|manual]
 *
 * Exit status: 0 with "archive: <name>" on the last line, 1 on failure,
 * 3 when another backup is running.
 */
require('dotenv').config({ quiet: true });

const TRIGGERS = ['upgrade', 'manual'];
// A run the server started more than this long ago is taken to be dead.
const RUNNING_STALE_MS = 2 * 60 * 60 * 1000;

function parseArgs(argv) {
  const opts = { trigger: 'upgrade' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--trigger') opts.trigger = argv[++i];
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  if (!TRIGGERS.includes(opts.trigger)) throw new Error(`--trigger must be one of: ${TRIGGERS.join(', ')}`);
  return opts;
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  if (opts.help) {
    console.log('Usage: node scripts/app-backup.js [--trigger upgrade|manual]');
    return 0;
  }

  // Keep this process's log lines off the terminal and out of the server's log files.
  process.env.LOG_FILES = 'false';
  process.env.LOG_LEVEL = process.env.APP_BACKUP_CLI_LOG_LEVEL || 'error';

  const { connectDatabase, disconnectDatabase, getPrisma } = require('../src/config/database');
  await connectDatabase();
  try {
    // The server keeps "a backup is running" in memory; from here only the run rows show it.
    const running = await getPrisma().appBackupRun.findFirst({
      where: { status: 'running', startedAt: { gt: new Date(Date.now() - RUNNING_STALE_MS) } },
    });
    if (running) {
      console.error('Another application backup is running; try again when it has finished.');
      return 3;
    }
    const appBackupService = require('../src/services/app-backup.service');
    const result = await appBackupService.run({ trigger: opts.trigger });
    // run() reports to the alert service without waiting; let that write land.
    await new Promise((resolve) => setTimeout(resolve, 500));
    console.log(`archive: ${result.archive.name}`);
    return 0;
  } catch (error) {
    console.error(`Application backup failed: ${error.message}`);
    return 1;
  } finally {
    await disconnectDatabase().catch(() => {});
  }
}

main().then((code) => process.exit(code), (error) => {
  console.error(error.message);
  process.exit(1);
});
