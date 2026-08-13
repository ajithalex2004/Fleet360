/**
 * patch-app-shell-wrappers.mjs — strip the <AppShell> wrapper from every
 * Category A module's layout.tsx after the (app) route-group migration.
 *
 * Why this is a script:
 *   14 files to edit with the same transformation. Doing it by hand is
 *   error-prone (forgetting one, drift between files). A scripted
 *   transform with a dry-run flag is auditable and reversible.
 *
 * What it does per file:
 *   1. Remove the `import AppShell from '@/components/nav/AppShell';` line.
 *   2. Replace the <AppShell>{children-wrapper}</AppShell> block with the
 *      inner children wrapper, one level less indented.
 *   3. Leave everything else (ModuleGuard, PlatformHomeBar, useLanguage,
 *      the wrapping <div>) untouched.
 *
 * Idempotent: re-running on already-patched files is a no-op.
 *
 * Run with `--apply` to write. Default is dry-run (prints diff hints).
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APP_GROUP = path.join(ROOT, 'src', 'app', '(app)');

const TARGETS = [
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

const APPLY = process.argv.includes('--apply');

let patched = 0;
let skipped = 0;
let unchanged = 0;

for (const m of TARGETS) {
  const file = path.join(APP_GROUP, m, 'layout.tsx');
  if (!fs.existsSync(file)) {
    console.warn(`[patch] skip ${m}: not found`);
    skipped += 1;
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  let after = before;

  // 1. Strip the AppShell import line.
  after = after.replace(/import AppShell from '@\/components\/nav\/AppShell';\n/g, '');

  // 2. Replace <AppShell>...{children}...</AppShell> with the inner wrapper.
  //    The pre-migration pattern is always:
  //        <AppShell>
  //          <div className="p-6">{children}</div>
  //        </AppShell>
  //    Replace with the inner <div>, dedented by 2 spaces.
  after = after.replace(
    /        <AppShell>\n          <div className="p-6">\{children\}<\/div>\n        <\/AppShell>/g,
    '        <div className="p-6">{children}</div>',
  );

  if (after === before) {
    console.log(`[patch] ${m}: no change`);
    unchanged += 1;
    continue;
  }

  if (APPLY) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[patch] ${m}: patched`);
    patched += 1;
  } else {
    console.log(`[patch] ${m}: would patch (${before.length} -> ${after.length} bytes)`);
    patched += 1;
  }
}

console.log(`[patch] done. patched=${patched} unchanged=${unchanged} skipped=${skipped} mode=${APPLY ? 'apply' : 'dry-run'}`);
