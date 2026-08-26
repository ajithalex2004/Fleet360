/**
 * Find raw SQL that names a table without naming its schema.
 *
 * WHY THIS EXISTS
 *
 * There are six schemas holding tenant-bearing tables — public, finance, fleet,
 * operations, spatial, workforce — and search_path is only
 * `"$user", public, finance, ai`. An unqualified table name is therefore
 * resolved by a runtime setting, not by the query, and the same SQL can mean
 * different tables depending on configuration.
 *
 * This is not hypothetical. Two cases in this codebase:
 *
 *   finance_payments   existed in BOTH public and finance. public precedes
 *                      finance, so every unqualified reference reached the copy
 *                      with no tenant_id and no RLS while the tenant-isolated
 *                      one sat unreachable behind it. Nothing errored.
 *                      (Fixed in 20260910000005.)
 *
 *   incidents          exists ONLY in `operations`, which is not on
 *                      search_path, so to_regclass('incidents') returns null
 *                      and the endpoint fails with 42P01. A migration comment
 *                      recorded this as "the table does not exist in this
 *                      database", which sent the fix in the wrong direction —
 *                      it exists, it is unreachable.
 *
 * VERDICTS, worst first:
 *
 *   UNRESOLVABLE  the name exists only in schemas absent from search_path.
 *                 This query fails with 42P01 today.
 *   SHADOWED      the name exists in more than one schema. Which one it hits
 *                 depends on search_path order, and the loser may be the
 *                 protected one.
 *   NON_PUBLIC    resolves via a non-public search_path entry (finance, ai).
 *                 Works today, breaks silently if search_path changes or if a
 *                 same-named table is later created in public.
 *   OK            resolves to public, unambiguously.
 *
 * The database is the source of truth for which names exist where; this does
 * not guess from the schema file, which does not model 174 of the live tables.
 *
 * Usage: node scripts/check-schema-qualified-sql.mjs [--all] [--json]
 * Exit 0 clean, 1 on UNRESOLVABLE/SHADOWED, 2 if the self-tests fail.
 */

import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const SHOW_ALL = process.argv.includes('--all');
const AS_JSON = process.argv.includes('--json');

const ROOTS = ['src', 'backend', 'scripts'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.go']);
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'generated']);

/**
 * Pull table references out of a SQL string.
 *
 * Deliberately conservative: only the four positions where a bare table name is
 * unambiguous. Subqueries, CTEs and aliases are not chased — a missed reference
 * is a gap, but a mis-parsed one would be a false accusation, and this has to
 * be trusted to be useful.
 */
export function tableRefs(sql) {
  const out = [];
  const patterns = [
    /\bFROM\s+([a-zA-Z_][\w.]*)/gi,
    /\bJOIN\s+([a-zA-Z_][\w.]*)/gi,
    /\bINSERT\s+INTO\s+([a-zA-Z_][\w.]*)/gi,
    /\bUPDATE\s+([a-zA-Z_][\w.]*)/gi,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(sql)) !== null) {
      const raw = m[1];
      // Skip interpolations, CTE-ish keywords and anything already qualified.
      if (/^\$|^\{/.test(raw)) continue;
      if (/^(SELECT|LATERAL|ONLY|VALUES|UNNEST|generate_series)$/i.test(raw)) continue;
      out.push(raw.replace(/"/g, ''));
    }
  }
  return out;
}

/** Extract raw-SQL string literals from a source file. */
export function sqlLiterals(src) {
  const out = [];
  // Prisma raw calls and GORM Raw/Exec, then any template/quoted literal that
  // looks like SQL inside them.
  const callRe = /\$(?:query|execute)Raw(?:Unsafe)?\s*(?:<[^>]*>)?\s*[(<`]|\.(?:Raw|Exec)\s*\(/g;
  let m;
  while ((m = callRe.exec(src)) !== null) {
    const rest = src.slice(m.index, m.index + 4000);
    for (const lit of rest.matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)) {
      const s = lit[1] ?? lit[2] ?? lit[3] ?? '';
      if (/\b(FROM|JOIN|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(s)) {
        out.push({ sql: s, offset: m.index });
        break;
      }
    }
  }
  return out;
}

function walk(dir, acc = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (EXTS.has(path.extname(e.name))) acc.push(p);
  }
  return acc;
}

function selfTest() {
  const cases = [
    ['FROM', tableRefs('SELECT * FROM finance_payments p').join(), 'finance_payments'],
    ['JOIN', tableRefs('SELECT 1 FROM a LEFT JOIN finance_invoices i ON i.id = a.x').join(), 'a,finance_invoices'],
    ['INSERT INTO', tableRefs('INSERT INTO bookings (a) VALUES (1)').join(), 'bookings'],
    ['UPDATE', tableRefs('UPDATE route_stops SET x = 1').join(), 'route_stops'],
    ['already qualified is still reported (caller decides)',
      tableRefs('SELECT * FROM finance.finance_payments').join(), 'finance.finance_payments'],
    ['interpolation skipped', tableRefs('SELECT * FROM ${table}').join(), ''],
    ['FROM (SELECT skipped', tableRefs('SELECT * FROM (SELECT 1) x').join(), ''],
    ['literal detection', String(sqlLiterals('await tx.$queryRawUnsafe(`SELECT 1 FROM vehicles`)').length), '1'],
    ['non-SQL literal ignored', String(sqlLiterals('foo(`hello world`)').length), '0'],
  ];
  const bad = cases.filter(([, got, want]) => got !== want);
  if (bad.length) {
    console.error('SELF-TEST FAILED:');
    bad.forEach(([n, g, w]) => console.error(`  ${n}: got ${JSON.stringify(g)} want ${JSON.stringify(w)}`));
    process.exit(2);
  }
  return cases.length;
}

async function main() {
  const tests = selfTest();
  const prisma = new PrismaClient();
  for (let i = 0; i < 6; i++) {
    try { await prisma.$queryRawUnsafe('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  const spRaw = (await prisma.$queryRawUnsafe(`SHOW search_path`))[0].search_path;
  const me = (await prisma.$queryRawUnsafe(`SELECT current_user AS u`))[0].u;
  const searchPath = spRaw.split(',').map(x => x.trim().replace(/^"|"$/g, '')).map(x => x === '$user' ? me : x);

  // Ground truth: which names live in which schemas.
  const rows = await prisma.$queryRawUnsafe(`
    SELECT n.nspname AS schema, c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r','v','m','p')
       AND n.nspname NOT IN ('pg_catalog','information_schema')
       AND n.nspname NOT LIKE 'pg_%'`);
  const bySchema = new Map();
  for (const r of rows) {
    if (!bySchema.has(r.name)) bySchema.set(r.name, []);
    bySchema.get(r.name).push(r.schema);
  }
  await prisma.$disconnect();

  const findings = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = fs.readFileSync(file, 'utf8');
      for (const { sql, offset } of sqlLiterals(src)) {
        const line = src.slice(0, offset).split('\n').length;
        for (const ref of new Set(tableRefs(sql))) {
          if (ref.includes('.')) continue;            // already qualified
          const schemas = bySchema.get(ref);
          if (!schemas) continue;                     // not a table we know
          const onPath = schemas.filter(s => searchPath.includes(s));

          let verdict;
          if (onPath.length === 0) verdict = 'UNRESOLVABLE';
          else if (schemas.length > 1) verdict = 'SHADOWED';
          else if (onPath[0] !== 'public') verdict = 'NON_PUBLIC';
          else verdict = 'OK';

          if (verdict !== 'OK') findings.push({ file, line, ref, schemas, verdict });
        }
      }
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ searchPath, findings }, null, 2));
    process.exit(findings.some(f => f.verdict !== 'NON_PUBLIC') ? 1 : 0);
  }

  const by = (v) => findings.filter(f => f.verdict === v);
  console.log(`\nsearch_path: ${spRaw}`);
  console.log(`${tests} self-tests passed\n`);
  console.log('─'.repeat(70));
  for (const v of ['UNRESOLVABLE', 'SHADOWED', 'NON_PUBLIC']) {
    const n = by(v).length;
    const mark = v === 'NON_PUBLIC' ? '  ' : (n ? '🔴' : '  ');
    console.log(`  ${mark} ${v.padEnd(14)} ${String(n).padStart(4)}   ${{
      UNRESOLVABLE: 'fails with 42P01 today — the schema is not on search_path',
      SHADOWED: 'name exists in >1 schema; search_path order decides which',
      NON_PUBLIC: 'resolves via a non-public search_path entry — works, but fragile',
    }[v]}`);
  }
  console.log('─'.repeat(70));

  for (const v of ['UNRESOLVABLE', 'SHADOWED', 'NON_PUBLIC']) {
    const list = by(v);
    if (!list.length) continue;
    const show = SHOW_ALL ? list : list.slice(0, 12);
    console.log(`\n${v}:\n`);
    for (const f of show) {
      console.log(`  ${f.file}:${f.line}`);
      console.log(`     ${f.ref}  ->  exists in: ${f.schemas.join(', ')}`);
    }
    if (list.length > show.length) console.log(`  …and ${list.length - show.length} more (--all)`);
  }

  const failing = by('UNRESOLVABLE').length + by('SHADOWED').length;
  console.log(failing === 0
    ? '\n✅ No unresolvable or shadowed table references.\n'
    : `\n${failing} reference(s) must be schema-qualified.\n`);
  process.exit(failing > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERROR:', e.message?.split('\n')[0] ?? e); process.exit(1); });
