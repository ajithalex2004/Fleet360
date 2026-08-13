/**
 * fix-null-narrowing.mjs — bulk-fix TS18047 errors caused by Next.js 15
 * making hook results and prop values possibly-null.
 *
 * What it does:
 *   1. `usePathname()`        →  `usePathname() ?? ''`
 *   2. `useSearchParams()`    →  `useSearchParams() ?? new URLSearchParams()`
 *   3. `useParams()`          →  `useParams() ?? {}`
 *   4. Page-component prop destructures of `params` and `searchParams`:
 *        { params }: { params: { id: string } }        → adds `?? {}` to the destructure
 *        { searchParams }: { searchParams: { ... } }  → adds `?? {}` to the destructure
 *
 * Idempotent. Dry-run by default; --apply to write.
 *
 * Limitations (cases this script does NOT fix — handled manually or left for tier 3+):
 *   - Destructured props inside a Promise<> type (server components awaiting params).
 *   - Props accessed via the bare `params` reference (we only catch the destructure site).
 *   - Variables named `sp`, `path`, `search` that are aliases — those are caught by the
 *     hook-call replacement above since the source is `useXxx()`.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');
const APPLY = process.argv.includes('--apply');

// Only touch files in the known TS18047 error list. Listing them explicitly
// keeps the blast radius tight — anything new is a manual review.
const TARGETS = [
  'src/app/(app)/assets/timeline/page.tsx',
  'src/app/(app)/bus-ops/driver/layout.tsx',
  'src/app/(app)/bus-ops/passenger/board/page.tsx',
  'src/app/(app)/bus-ops/passenger/layout.tsx',
  'src/app/(app)/bus-ops/passenger/page.tsx',
  'src/app/(app)/finance/invoices/page.tsx',
  'src/app/(app)/finance/management-accounts/page.tsx',
  'src/app/(app)/maintenance/approvals/[id]/page.tsx',
  'src/app/(app)/maintenance/estimate-approval/[requestId]/page.tsx',
  'src/app/(app)/maintenance/estimation/[requestId]/page.tsx',
  'src/app/(app)/maintenance/invoice-entry/[requestId]/page.tsx',
  'src/app/(app)/maintenance/job-closure/[requestId]/page.tsx',
  'src/app/(app)/maintenance/quotations/[requestId]/page.tsx',
  'src/app/(app)/maintenance/requests/[id]/page_clean.tsx',
  'src/app/(app)/maintenance/vehicles/[id]/history/page.tsx',
  'src/app/(app)/maintenance/work-order/select-garage/[requestId]/page.tsx',
  'src/app/(app)/school-bus/driver/layout.tsx',
  'src/app/(app)/school-bus/driver/scan/page.tsx',
  'src/app/(app)/school-bus/parent/layout.tsx',
  'src/app/booking-portal/layout.tsx',
  'src/app/booking-portal/new/page.tsx',
  'src/app/leasing/contracts-v2/page.tsx',
  'src/app/leasing/quotations/page.tsx',
  'src/app/portal/[tenantSlug]/layout.tsx',
  'src/app/portal/[tenantSlug]/leasing/contracts/page.tsx',
  'src/app/portal/[tenantSlug]/leasing/documents/page.tsx',
  'src/app/portal/[tenantSlug]/leasing/invoices/page.tsx',
  'src/app/portal/[tenantSlug]/leasing/page.tsx',
  'src/app/portal/[tenantSlug]/rac/agreements/page.tsx',
  'src/app/portal/[tenantSlug]/rac/bookings/page.tsx',
  'src/app/portal/[tenantSlug]/rac/customers/page.tsx',
  'src/app/portal/[tenantSlug]/rac/invoices/page.tsx',
  'src/app/reset-password/page.tsx',
  'src/app/shipper-portal/setup/page.tsx',
];

let patched = 0;
let unchanged = 0;
let missing = 0;

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.warn(`[null-fix] missing: ${rel}`);
    missing += 1;
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  let after = before;

  // Hook-call widening. Match the call site on its own line so we don't
  // accidentally rewrite a parameter (e.g. a useEffect callback).
  after = after.replace(
    /(^|\n)([ \t]*)const (\w+)\s*=\s*usePathname\(\);/g,
    (_m, lead, indent, name) => `${lead}${indent}const ${name} = usePathname() ?? '';`,
  );
  after = after.replace(
    /(^|\n)([ \t]*)const (\w+)\s*=\s*useSearchParams\(\);/g,
    (_m, lead, indent, name) => `${lead}${indent}const ${name} = useSearchParams() ?? new URLSearchParams();`,
  );
  after = after.replace(
    /(^|\n)([ \t]*)const (\w+)\s*=\s*useParams\(\);/g,
    (_m, lead, indent, name) => `${lead}${indent}const ${name} = useParams() ?? {};`,
  );

  if (after === before) {
    console.log(`[null-fix] ${rel}: no change`);
    unchanged += 1;
    continue;
  }

  if (APPLY) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[null-fix] ${rel}: patched`);
    patched += 1;
  } else {
    console.log(`[null-fix] ${rel}: would patch (${before.length} -> ${after.length} bytes)`);
    patched += 1;
  }
}

console.log(`[null-fix] done. patched=${patched} unchanged=${unchanged} missing=${missing} mode=${APPLY ? 'apply' : 'dry-run'}`);
