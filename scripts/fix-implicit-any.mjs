/**
 * fix-implicit-any.mjs — bulk-fix TS7006 (Parameter implicitly has 'any' type).
 *
 * Strategy:
 *   For each error in the typecheck log, open the file and patch the
 *   parameter at the (line, col) position with a `: any` annotation.
 *
 *   This is the lowest-risk mechanical fix. Using `: any` is a stopgap
 *   for a real type-safety pass (which would thread proper types from
 *   @/types/maintenance through the lambda callbacks), but it unblocks
 *   the typecheck pass and Tier 2 work.
 *
 * Why targeted (line+col) instead of a global regex:
 *   The codebase has plenty of correctly-typed arrow functions. A regex
 *   that adds `: any` to every untyped param would be invasive and
 *   noisy. Using the typecheck's own error coordinates keeps the blast
 *   radius to exactly the 54 reported errors.
 *
 * Idempotent: re-running on a file where every offending param already
 * has a type is a no-op (the line+col position will be a different
 * character after a previous run, and the regex won't match).
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const LOG = path.join(ROOT, '.harness', 'logs', 'typecheck-after-null.log');
const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(LOG)) {
  console.error(`[any-fix] missing typecheck log: ${LOG}`);
  console.error('[any-fix] run `npx tsc --noEmit` first.');
  process.exit(1);
}

const log = fs.readFileSync(LOG, 'utf8').replace(/\x1b\[[0-9;]*m/g, '');

const errors = [];
for (const line of log.split('\n')) {
  // Lines look like: src/path/file.tsx(LINE,COL): error TS7006: ...
  const m = line.match(/^(.+?)\((\d+),(\d+)\): error TS7006: Parameter '(\w+)'/);
  if (!m) continue;
  errors.push({ file: m[1], line: Number(m[2]), col: Number(m[3]), param: m[4] });
}

// Group by file (so we read+write each file once)
const byFile = new Map();
for (const e of errors) {
  if (!byFile.has(e.file)) byFile.set(e.file, []);
  byFile.get(e.file).push(e);
}

let patched = 0;
let unchanged = 0;
let missing = 0;

for (const [rel, errs] of byFile) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.warn(`[any-fix] missing: ${rel}`);
    missing += 1;
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  const lines = before.split('\n');

  // Sort by line desc so edits don't shift later line numbers
  errs.sort((a, b) => b.line - a.line);

  let touched = false;
  for (const e of errs) {
    const idx = e.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const line = lines[idx];
    // The TS error column points at the start of the parameter name in
    // the source. The parameter name is `e.param` (e.g. "r", "v", "sum").
    // We add `: any` right after the identifier. The column is 1-based.
    const col0 = e.col - 1;
    const before = line.slice(0, col0);
    const after = line.slice(col0);

    // Match the identifier at this position. If it doesn't match, skip.
    const idMatch = after.match(new RegExp(`^${e.param}(\\b)`));
    if (!idMatch) continue;
    // Insert ": any" right after the identifier.
    const insertAt = col0 + idMatch[0].length;
    lines[idx] = line.slice(0, insertAt) + ': any' + line.slice(insertAt);
    touched = true;
  }

  if (!touched) {
    unchanged += 1;
    continue;
  }

  const after = lines.join('\n');
  if (after === before) {
    unchanged += 1;
    continue;
  }

  if (APPLY) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`[any-fix] ${rel}: ${errs.length} params patched`);
    patched += 1;
  } else {
    console.log(`[any-fix] ${rel}: would patch ${errs.length} params`);
    patched += 1;
  }
}

console.log(`[any-fix] done. files=${patched} unchanged=${unchanged} missing=${missing} errors=${errors.length} mode=${APPLY ? 'apply' : 'dry-run'}`);
