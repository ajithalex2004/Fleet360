/**
 * revert-bad-any-fix.mjs — undo the broken `: any` insertions from
 * scripts/fix-implicit-any.mjs.
 *
 * Background:
 *   The original script used a line+col-based insertion that produced
 *   `data.filter(a: any => ...)` — invalid syntax for single-arg
 *   arrow functions (which need to become `data.filter((a: any) => ...)`).
 *   This script reverts the touched files to their pre-script state
 *   (i.e. the state right after the (app) migration), and re-runs
 *   the implicit-any fix with a corrected approach.
 *
 * What it does:
 *   1. For each file touched by the broken script, delete the
 *      (app)/path/to/file version.
 *   2. Use `git show HEAD:src/app/path/to/file` to read the
 *      pre-migration version (before we moved the module under
 *      (app)/).
 *   3. Write it to (app)/path/to/file.
 *
 * The (app) migration script and the patch-app-shell-wrappers script
 * can then be re-run if needed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = process.cwd();

const TOUCHED = [
  'src/app/(app)/maintenance/[id]/page.tsx',
  'src/app/(app)/maintenance/action-centre/history/page.tsx',
  'src/app/(app)/maintenance/analytics/page.tsx',
  'src/app/(app)/maintenance/approvals/[id]/page.tsx',
  'src/app/(app)/maintenance/approvals/page.tsx',
  'src/app/(app)/maintenance/estimate-approval/[requestId]/page.tsx',
  'src/app/(app)/maintenance/estimation/[requestId]/page.tsx',
  'src/app/(app)/maintenance/garage-portal/work-orders/page.tsx',
  'src/app/(app)/maintenance/invoice-entry/[requestId]/page.tsx',
  'src/app/(app)/maintenance/invoices/page.tsx',
  'src/app/(app)/maintenance/job-closure/[requestId]/page.tsx',
  'src/app/(app)/maintenance/quotations/[requestId]/page.tsx',
  'src/app/(app)/maintenance/requests/[id]/page_clean.tsx',
  'src/app/(app)/maintenance/vehicles/[id]/history/page.tsx',
  'src/app/(app)/maintenance/work-order/select-garage/[requestId]/page.tsx',
  'src/app/(app)/maintenance/work-orders/page.tsx',
  'src/app/api/rental/agreements/[id]/pdf/route.ts',
  'src/app/operations/dashboard/page.tsx',
];

let reverted = 0;
let missing = 0;

for (const rel of TOUCHED) {
  // The (app) path → original pre-move path
  const m = rel.match(/^src\/app\/\(app\)\/(.+)$/);
  if (!m) {
    console.warn(`[revert] skip non-(app) path: ${rel}`);
    continue;
  }
  const orig = `src/app/${m[1]}`;

  // Read the pre-migration version from git
  let content;
  try {
    content = execSync(`git show HEAD:${orig}`, { encoding: 'utf8' });
  } catch (err) {
    console.warn(`[revert] git show failed for ${orig}: ${err.message.split('\n')[0]}`);
    missing += 1;
    continue;
  }

  fs.writeFileSync(path.join(ROOT, rel), content, 'utf8');
  console.log(`[revert] restored ${rel} from HEAD:${orig}`);
  reverted += 1;
}

console.log(`[revert] done. reverted=${reverted} missing=${missing}`);
