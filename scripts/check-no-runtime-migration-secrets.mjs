/**
 * scripts/check-no-runtime-migration-secrets.mjs
 *
 * Contractual Static Analysis Guard:
 * Asserts that application runtime code under `src/**` never references
 * migration-privileged credentials (`MIGRATION_DATABASE_URL` or `DIRECT_URL`).
 *
 * Rules:
 *   - src/** may only reference `DATABASE_URL` and `RUNTIME_DIRECT_DATABASE_URL`.
 *   - `MIGRATION_DATABASE_URL` and `DIRECT_URL` (holding neondb_owner credentials)
 *     are strictly isolated to `prisma/`, `scripts/`, and deployment tooling.
 *
 * Exit code 0 = Clean credential isolation
 * Exit code 1 = Migration secret leak in runtime code (CI fails)
 */

import fs from 'fs';
import path from 'path';

const SRC_DIR = path.resolve('src');
const FORBIDDEN_TOKENS = ['MIGRATION_DATABASE_URL', 'process.env.DIRECT_URL', 'DIRECT_URL'];

// Files in src/ allowed to mention forbidden tokens (must be empty or strictly justified doc comments)
const ALLOWLIST = [];

function scanDirectory(dir, violations = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(process.cwd(), fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      scanDirectory(fullPath, violations);
    } else if (entry.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      if (ALLOWLIST.includes(relPath)) continue;

      const content = fs.readFileSync(fullPath, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, idx) => {
        // Ignore single-line comments in docs if not an env read
        const isCodeUsage = /process\.env\.(DIRECT_URL|MIGRATION_DATABASE_URL)/.test(line) ||
          (/(DIRECT_URL|MIGRATION_DATABASE_URL)/.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*'));

        if (isCodeUsage) {
          violations.push({
            file: relPath,
            line: idx + 1,
            snippet: line.trim(),
          });
        }
      });
    }
  }

  return violations;
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('CHECKING APPLICATION RUNTIME CREDENTIAL ISOLATION (src/**)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const violations = scanDirectory(SRC_DIR);

if (violations.length > 0) {
  console.error(`❌ FAILED: Found ${violations.length} forbidden migration secret references in application runtime:\n`);
  violations.forEach((v) => {
    console.error(`  - ${v.file}:${v.line} -> ${v.snippet}`);
  });
  console.error('\nApplication runtime must only use DATABASE_URL (pooled) or RUNTIME_DIRECT_DATABASE_URL (direct fleet360_app).');
  console.error('Owner credentials (DIRECT_URL / MIGRATION_DATABASE_URL) must stay isolated to migration tooling.\n');
  process.exit(1);
} else {
  console.log('✅ ALL APPLICATION RUNTIME CODE (src/**) PROVEN ISOLATED FROM MIGRATION CREDENTIALS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
}
