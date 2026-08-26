/**
 * Effective RLS coverage — does each tenant-owned table actually constrain
 * every command, given how PostgreSQL combines policies?
 *
 * This replaces the metadata check that preceded it, which asked:
 *
 *     tenant_id present AND rls enabled AND policy exists AND with_check NOT NULL
 *
 * That question is wrong in both directions.
 *
 * FALSE POSITIVES it produced:
 *
 *   - For ALL and UPDATE policies, omitting WITH CHECK is not a gap. Postgres
 *     reuses the USING expression as the write check. A correct policy gets
 *     flagged as broken.
 *
 *   - USING (false) is a DENY policy. audit_logs uses exactly this for UPDATE
 *     and DELETE to make the table append-only. It has no WITH CHECK because no
 *     row ever passes USING. The metadata check called this table unsafe; it is
 *     the best-protected table in the schema.
 *
 * FALSE NEGATIVES it produced, which matter more:
 *
 *   - Permissive policies combine with OR. One correctly scoped policy plus one
 *     careless USING (true) yields unrestricted access, and "a policy exists"
 *     is satisfied. Counting policies cannot see this.
 *
 *   - A policy granted only to specific roles may not apply to the role the
 *     application connects as, so it protects nothing at runtime.
 *
 * WHAT THIS CHECKS, per command, per tenant-owned table:
 *
 *   SELECT  qual constrains tenant
 *   DELETE  qual constrains tenant (existing row)
 *   UPDATE  qual constrains the existing row AND with_check (or qual as
 *           fallback) constrains the new row
 *   INSERT  with_check constrains the new row. For a FOR ALL policy the USING
 *           expression is the fallback; for a FOR INSERT policy there is no
 *           USING, so with_check must be present.
 *
 * VERDICTS
 *
 *   OPEN       a permissive policy admits rows without a tenant predicate.
 *              This is a leak. Fails the run.
 *   NO_RLS     table has tenant_id but RLS is not enabled. Also a leak.
 *   SCOPED     every applicable permissive policy constrains the tenant.
 *   DENIED     applicable policies evaluate to false. Intentional, safe.
 *   NO_POLICY  no permissive policy applies, so Postgres denies by default.
 *              Not a leak — but the application WILL break on this command the
 *              moment the runtime role stops holding BYPASSRLS. Reported
 *              separately because it is the loud-failure class, not the silent
 *              one, and you want the list before the switch rather than during.
 *
 * Restrictive policies (polpermissive = false) combine with AND and can only
 * narrow access. They are reported for context but never rescue an OPEN
 * verdict, because a restrictive policy on one command says nothing about
 * another.
 *
 * Usage:
 *   node scripts/check-rls-effective.mjs [--role fleet360_app] [--all] [--json]
 *
 * Exit 0 clean, 1 on OPEN/NO_RLS, 2 if the self-tests fail.
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const args = process.argv.slice(2);
const SHOW_ALL = args.includes('--all');
const AS_JSON = args.includes('--json');
const ROLE = (() => {
  const i = args.indexOf('--role');
  return i >= 0 && args[i + 1] ? args[i + 1] : 'fleet360_app';
})();

const CMD_LABEL = { r: 'SELECT', a: 'INSERT', w: 'UPDATE', d: 'DELETE', '*': 'ALL' };
const COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

// Which policy commands apply to which statement. '*' (ALL) applies to all four.
const APPLIES = {
  SELECT: ['r', '*'],
  INSERT: ['a', '*'],
  UPDATE: ['w', '*'],
  DELETE: ['d', '*'],
};

/**
 * Classify a policy expression.
 *
 * Deliberately textual, against pg_get_expr output rather than a parsed tree:
 * the set of shapes in this schema is small and a reviewer can confirm the
 * classification by reading the same string the checker read. A parser would be
 * more general and much harder to trust.
 */
export function classifyExpr(expr) {
  if (expr === null || expr === undefined) return 'ABSENT';
  const e = String(expr).trim().toLowerCase();
  if (e === 'false') return 'DENY';
  if (e === 'true') return 'OPEN';

  const readsSetting = /current_setting\(\s*'app\.tenant_id'/.test(e);

  // Strip current_setting(...) calls before looking for the COLUMN. The
  // setting is literally named 'app.tenant_id', so a naive \btenant_id\b
  // matches inside it and a wildcard-only policy —
  //   (current_setting('app.tenant_id', true) = '*')
  // — reads as tenant-scoped when it constrains nothing at all. The self-test
  // below caught this; it is the exact shape of the platform-admin escape.
  const withoutSettings = e.replace(/current_setting\([^)]*\)/g, ' ');
  const readsColumn = /\btenant_id\b/.test(withoutSettings);

  // Both halves are required. current_setting('app.tenant_id') = '*' on its own
  // is the platform-admin escape and constrains nothing; a bare tenant_id
  // comparison against a literal constrains the wrong thing.
  if (readsSetting && readsColumn) return 'SCOPED';
  return 'OPEN';
}

/**
 * Effective expression for the WRITE side of a policy.
 *
 * Postgres uses WITH CHECK when present. When absent it falls back to USING —
 * but only for ALL and UPDATE. A FOR INSERT policy has no USING at all, so an
 * absent WITH CHECK means the policy contributes nothing.
 */
export function writeExpr(policy) {
  if (policy.check_expr !== null && policy.check_expr !== undefined) return policy.check_expr;
  if (policy.cmd === '*' || policy.cmd === 'w') return policy.using_expr;
  return null;
}

/**
 * Combine the applicable permissive policies for one command.
 *
 * OR semantics: the command is only constrained if EVERY applicable permissive
 * policy constrains it. A single OPEN policy opens the whole command, which is
 * the case a policy count cannot detect.
 */
export function verdictForCommand(command, policies) {
  const applicable = policies.filter(
    p => p.permissive && APPLIES[command].includes(p.cmd),
  );
  if (applicable.length === 0) return { verdict: 'NO_POLICY', detail: 'no permissive policy applies' };

  const parts = [];
  for (const p of applicable) {
    // Read side: which existing rows the command may touch.
    const readNeeded = command !== 'INSERT';
    const readClass = readNeeded ? classifyExpr(p.using_expr) : 'N/A';

    // Write side: what the resulting row may look like.
    const writeNeeded = command === 'INSERT' || command === 'UPDATE';
    const writeClass = writeNeeded ? classifyExpr(writeExpr(p)) : 'N/A';

    parts.push({ name: p.name, readClass, writeClass });
  }

  // A policy is fully denying if its read side is DENY — nothing reaches it.
  const nonDenying = parts.filter(p => p.readClass !== 'DENY');
  if (nonDenying.length === 0) {
    return { verdict: 'DENIED', detail: `${parts.map(p => p.name).join(', ')} deny via USING (false)` };
  }

  const open = nonDenying.filter(
    p =>
      (p.readClass !== 'N/A' && p.readClass === 'OPEN') ||
      (p.writeClass !== 'N/A' && (p.writeClass === 'OPEN' || p.writeClass === 'ABSENT')),
  );
  if (open.length > 0) {
    const why = open
      .map(p => {
        const bits = [];
        if (p.readClass === 'OPEN') bits.push('USING unconstrained');
        if (p.writeClass === 'OPEN') bits.push('write check unconstrained');
        if (p.writeClass === 'ABSENT') bits.push('no write check and no USING fallback');
        return `${p.name} (${bits.join('; ')})`;
      })
      .join(', ');
    return { verdict: 'OPEN', detail: why };
  }

  return { verdict: 'SCOPED', detail: nonDenying.map(p => p.name).join(', ') };
}

// ── Self-tests. The checker refuses to report on the database until it can
//    prove it classifies known shapes correctly. Every one of these is a shape
//    that actually appears in this schema, or one that nearly shipped.
function selfTest() {
  const T = (expr) => classifyExpr(expr);
  const cases = [
    // classifyExpr
    ['scoped policy', T(`((current_setting('app.tenant_id'::text, true) = '*'::text) OR (tenant_id = current_setting('app.tenant_id'::text, true)))`), 'SCOPED'],
    ['deny policy', T('false'), 'DENY'],
    ['open literal', T('true'), 'OPEN'],
    ['absent', T(null), 'ABSENT'],
    ['wildcard only, no column', T(`(current_setting('app.tenant_id'::text, true) = '*'::text)`), 'OPEN'],
    ['column but no setting', T(`(tenant_id = 'acme'::text)`), 'OPEN'],
    ['nullable variant', T(`((tenant_id IS NULL) OR (tenant_id = current_setting('app.tenant_id'::text, true)))`), 'SCOPED'],
  ];

  const scoped = `(tenant_id = current_setting('app.tenant_id'::text, true))`;
  const P = (o) => ({ permissive: true, using_expr: null, check_expr: null, ...o });

  // verdictForCommand
  const v = (cmd, pols) => verdictForCommand(cmd, pols).verdict;
  cases.push(
    ['ALL policy covers INSERT via USING fallback',
      v('INSERT', [P({ name: 'p', cmd: '*', using_expr: scoped })]), 'SCOPED'],
    ['INSERT-only policy with no WITH CHECK contributes nothing',
      v('INSERT', [P({ name: 'p', cmd: 'a', using_expr: null, check_expr: null })]), 'OPEN'],
    ['UPDATE policy falls back to USING for the new row',
      v('UPDATE', [P({ name: 'p', cmd: 'w', using_expr: scoped })]), 'SCOPED'],
    ['USING(false) on UPDATE is DENIED, not a missing check',
      v('UPDATE', [P({ name: 'audit_no_updates', cmd: 'w', using_expr: 'false' })]), 'DENIED'],
    ['one open permissive policy defeats a scoped one (OR semantics)',
      v('SELECT', [P({ name: 'ok', cmd: 'r', using_expr: scoped }), P({ name: 'bad', cmd: 'r', using_expr: 'true' })]), 'OPEN'],
    ['no applicable policy is NO_POLICY, not OPEN',
      v('DELETE', [P({ name: 'p', cmd: 'r', using_expr: scoped })]), 'NO_POLICY'],
    ['restrictive policy does not count as coverage',
      v('SELECT', [{ name: 'r', cmd: 'r', permissive: false, using_expr: scoped, check_expr: null }]), 'NO_POLICY'],
    ['scoped SELECT is SCOPED',
      v('SELECT', [P({ name: 'p', cmd: 'r', using_expr: scoped })]), 'SCOPED'],
  );

  const failed = cases.filter(([, got, want]) => got !== want);
  if (failed.length > 0) {
    console.error('SELF-TEST FAILED — refusing to report on the database:\n');
    failed.forEach(([name, got, want]) => console.error(`  ${name}\n     got ${got}, want ${want}`));
    process.exit(2);
  }
  return cases.length;
}

async function main() {
  const testCount = selfTest();

  const prisma = new PrismaClient();
  for (let i = 0; i < 6; i++) {
    try { await prisma.$queryRawUnsafe('SELECT 1'); break; } catch { await new Promise(r => setTimeout(r, 4000)); }
  }

  // Tenant-owned tables: public, ordinary tables carrying a tenant_id column.
  const tables = await prisma.$queryRawUnsafe(`
    SELECT c.oid::int AS oid, c.relname AS name,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname
                      AND col.column_name = 'tenant_id')
     ORDER BY c.relname`);

  const policies = await prisma.$queryRawUnsafe(`
    SELECT pol.polrelid::int AS oid, pol.polname AS name, pol.polcmd AS cmd,
           pol.polpermissive AS permissive,
           pg_get_expr(pol.polqual, pol.polrelid)      AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
           (pol.polroles = '{0}')                       AS applies_to_public,
           ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) AS roles
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'`);

  const byTable = new Map();
  for (const p of policies) {
    if (!byTable.has(p.oid)) byTable.set(p.oid, []);
    byTable.get(p.oid).push(p);
  }

  const report = [];
  for (const t of tables) {
    const all = byTable.get(t.oid) ?? [];

    // A policy that does not apply to the runtime role protects nothing at
    // runtime. PUBLIC (polroles = {0}) applies to everyone.
    const applicable = all.filter(p => p.applies_to_public || p.roles.includes(ROLE));
    const roleScoped = all.filter(p => !p.applies_to_public && !p.roles.includes(ROLE));

    if (!t.rls) {
      report.push({ table: t.name, forced: t.forced, worst: 'NO_RLS',
        commands: Object.fromEntries(COMMANDS.map(c => [c, { verdict: 'NO_RLS', detail: 'RLS not enabled' }])),
        roleScoped: roleScoped.map(p => p.name) });
      continue;
    }

    const commands = {};
    for (const c of COMMANDS) commands[c] = verdictForCommand(c, applicable);

    const verdicts = COMMANDS.map(c => commands[c].verdict);
    const worst = verdicts.includes('OPEN') ? 'OPEN'
      : verdicts.includes('NO_POLICY') ? 'NO_POLICY'
      : 'SCOPED';

    report.push({ table: t.name, forced: t.forced, worst, commands, roleScoped: roleScoped.map(p => p.name) });
  }

  await prisma.$disconnect();

  if (AS_JSON) {
    console.log(JSON.stringify({ role: ROLE, report }, null, 2));
    process.exit(report.some(r => r.worst === 'OPEN' || r.worst === 'NO_RLS') ? 1 : 0);
  }

  const leaks = report.filter(r => r.worst === 'OPEN' || r.worst === 'NO_RLS');
  const breaks = report.filter(r => r.worst === 'NO_POLICY');
  const ok = report.filter(r => r.worst === 'SCOPED');

  console.log(`\nEffective RLS coverage — ${report.length} tenant-owned tables, as role '${ROLE}'`);
  console.log(`${testCount} self-tests passed\n`);
  console.log('─'.repeat(70));
  console.log(`  SCOPED    ${String(ok.length).padStart(4)}   every command constrained to the tenant`);
  console.log(`  NO_POLICY ${String(breaks.length).padStart(4)}   default-deny; app breaks loudly after the role switch`);
  console.log(`  OPEN/NO_RLS ${String(leaks.length).padStart(2)}   SILENT LEAK — a command admits rows unconstrained`);
  console.log('─'.repeat(70));

  if (leaks.length > 0) {
    console.log('\n🔴 SILENT LEAKS — fix before switching the runtime role:\n');
    for (const r of leaks) {
      console.log(`  ${r.table}${r.forced ? '' : '  (not FORCEd)'}`);
      for (const c of COMMANDS) {
        const v = r.commands[c];
        if (v.verdict === 'OPEN' || v.verdict === 'NO_RLS') console.log(`     ${c.padEnd(6)} ${v.verdict}  ${v.detail}`);
      }
    }
  }

  if (breaks.length > 0) {
    const show = SHOW_ALL ? breaks : breaks.slice(0, 15);
    console.log(`\n🟡 DEFAULT-DENY commands — these will start erroring after the switch (${breaks.length}):\n`);
    for (const r of show) {
      const missing = COMMANDS.filter(c => r.commands[c].verdict === 'NO_POLICY');
      console.log(`  ${r.table.padEnd(44)} ${missing.join(', ')}`);
    }
    if (!SHOW_ALL && breaks.length > show.length) console.log(`  …and ${breaks.length - show.length} more (--all)`);
  }

  const roleIssues = report.filter(r => r.roleScoped.length > 0);
  if (roleIssues.length > 0) {
    console.log(`\n⚠️  Policies that do NOT apply to '${ROLE}' (they protect nothing at runtime):\n`);
    for (const r of roleIssues) console.log(`  ${r.table}: ${r.roleScoped.join(', ')}`);
  }

  console.log('');
  process.exit(leaks.length > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERROR:', e.message?.split('\n')[0] ?? e); process.exit(1); });
