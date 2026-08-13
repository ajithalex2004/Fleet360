// Set a new password for Platform Admin (admin@xl-mobility.com).
// Generates a cryptographically random password, hashes it with the same
// PBKDF2-SHA512 / 100k iters / 64-byte output the system uses, and writes
// it directly to the database (bypasses the API which would need a session).
//
// IMPORTANT: the password is printed to stdout ONCE. Copy it to a password
// manager before the script exits. The user should change it after first login.

import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Find the user
const user = await prisma.user.findFirst({
  where: { email: 'admin@xl-mobility.com' },
  select: { id: true, email: true, firstName: true, lastName: true },
});
if (!user) {
  console.error('admin@xl-mobility.com not found.');
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`Target: ${user.firstName} ${user.lastName} <${user.email}>  (id=${user.id})`);

// Hash with the same params as the system (no password printed yet — only after verified write)
const password = crypto.randomBytes(15).toString('base64url');
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
const stored = `${salt}:${hash}`;
console.log(`Generated: ${stored.length} char hash (salt + pbkdf2-sha512, 100k iter, 64-byte)`);

// Update the User table — use the actual column name (updatedAt, camelCase)
const now = new Date();
const result = await prisma.$executeRawUnsafe(
  `UPDATE "User" SET password_hash = $1, "updatedAt" = $2 WHERE id = $3`,
  stored,
  now,
  user.id,
);
console.log(`  UPDATE statement affected ${result} row(s).`);

// Verify by reading back
const verify = await prisma.$queryRawUnsafe(
  `SELECT password_hash FROM "User" WHERE id = $1`,
  user.id,
);
const newHash = verify[0]?.password_hash;

if (newHash !== stored) {
  console.log(`\nFAILED: hash in DB does not match. Aborting.`);
  console.log(`  expected: ${stored.slice(0, 20)}...`);
  console.log(`  actual:   ${(newHash ?? 'NULL').slice(0, 20)}...`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`\nVerification: hash in DB matches. length=${newHash.length} chars.`);

// Only NOW print the password — after verified success
console.log(`\n=== NEW PASSWORD (copy now, will not be shown again) ===`);
console.log(`  ${password}`);
console.log(`========================================================`);
console.log(`\nLogin as ${user.email} with the password above.`);
console.log(`Change it via /api/admin/change-password after first login.`);

await prisma.$disconnect();
