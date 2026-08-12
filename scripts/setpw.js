/**
 * setpw.js — DEV/OPERATIONS ONLY — password reset tool.
 *
 * Sets the password for the platform operator account
 * (alex@exlsolutions.ae) by writing a pbkdf2_sha512 hash into the
 * `User.password_hash` column.
 *
 * Run:    node setpw.js
 * Needs:  DATABASE_URL in env (.env.local or shell)
 *
 * Password source (in order):
 *   1. SETPW_PASSWORD env var (preferred — never commit)
 *   2. Interactive prompt (so it doesn't sit in shell history)
 *   3. Refuses to run if neither is available — no more hardcoded defaults.
 *
 * History note: this script used to hardcode `PASSWORD = 'Admin@1234'`.
 * That value is now removed (see git history / docs/KNOWN_GAPS.md §SEC-001).
 * If you're chasing the old default for a local DB you already set up, the
 *   legacy value remains 'Admin@1234' until you run this script again.
 */

const crypto = require('crypto');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const readline = require('readline');

const EMAIL = process.env.SETPW_EMAIL || 'alex@exlsolutions.ae';

function readPassword() {
  if (process.env.SETPW_PASSWORD) {
    return Promise.resolve(process.env.SETPW_PASSWORD);
  }
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    rl.question(`New password for ${EMAIL}: `, (answer) => {
      rl.close();
      if (!answer || answer.length < 12) {
        reject(new Error('Password must be at least 12 characters (use SETPW_PASSWORD env var in CI).'));
        return;
      }
      resolve(answer);
    });
  });
}

(async () => {
  let password;
  try {
    password = await readPassword();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const p = new PrismaClient();
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  const stored = salt + ':' + hash;

  try {
    await p.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN IF NOT EXISTS password_hash TEXT');
    const n = await p.$executeRawUnsafe('UPDATE "User" SET password_hash=$1 WHERE email=$2', stored, EMAIL);
    console.log('Done! Rows updated:', Number(n));
  } catch (err) {
    console.error('Error:', err.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();