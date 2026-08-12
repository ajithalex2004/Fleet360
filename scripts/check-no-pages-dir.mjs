#!/usr/bin/env node
/**
 * scripts/check-no-pages-dir.mjs
 *
 * Build-time guard. Fails the build if a `src/pages/` directory
 * exists in the project root (or in --root=DIR if provided).
 *
 * Why this exists
 * ────────────────
 * Fleet360 uses the App Router exclusively. The project also used
 * to ship a `src/pages/` directory with legacy Pages Router files
 * (`_app.tsx`, `_document.tsx`, `_error.tsx`, a health-check page).
 * Those files weren't referenced from anywhere in `src/app/` — they
 * were orphan scaffolding from the original bootstrap.
 *
 * When the project has BOTH `src/app/` (App Router) and `src/pages/`
 * (Pages Router), Next.js compiles both. With Next.js 15.2.4 +
 * Turbopack, this triggers a known bug: the legacy Pages Router's
 * `_document.js` fails to find the Turbopack SSR runtime chunk at
 * `../chunks/ssr/[turbopack]_runtime.js`. The browser sees:
 *
 *   Runtime Error
 *   Error: Cannot find module '../chunks/ssr/[turbopack]_runtime.js'
 *   Require stack:
 *   - .next/server/pages/_document.js
 *   - ...
 *
 * Recurring this is — every time `.next` was wiped and Turbopack
 * regenerated, the missing `ssr/[turbopack]_runtime.js` chunk
 * came right back. The fix was to move `src/pages/` out of the way
 * (it now lives at `src/_pages_disabled/` so it's recoverable).
 *
 * This guard makes sure nobody accidentally re-introduces a
 * `src/pages/` directory — which would silently re-enable the
 * Pages Router and re-trigger the bug.
 *
 * Usage
 * ─────
 *   node scripts/check-no-pages-dir.mjs                  # checks CWD/src/pages
 *   node scripts/check-no-pages-dir.mjs --root=mobile-app # checks mobile-app/src/pages
 *   node scripts/check-no-pages-dir.mjs --allow-if-legacy # skip when src/_pages_disabled exists
 *
 * Wired into package.json as `prebuild` and `prebuild:driver` so it
 * runs automatically on every `npm run build` invocation.
 *
 * Exit code
 * ─────────
 *   0  — src/pages/ does not exist (build may proceed)
 *   1  — src/pages/ exists (build must be aborted)
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
function getArg(flag) {
  const hit = args.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : null;
}

const root = resolve(getArg('--root') || process.cwd());
const allowIfLegacy = args.includes('--allow-if-legacy');
const forbidden = join(root, 'src', 'pages');
const legacy = join(root, 'src', '_pages_disabled');

function looksLikePagesDir(absPath) {
  // A real Pages Router directory always has at least one .tsx/.ts/.js file.
  // We don't fail on an empty `src/pages/` folder — only on one that
  // Next.js would actually compile.
  if (!existsSync(absPath)) return false;
  let st;
  try { st = statSync(absPath); } catch { return false; }
  if (!st.isDirectory()) return false;
  const entries = readdirSync(absPath);
  return entries.some((name) => /\.(tsx?|jsx?|mjs)$/i.test(name));
}

if (looksLikePagesDir(forbidden)) {
  // Opt-out: --allow-if-legacy is set AND src/_pages_disabled exists
  if (allowIfLegacy && existsSync(legacy)) {
    process.stderr.write(
      `[check-no-pages-dir] src/pages/ found at ${forbidden}\n` +
      `[check-no-pages-dir] but src/_pages_disabled/ also exists — proceeding (--allow-if-legacy).\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `\n` +
    `❌ Build aborted: src/pages/ directory exists at\n` +
    `   ${forbidden}\n` +
    `\n` +
    `Fleet360 uses the App Router exclusively. Having a src/pages/\n` +
    `directory in addition triggers a Next.js 15.2.4 + Turbopack bug\n` +
    `where the legacy Pages Router _document.js fails to find the\n` +
    `Turbopack SSR runtime chunk:\n` +
    `\n` +
    `   Error: Cannot find module '../chunks/ssr/[turbopack]_runtime.js'\n` +
    `\n` +
    `Fix: move src/pages/ aside so Next.js does not auto-compile it\n` +
    `as the Pages Router. The convention used in this repo is:\n` +
    `\n` +
    `   Move-Item -Path src\\pages -Destination src\\_pages_disabled\n` +
    `\n` +
    `If you intentionally need a Pages Router, opt in by running\n` +
    `with --allow-if-legacy (only honoured if src/_pages_disabled/\n` +
    `also exists, as a marker that the trade-off was considered).\n` +
    `\n`,
  );
  process.exit(1);
}

process.exit(0);
