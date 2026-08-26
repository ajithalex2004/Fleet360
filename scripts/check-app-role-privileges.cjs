/**
 * Step 2: can fleet360_app actually run the application?
 *
 * Read-only. Checks the six things that must hold before the runtime role can
 * change, across EVERY schema containing tenant-bearing tables — not just
 * public, for the same reason check-rls-effective had to stop doing that.
 *
 *   1. USAGE on each schema
 *   2. SELECT/INSERT/UPDATE/DELETE on tables
 *   3. USAGE/SELECT on sequences
 *   4. EXECUTE on functions
 *   5. DEFAULT PRIVILEGES for future tables
 *   6. DEFAULT PRIVILEGES for future sequences
 *
 * A missing privilege fails as 42501 "permission denied", which looks nothing
 * like an RLS denial. Sorting that out during the activation pass would mean
 * every finding needs re-triage, so it is worth knowing beforehand.
 */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const q = (s, ...a) => prisma.$queryRawUnsafe(s, ...a);

const ROLE = process.argv[2] || 'fleet360_app';

/**
 * Schemas the application role must deliberately NOT reach.
 *
 * Without this the checker cannot tell "not provisioned yet" from "provisioned
 * away on purpose", and reports the intended end state as two outstanding gaps
 * forever — which trains people to ignore its output.
 *
 * The assertion is inverted for these: holding USAGE is the failure.
 */
const EXCLUDED_SCHEMAS = [
  {
    schema: 'neon_auth',
    reason:
      'Neon-managed authentication infrastructure (user, session, account, jwks, ' +
      'verification). Not a Fleet360 schema. If something in the app turns out to ' +
      'need it, that should surface as a visible 42501 and be argued for, not ' +
      'pre-granted. See 20260910000010.',
  },
];
let gaps = 0;
const line = (ok, label, detail) => {
  if (!ok) gaps++;
  console.log(`${ok ? ' ok ' : 'GAP '} ${label.padEnd(46)} ${detail}`);
};

async function main() {
  for (let i = 0; i < 6; i++) {
    try { await q('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  const [r] = await q(`SELECT rolname, rolbypassrls, rolsuper, rolcanlogin
     FROM pg_roles WHERE rolname = $1`, ROLE);
  if (!r) { console.log(`role ${ROLE} does not exist`); process.exit(1); }
  console.log(`\nrole ${ROLE}: bypassrls=${r.rolbypassrls} super=${r.rolsuper} canlogin=${r.rolcanlogin}`);
  line(!r.rolbypassrls, 'does NOT hold BYPASSRLS', r.rolbypassrls ? 'it does — RLS would not apply' : 'correct');
  line(r.rolcanlogin, 'can log in', String(r.rolcanlogin));

  const schemas = (await q(`
    SELECT DISTINCT n.nspname FROM pg_namespace n
     JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind = 'r'
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_%'
    ORDER BY 1`)).map(x => x.nspname);
  console.log(`\nschemas to cover: ${schemas.join(', ')}\n`);

  for (const s of schemas) {
    const excluded = EXCLUDED_SCHEMAS.find(e => e.schema === s);
    if (excluded) {
      const [u] = await q(`SELECT has_schema_privilege($1, $2, 'USAGE') AS ok`, ROLE, s);
      // Inverted: for an excluded schema, having access is the defect.
      line(!u.ok, `${s} is EXCLUDED and stays unreachable`,
        u.ok ? `GRANTED — ${ROLE} should not reach this schema` : 'correctly not granted');
      console.log(`       └─ ${excluded.reason}`);
      continue;
    }

    // 1. Schema USAGE — without it every table grant is inert.
    const [u] = await q(`SELECT has_schema_privilege($1, $2, 'USAGE') AS ok`, ROLE, s);
    line(u.ok, `USAGE on schema ${s}`, u.ok ? 'granted' : 'MISSING — all table grants inert');

    // 2. Table DML.
    const tables = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relkind='r'`, s);
    let missing = [];
    for (const t of tables) {
      const [p] = await q(
        `SELECT has_table_privilege($1, format('%I.%I',$2::text,$3::text), 'SELECT') AS s,
                has_table_privilege($1, format('%I.%I',$2::text,$3::text), 'INSERT') AS i,
                has_table_privilege($1, format('%I.%I',$2::text,$3::text), 'UPDATE') AS u,
                has_table_privilege($1, format('%I.%I',$2::text,$3::text), 'DELETE') AS d`,
        ROLE, s, t.relname);
      if (!(p.s && p.i && p.u && p.d)) missing.push(t.relname);
    }
    line(missing.length === 0, `DML on ${s} tables (${tables.length})`,
      missing.length ? `MISSING on ${missing.length}: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}` : 'all four verbs on every table');

    // 3. Sequences — an INSERT into a serial column fails without these.
    const seqs = await q(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname=$1 AND c.relkind='S'`, s);
    if (seqs.length) {
      let badSeq = [];
      for (const sq of seqs) {
        const [p] = await q(
          `SELECT has_sequence_privilege($1, format('%I.%I',$2::text,$3::text), 'USAGE') AS u,
                  has_sequence_privilege($1, format('%I.%I',$2::text,$3::text), 'SELECT') AS s`,
          ROLE, s, sq.relname);
        if (!(p.u && p.s)) badSeq.push(sq.relname);
      }
      line(badSeq.length === 0, `USAGE+SELECT on ${s} sequences (${seqs.length})`,
        badSeq.length ? `MISSING on ${badSeq.length}: ${badSeq.slice(0, 4).join(', ')}` : 'granted');
    } else {
      console.log(`     ${s}: no sequences`);
    }

    // 4. Functions.
    const fns = await q(`SELECT p.oid, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname=$1`, s);
    if (fns.length) {
      let badFn = [];
      for (const f of fns) {
        const [p] = await q(`SELECT has_function_privilege($1, $2::oid, 'EXECUTE') AS ok`, ROLE, f.oid);
        if (!p.ok) badFn.push(f.proname);
      }
      line(badFn.length === 0, `EXECUTE on ${s} functions (${fns.length})`,
        badFn.length ? `MISSING on ${badFn.length}: ${badFn.slice(0, 4).join(', ')}` : 'granted');
    }
  }

  // 5 + 6. Default privileges — without these the NEXT migration creates
  //        objects the app cannot touch.
  console.log('');
  const defs = await q(`
    SELECT n.nspname AS schema, d.defaclobjtype AS objtype, d.defaclacl::text AS acl
      FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace`);
  for (const kind of [['r', 'tables'], ['S', 'sequences'], ['f', 'functions']]) {
    const rel = defs.filter(d => d.objtype === kind[0] && (d.acl || '').includes(ROLE));
    line(rel.length > 0, `DEFAULT PRIVILEGES for future ${kind[1]}`,
      rel.length ? `set on: ${rel.map(d => d.schema ?? 'ALL').join(', ')}`
        : `MISSING — objects created by the next migration will not be reachable by ${ROLE}`);
  }

  console.log('');
  if (gaps === 0) {
    console.log('NO PRIVILEGE GAPS — the role switch is unblocked on privileges.');
    console.log(`${EXCLUDED_SCHEMAS.length} schema(s) intentionally excluded and verified unreachable: `
      + EXCLUDED_SCHEMAS.map(e => e.schema).join(', '));
  } else {
    console.log(`${gaps} PRIVILEGE GAP(S) to close before switching`);
  }
  console.log('');
  await prisma.$disconnect();
  process.exit(gaps === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('ERROR:', String(e.message).split('\n').slice(0, 3).join(' | '));
  await prisma.$disconnect();
  process.exit(1);
});
