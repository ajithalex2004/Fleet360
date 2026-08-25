// Finds `void logAudit(...)` calls that sit INSIDE a Prisma interactive
// transaction callback (withTenantRls / withPlatformAdmin / withSystemJob /
// $transaction). Those floating promises are abandoned when the callback
// returns and the transaction closes, so the audit row never lands —
// verified empirically against route-consolidations/[id].
//
// `void logAudit(...)` placed AFTER the transaction is fine and is the
// dominant, working pattern in this codebase; those are not reported.
import fs from 'fs';
import path from 'path';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const OPENERS = /\b(withTenantRls|withPlatformAdmin|withSystemJob|withWebhookTenant|\$transaction)\s*\(/g;

/** Index of the matching close paren for the '(' at openIdx. */
function matchParen(src, openIdx) {
  let depth = 0, str = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i], prev = src[i - 1];
    if (str) { if (c === str && prev !== '\\') str = null; continue; }
    if (c === "'" || c === '"' || c === '`') { str = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

const hits = [];
for (const file of walk(path.join(process.cwd(), 'src'))) {
  const src = fs.readFileSync(file, 'utf8');
  if (!src.includes('logAudit')) continue;

  // Collect [start,end] ranges of every transaction callback body.
  const ranges = [];
  OPENERS.lastIndex = 0;
  let m;
  while ((m = OPENERS.exec(src)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(src, open);
    if (close > open) ranges.push([open, close]);
  }
  if (!ranges.length) continue;

  const callRe = /void\s+logAudit\s*\(/g;
  let c;
  while ((c = callRe.exec(src)) !== null) {
    const inside = ranges.find(([s, e]) => c.index > s && c.index < e);
    if (inside) {
      hits.push(`${path.relative(process.cwd(), file).replace(/\\/g, '/')}:${src.slice(0, c.index).split('\n').length}`);
    }
  }
}

console.log(hits.length ? hits.join('\n') : '(none)');
console.log(`\n${hits.length} at-risk call site(s): void logAudit inside a transaction callback.`);
