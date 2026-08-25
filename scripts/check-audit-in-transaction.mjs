#!/usr/bin/env node
/**
 * Flags `void logAudit(...)` calls that sit INSIDE a Prisma interactive
 * transaction callback.
 *
 * WHY THIS MATTERS
 * A floating promise created inside a transaction callback is abandoned when
 * the callback returns, so the audit row never lands — and logAudit swallows
 * its own errors, so nothing surfaces. Verified empirically against
 * route-consolidations/[id]: `void` wrote nothing; hoisting the write to after
 * the transaction wrote the row.
 *
 * The failure is a RACE, not a certainty — DriverPerformance had rows despite
 * using this shape. Affected routes lose entries intermittently, so "I can see
 * rows from that route" does not mean it is healthy.
 *
 * `void logAudit(...)` placed AFTER a transaction is correct and is the
 * dominant pattern in this codebase; those must NOT be reported. That
 * distinction is the whole difficulty, so the detector is self-tested below
 * against one known-bad and one known-good shape — run with --selftest.
 *
 * Exit 1 if any at-risk site is found, so it can gate CI.
 */
import fs from 'fs';
import path from 'path';

const OPENER = /\b(?:withTenantRls|withPlatformAdmin|withSystemJob|withWebhookTenant|\$transaction)\s*\(/g;
const CALL = /void\s+logAudit\s*\(/g;

/**
 * Index of the ')' matching the '(' at openIdx, or -1.
 *
 * Skips strings AND comments. Comment handling is not optional: an apostrophe
 * in an ordinary comment ("Refuse if it's already on...") otherwise opens a
 * string that never closes, the paren scan runs off the end, and the enclosing
 * range collapses — which silently hid a real call site in
 * bus-ops/staff/[id]/rfid-tag until it was caught by hand.
 */
function matchParen(src, openIdx) {
  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    const prev = src[i - 1];

    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (c === quote && prev !== '\\') quote = null;
      continue;
    }
    if (c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Positions of `void logAudit(` calls enclosed by a transaction callback. */
function findAtRisk(src) {
  const ranges = [];
  OPENER.lastIndex = 0;
  let m;
  while ((m = OPENER.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;   // the '(' itself
    const close = matchParen(src, open);
    if (close !== -1) ranges.push([open, close]);
    // Continue scanning from just past the opener so nested calls are seen.
    OPENER.lastIndex = open + 1;
  }

  const out = [];
  CALL.lastIndex = 0;
  let c;
  while ((c = CALL.exec(src)) !== null) {
    if (ranges.some(([s, e]) => c.index > s && c.index < e)) out.push(c.index);
  }
  return out;
}

// ── Self-test ────────────────────────────────────────────────────────────
const BAD = `
export async function DELETE(req) {
  return withTenantRls(prisma, tenantId, async (tx) => {
    await tx.thing.delete({ where: { id } });
    void logAudit({ entityType: 'Thing', action: 'DELETE' });
    return NextResponse.json({ ok: true });
  });
}`;
const GOOD = `
export async function POST(req) {
  await withTenantRls(prisma, tenantId, async (tx) => {
    await tx.thing.create({ data });
  });
  void logAudit({ entityType: 'Thing', action: 'CREATE' });
  return NextResponse.json({ ok: true });
}`;
// Regression shape: an apostrophe in a comment used to break paren matching
// and hide the call site below it.
const BAD_WITH_COMMENT = `
export async function PUT(req) {
  return withTenantRls(prisma, tenantId, async (tx) => {
    // Refuse if it's already assigned elsewhere.
    await tx.thing.update({ where: { id }, data });
    void logAudit({ entityType: 'Thing', action: 'UPDATE' });
    return NextResponse.json({ ok: true });
  });
}`;

function selfTestOk() {
  return findAtRisk(BAD).length === 1
    && findAtRisk(GOOD).length === 0
    && findAtRisk(BAD_WITH_COMMENT).length === 1;
}

if (process.argv.includes('--selftest')) {
  const bad = findAtRisk(BAD).length;
  const good = findAtRisk(GOOD).length;
  const cmt = findAtRisk(BAD_WITH_COMMENT).length;
  console.log(`known-bad  (inside tx)        -> ${bad} hit(s)  ${bad === 1 ? 'PASS' : 'FAIL'}`);
  console.log(`known-good (after tx)         -> ${good} hit(s)  ${good === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`known-bad  (apostrophe in //) -> ${cmt} hit(s)  ${cmt === 1 ? 'PASS' : 'FAIL'}`);
  process.exit(selfTestOk() ? 0 : 1);
}

// Refuse to report if the detector cannot classify its own fixtures.
if (!selfTestOk()) {
  console.error('detector self-test failed — refusing to report (run --selftest)');
  process.exit(2);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(path.join(process.cwd(), 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('logAudit')) continue;
  for (const idx of findAtRisk(src)) {
    const line = src.slice(0, idx).split('\n').length;
    hits.push(`${path.relative(process.cwd(), file).replace(/\\/g, '/')}:${line}`);
  }
}

console.log(hits.length ? hits.join('\n') : '(none)');
console.log(`\n${hits.length} at-risk call site(s): void logAudit inside a transaction callback.`);
process.exit(hits.length ? 1 : 0);
