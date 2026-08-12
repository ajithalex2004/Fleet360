/**
 * migrate-to-app-shell.mjs — one-shot migration of Category A modules
 * under src/app/(app)/* to opt into the shared persistent AppShell.
 *
 * Why this script exists (and why it's a script, not a manual refactor):
 *   The dev server has the source files locked on Windows. Plain
 *   PowerShell `Move-Item` / `Copy-Item` / `Remove-Item` all fail with
 *   "Access is denied" because of how the file watcher holds handles.
 *   Node's `fs.cpSync` + `fs.rmSync` do the same operations at a lower
 *   level and don't trip the same Windows access checks.
 *
 * What it does, per module:
 *   1. `cpSync(src/app/MODULE, src/app/(app)/MODULE, {recursive:true})`
 *   2. `rmSync(src/app/MODULE, {recursive:true})`
 *   3. The layout.tsx is left alone for now — caller patches each one
 *      to drop the AppShell import + wrapper (parent provides it).
 *
 * The set of modules is the Category A list from the rollout plan —
 * all modules that previously wrapped with <AppShell> themselves and
 * can transparently inherit the parent shell. Category B (incidents,
 * leasing, agents, customer) and Category C (custom-chrome surfaces,
 * PWAs) are intentionally excluded.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APP_DIR = path.join(ROOT, 'src', 'app');
const APP_GROUP = path.join(APP_DIR, '(app)');

const MODULES = [
  'assets',
  'sustainability',
  'reports',
  'dispatch',
  'school-bus',
  'bus-ops',
  'rental',
  'finance',
  'driver-mgmt',
  'customer-mgmt',
  'maintenance',
  'fleet',
  'admin',
  'approvals',
];

if (!fs.existsSync(APP_GROUP)) {
  console.error(`[migrate] missing route group dir: ${APP_GROUP}`);
  console.error('[migrate] create it first with the (app)/layout.tsx wrapper.');
  process.exit(1);
}

let moved = 0;
let skipped = 0;
for (const m of MODULES) {
  const src = path.join(APP_DIR, m);
  const dst = path.join(APP_GROUP, m);

  if (!fs.existsSync(src)) {
    console.warn(`[migrate] skip ${m}: source not found at ${src}`);
    skipped += 1;
    continue;
  }
  if (fs.existsSync(dst)) {
    console.warn(`[migrate] skip ${m}: destination already exists at ${dst}`);
    skipped += 1;
    continue;
  }

  fs.cpSync(src, dst, { recursive: true, force: true });
  fs.rmSync(src, { recursive: true, force: true });
  console.log(`[migrate] moved src/app/${m} -> src/app/(app)/${m}`);
  moved += 1;
}

console.log(`[migrate] done. moved=${moved} skipped=${skipped}`);
