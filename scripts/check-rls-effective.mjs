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
 * VERDICTS — only SCOPED and DENIED pass.
 *
 *   OPEN_NO_RLS               a command admits rows with no tenant predicate,
 *                             or RLS is not enabled on the table at all.
 *   UNKNOWN_EXPRESSION        the checker cannot prove what the expression
 *                             does. Never assumed safe.
 *   BROAD_POLICY              a branch of the expression does not constrain
 *                             the tenant, so the whole expression admits rows
 *                             the tenant predicate would not.
 *   MISSING_COMMAND_COVERAGE  no permissive policy applies, so Postgres denies
 *                             by default. Cannot leak, but nobody decided what
 *                             the command should do — an explicit DENY policy
 *                             makes that intent reviewable.
 *   DENIED                    policies evaluate false. Intentional.
 *   ROLE_RESTRICTED           a policy exists but does not apply to the runtime
 *                             role, so it protects nothing at runtime.
 *   SCOPED                    every applicable permissive policy constrains
 *                             the tenant.
 *
 * THE RULE THE CLASSIFIER ENFORCES: every successful path through the boolean
 * expression must require either an exact tenant match or the one approved
 * platform-admin escape. Not "the expression mentions tenant_id somewhere".
 *
 *   OR  widens to its loosest branch. tenant_match OR anything-unproven is
 *       BROAD, because rows satisfying that branch are admitted whatever the
 *       tenant is, and the branch cannot be shown unsatisfiable.
 *   AND narrows, so one tenant-matching conjunct constrains the whole.
 *   false branches admit no rows and therefore cannot widen anything.
 *
 * Supported shapes are added ONE AT A TIME with a self-test each. The checker
 * is deliberately not a SQL theorem prover: EXISTS, CASE, COALESCE and ANY()
 * are all UNKNOWN until someone models them explicitly. That is the correct
 * default — the earlier "contains both tokens" heuristic issued false
 * assurances, and this exists so it cannot happen again.
 *
 * Restrictive policies (polpermissive = false) combine with AND and can only
 * narrow access. They never provide coverage on their own and never rescue an
 * OPEN verdict, because a restrictive policy on one command says nothing about
 * another.
 *
 * Usage:
 *   node scripts/check-rls-effective.mjs [--role fleet360_app] [--all] [--json]
 *
 * Exit 0 clean, 1 on any FAILING category, 2 if the self-tests fail.
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

// Worst-first. The first category present on any command becomes the table's
// verdict.
const SEVERITY = [
  'OPEN_NO_RLS',              // a command admits rows with no tenant predicate
  'UNKNOWN_EXPRESSION',       // checker cannot parse it — never assumed safe
  'BROAD_POLICY',             // a branch of the expression does not constrain
  'MISSING_COMMAND_COVERAGE', // default-deny; loud breakage after the switch
  'DENIED',                   // deliberately denied, e.g. append-only tables
  'SCOPED',
];

// Categories that fail the run. Only SCOPED and DENIED pass.
//
// MISSING_COMMAND_COVERAGE fails even though it cannot leak — a command with
// no policy is default-deny, which is safe but means nobody decided what that
// command should do. Requiring an explicit DENY policy instead makes the
// intent reviewable, and it is currently zero, so the strictness costs nothing
// today and prevents the category reappearing unnoticed.
const FAILING = new Set([
  'OPEN_NO_RLS',
  'UNKNOWN_EXPRESSION',
  'BROAD_POLICY',
  'MISSING_COMMAND_COVERAGE',
  'ROLE_RESTRICTED',
]);

// ROLE_RESTRICTED allowlist: tables where a policy is deliberately scoped to
// roles other than the runtime role. Empty, and it should stay that way
// without a written reason — same rule as RULE_EXEMPTIONS in
// scripts/check-tenant-rls.js. Entries are { table, reason }.
const ROLE_RESTRICTED_ALLOWLIST = [];

// Which policy commands apply to which statement. '*' (ALL) applies to all four.
const APPLIES = {
  SELECT: ['r', '*'],
  INSERT: ['a', '*'],
  UPDATE: ['w', '*'],
  DELETE: ['d', '*'],
};

/**
 * Split an expression on a boolean operator at paren depth 0.
 *
 * pg_get_expr fully parenthesises its output, so the top level of a policy
 * expression is a clean OR-list or AND-list. Splitting on it lets each term be
 * judged on its own, which is what makes an OR escape visible.
 */
function splitTop(expr, op) {
  const out = [];
  let depth = 0, start = 0, inStr = false;
  const pad = ` ${op} `;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'") inStr = !inStr;
    if (inStr) continue;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && expr.startsWith(pad, i)) {
      out.push(expr.slice(start, i));
      i += pad.length - 1;
      start = i + 1;
    }
  }
  out.push(expr.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

function unwrap(s) {
  let e = s.trim();
  // Strip one layer of enclosing parens at a time, only when balanced.
  while (e.startsWith('(') && e.endsWith(')')) {
    let depth = 0, ok = true;
    for (let i = 0; i < e.length; i++) {
      if (e[i] === '(') depth++;
      else if (e[i] === ')') { depth--; if (depth === 0 && i < e.length - 1) { ok = false; break; } }
    }
    if (!ok) break;
    e = e.slice(1, -1).trim();
  }
  return e;
}

const SETTING = String.raw`current_setting\(\s*'app\.tenant_id'(::text)?\s*,\s*true\s*\)`;

/**
 * Classify ONE indivisible term.
 *
 * Everything not recognised is UNKNOWN — never assumed safe. A checker that
 * silently certifies an expression it cannot parse is worse than no checker,
 * because it converts an unreviewed policy into a green tick.
 */
export function classifyTerm(term) {
  const e = unwrap(String(term).trim().toLowerCase()).replace(/\s+/g, ' ');

  if (e === 'false') return 'DENY';
  if (e === 'true') return 'OPEN';

  // tenant_id = current_setting('app.tenant_id', true), either order.
  //
  // Both sides may carry a cast. Where tenant_id is uuid rather than text —
  // bookings, behavior_events, damage_claims and 15 others are uuid — the
  // policy compares (tenant_id)::text, and Postgres renders the cast with the
  // column parenthesised. An earlier version of this pattern accepted only
  // `tenant_id::text` and reported all 18 as UNKNOWN_EXPRESSION.
  // Both sides allow an optional wrapping paren before a cast — Postgres emits
  // (current_setting(...))::uuid and (tenant_id)::text in that shape.
  const COL = String.raw`\(?\s*tenant_id\s*\)?(::[a-z_]+)?`;
  const SET = `\\(?\\s*${SETTING}\\s*\\)?(::[a-z_]+)?`;
  const eq = new RegExp(`^${COL}\\s*=\\s*${SET}$|^${SET}\\s*=\\s*${COL}$`);
  if (eq.test(e)) return 'TENANT_MATCH';

  // current_setting('app.tenant_id', true) = '*'  — the platform-admin escape.
  // Expected and deliberate, but it constrains nothing on its own.
  const admin = new RegExp(`^${SETTING}\\s*=\\s*'\\*'(::text)?$|^'\\*'(::text)?\\s*=\\s*${SETTING}$`);
  if (admin.test(e)) return 'ADMIN_ESCAPE';

  // tenant_id IS NULL — rows with no tenant are visible to every tenant. This
  // is in the canonical policy in src/lib/rls.ts and is deliberate for shared
  // reference rows, but it IS a widening and is reported as such.
  if (/^tenant_id(::text)?\s+is\s+null$/.test(e)) return 'NULL_ESCAPE';

  return 'UNKNOWN';
}

/**
 * Classify a whole policy expression.
 *
 * OR terms widen: the expression is only as tight as its loosest branch.
 * AND terms narrow: one tenant-matching conjunct is enough.
 */
const TENANTY = new Set(['TENANT_MATCH', 'SCOPED', 'SCOPED_NULLABLE']);
const NULLY = new Set(['NULL_ESCAPE', 'SCOPED_NULLABLE']);

/**
 * Internal: returns TERM kinds as well as combined ones, so that OR-combination
 * can tell a deliberate escape from a hole.
 *
 * ADMIN_ESCAPE must survive as its own kind through this. It appears in every
 * canonical policy in the schema —
 *   (current_setting('app.tenant_id') = '*' OR tenant_id = current_setting(...))
 * — and collapsing it to BROAD at the term level made the OR-combination report
 * every correct policy as broad. It widens only into the platform-admin
 * context, which is what withPlatformAdmin deliberately enters. Alone, with no
 * tenant predicate beside it, it constrains nothing and IS broad.
 */
function analyze(expr) {
  const e = unwrap(String(expr).trim().toLowerCase());

  const orTerms = splitTop(e, 'or');
  if (orTerms.length > 1) {
    const kinds = orTerms.map(analyze);
    if (kinds.every(k => k === 'DENY')) return 'DENY';
    // A false branch contributes no rows, so it cannot widen the result.
    const live = kinds.filter(k => k !== 'DENY');
    if (live.includes('OPEN')) return 'OPEN';

    const hasTenant = live.some(k => TENANTY.has(k));
    const hasUnknown = live.includes('UNKNOWN');

    // An unrecognised branch sitting BESIDE a tenant predicate is not merely
    // unknown — it is a proven widening. The expression admits any row
    // satisfying that branch whether or not the tenant matches, and the
    // checker cannot prove the branch unsatisfiable. So it is BROAD, which is
    // the more specific and more actionable label.
    //
    // With no tenant predicate anywhere, nothing can be concluded at all, and
    // UNKNOWN is the honest answer.
    if (hasTenant && hasUnknown) return 'BROAD';
    if (hasUnknown) return 'UNKNOWN';

    if (live.includes('BROAD')) return 'BROAD';
    // Only escapes and no tenant predicate: nothing is constrained.
    if (!hasTenant) return 'BROAD';
    return live.some(k => NULLY.has(k)) ? 'SCOPED_NULLABLE' : 'SCOPED';
  }

  const andTerms = splitTop(e, 'and');
  if (andTerms.length > 1) {
    const kinds = andTerms.map(analyze);
    if (kinds.includes('DENY')) return 'DENY';
    // AND only narrows, so one tenant-matching conjunct constrains the whole.
    if (kinds.some(k => TENANTY.has(k))) return 'SCOPED';
    if (kinds.includes('UNKNOWN')) return 'UNKNOWN';
    return 'BROAD';
  }

  return classifyTerm(e);
}

export function classifyExpr(expr) {
  if (expr === null || expr === undefined) return 'ABSENT';
  const k = analyze(expr);
  // A lone escape constrains nothing.
  if (k === 'ADMIN_ESCAPE' || k === 'NULL_ESCAPE') return 'BROAD';
  if (k === 'TENANT_MATCH') return 'SCOPED';
  return k;
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
  if (applicable.length === 0) {
    return { verdict: 'MISSING_COMMAND_COVERAGE', detail: 'no permissive policy applies' };
  }

  const parts = [];
  for (const p of applicable) {
    // Read side: which existing rows the command may touch.
    const readClass = command === 'INSERT' ? 'N/A' : classifyExpr(p.using_expr);
    // Write side: what the resulting row may look like.
    const writeClass = (command === 'INSERT' || command === 'UPDATE')
      ? classifyExpr(writeExpr(p)) : 'N/A';
    parts.push({ name: p.name, readClass, writeClass });
  }

  // A policy whose read side is DENY admits nothing, so its write side is
  // unreachable and irrelevant. audit_logs relies on exactly this.
  const nonDenying = parts.filter(p => p.readClass !== 'DENY');
  if (nonDenying.length === 0) {
    return { verdict: 'DENIED', detail: `${parts.map(p => p.name).join(', ')} deny via USING (false)` };
  }

  const sides = (p) => [
    ['USING', p.readClass],
    ['write check', p.writeClass],
  ].filter(([, k]) => k !== 'N/A');

  // Fail closed FIRST. An expression the checker cannot parse must never be
  // certified, and must outrank the softer categories below it.
  const unknown = nonDenying.filter(p => sides(p).some(([, k]) => k === 'UNKNOWN'));
  if (unknown.length > 0) {
    return {
      verdict: 'UNKNOWN_EXPRESSION',
      detail: unknown.map(p =>
        `${p.name} (${sides(p).filter(([, k]) => k === 'UNKNOWN').map(([s]) => s).join(', ')} not recognised)`).join(', '),
    };
  }

  // ABSENT on the write side means a FOR INSERT policy with no WITH CHECK and
  // no USING to fall back on — it constrains nothing at all.
  const open = nonDenying.filter(p => sides(p).some(([, k]) => k === 'OPEN' || k === 'ABSENT'));
  if (open.length > 0) {
    return {
      verdict: 'OPEN_NO_RLS',
      detail: open.map(p => {
        const bits = sides(p)
          .filter(([, k]) => k === 'OPEN' || k === 'ABSENT')
          .map(([s, k]) => k === 'ABSENT' ? `${s} absent with no USING fallback` : `${s} unconstrained`);
        return `${p.name} (${bits.join('; ')})`;
      }).join(', '),
    };
  }

  const broad = nonDenying.filter(p => sides(p).some(([, k]) => k === 'BROAD'));
  if (broad.length > 0) {
    return {
      verdict: 'BROAD_POLICY',
      detail: broad.map(p =>
        `${p.name} (${sides(p).filter(([, k]) => k === 'BROAD').map(([s]) => s).join(', ')} has a branch that does not constrain the tenant)`).join(', '),
    };
  }

  const nullable = nonDenying.filter(p => sides(p).some(([, k]) => k === 'SCOPED_NULLABLE'));
  return {
    verdict: 'SCOPED',
    detail: nonDenying.map(p => p.name).join(', ')
      + (nullable.length ? '  [tenant_id IS NULL rows visible to all tenants]' : ''),
  };
}

// ── Self-tests. The checker refuses to report on the database until it can
//    prove it classifies known shapes correctly. Every one of these is a shape
//    that actually appears in this schema, or one that nearly shipped.
function selfTest() {
  const T = (expr) => classifyExpr(expr);
  const canon = `((current_setting('app.tenant_id'::text, true) = '*'::text) OR (tenant_id = current_setting('app.tenant_id'::text, true)))`;
  const cases = [
    // ── classifyExpr
    ['canonical policy', T(canon), 'SCOPED'],
    ['deny', T('false'), 'DENY'],
    ['open literal', T('true'), 'OPEN'],
    ['absent', T(null), 'ABSENT'],
    ['bare equality', T(`(tenant_id = current_setting('app.tenant_id'::text, true))`), 'SCOPED'],
    ['reversed equality', T(`(current_setting('app.tenant_id'::text, true) = tenant_id)`), 'SCOPED'],

    // uuid tenant_id columns: Postgres renders the cast with the column
    // parenthesised. 18 tables in this schema use this form.
    ['uuid column cast, canonical',
      T(`((tenant_id IS NULL) OR (current_setting('app.tenant_id'::text, true) = '*'::text) OR ((tenant_id)::text = current_setting('app.tenant_id'::text, true)))`), 'SCOPED_NULLABLE'],
    ['uuid column cast, bare', T(`((tenant_id)::text = current_setting('app.tenant_id'::text, true))`), 'SCOPED'],
    ['cast on the setting side', T(`(tenant_id = (current_setting('app.tenant_id'::text, true))::uuid)`), 'SCOPED'],

    // The wildcard escape alone constrains nothing. A \btenant_id\b test
    // matches inside the SETTING NAME, which is how the first version of this
    // checker certified it as scoped.
    ['wildcard escape alone is BROAD', T(`(current_setting('app.tenant_id'::text, true) = '*'::text)`), 'BROAD'],

    // The cases that motivated the rewrite: a real tenant predicate with an OR
    // escape welded on. "Mentions both tokens" called all of these SCOPED.
    //
    // An unrecognised branch yields UNKNOWN rather than BROAD — the checker
    // genuinely does not know what is_public means, and saying so is more
    // honest than guessing. Both fail the run.
    // A tenant predicate beside an unrecognised branch is a PROVEN widening:
    // rows satisfying that branch are admitted regardless of tenant. BROAD is
    // more specific than UNKNOWN and more actionable.
    ['tenant match OR unrecognised predicate is BROAD',
      T(`((tenant_id = current_setting('app.tenant_id'::text, true)) OR (is_public = true))`), 'BROAD'],
    ['unrecognised with NO tenant predicate stays UNKNOWN',
      T(`((is_public = true) OR (legacy_flag = 1))`), 'UNKNOWN'],

    // ── Negative tests: near-misses that must NOT be accepted as the approved
    //    platform-admin escape. Each of these differs from the canonical form
    //    by one token.
    ['wildcard against the wrong value is not the approved escape',
      T(`(current_setting('app.tenant_id'::text, true) = 'admin'::text)`), 'UNKNOWN'],
    ['wildcard on the wrong setting name is not the approved escape',
      T(`(current_setting('app.user_id'::text, true) = '*'::text)`), 'UNKNOWN'],
    ['near-miss escape beside a tenant match is BROAD, not SCOPED',
      T(`((current_setting('app.tenant_id'::text, true) = 'admin'::text) OR (tenant_id = current_setting('app.tenant_id'::text, true)))`), 'BROAD'],
    ['a different column matched against the setting is not tenant scoping',
      T(`(org_id = current_setting('app.tenant_id'::text, true))`), 'UNKNOWN'],
    ['missing the missing_ok argument is not the approved form',
      T(`(tenant_id = current_setting('app.tenant_id'::text))`), 'UNKNOWN'],

    // ── Constructs deliberately not modelled. Each must stay UNKNOWN until
    //    someone adds an explicit pattern and a self-test for it.
    ['EXISTS subquery is UNKNOWN', T(`(EXISTS (SELECT 1 FROM tenants t WHERE t.id = tenant_id))`), 'UNKNOWN'],
    ['CASE is UNKNOWN', T(`(CASE WHEN is_admin THEN true ELSE tenant_id = current_setting('app.tenant_id'::text, true) END)`), 'UNKNOWN'],
    ['COALESCE is UNKNOWN', T(`(COALESCE(tenant_id, 'x'::text) = current_setting('app.tenant_id'::text, true))`), 'UNKNOWN'],
    ['IN-list is UNKNOWN', T(`(tenant_id = ANY (ARRAY[current_setting('app.tenant_id'::text, true)]))`), 'UNKNOWN'],
    // X OR true is unconditionally true, so OPEN rather than merely BROAD.
    ['tenant match OR true is OPEN',
      T(`((tenant_id = current_setting('app.tenant_id'::text, true)) OR true)`), 'OPEN'],
    // A second escape with no tenant predicate anywhere.
    ['two escapes and no tenant predicate is BROAD',
      T(`((current_setting('app.tenant_id'::text, true) = '*'::text) OR (tenant_id IS NULL))`), 'BROAD'],
    // A DENY branch contributes no rows and must not widen the result.
    ['false OR tenant match stays SCOPED',
      T(`(false OR (tenant_id = current_setting('app.tenant_id'::text, true)))`), 'SCOPED'],

    ['nullable canonical is SCOPED_NULLABLE',
      T(`((tenant_id IS NULL) OR (current_setting('app.tenant_id'::text, true) = '*'::text) OR (tenant_id = current_setting('app.tenant_id'::text, true)))`), 'SCOPED_NULLABLE'],

    // AND narrows, so an extra conjunct keeps it scoped.
    ['tenant match AND soft-delete filter stays SCOPED',
      T(`((tenant_id = current_setting('app.tenant_id'::text, true)) AND (deleted_at IS NULL))`), 'SCOPED'],

    // Fail closed.
    ['unrecognised expression is UNKNOWN', T(`(owner_org = some_function(user_id))`), 'UNKNOWN'],
    // Function call in an OR branch: still a proven widening beside a tenant
    // predicate, so BROAD rather than UNKNOWN. Never SCOPED.
    ['function call OR scoped is BROAD, never SCOPED',
      T(`((tenant_id = current_setting('app.tenant_id'::text, true)) OR (weird_col = frobnicate()))`), 'BROAD'],
    ['column compared to a literal is not tenant scoping',
      T(`(tenant_id = 'acme'::text)`), 'UNKNOWN'],
  ];

  const scoped = `(tenant_id = current_setting('app.tenant_id'::text, true))`;
  const P = (o) => ({ permissive: true, using_expr: null, check_expr: null, ...o });
  const v = (cmd, pols) => verdictForCommand(cmd, pols).verdict;

  cases.push(
    // ── Postgres semantics
    ['ALL policy covers INSERT via USING fallback',
      v('INSERT', [P({ name: 'p', cmd: '*', using_expr: scoped })]), 'SCOPED'],
    ['UPDATE policy falls back to USING for the new row',
      v('UPDATE', [P({ name: 'p', cmd: 'w', using_expr: scoped })]), 'SCOPED'],
    ['INSERT-only policy with no WITH CHECK has no USING to fall back on',
      v('INSERT', [P({ name: 'p', cmd: 'a' })]), 'OPEN_NO_RLS'],
    ['USING(false) on UPDATE is DENIED, not a missing write check',
      v('UPDATE', [P({ name: 'audit_no_updates', cmd: 'w', using_expr: 'false' })]), 'DENIED'],

    // ── OR semantics across policies
    ['one open policy defeats a scoped one',
      v('SELECT', [P({ name: 'ok', cmd: 'r', using_expr: scoped }), P({ name: 'bad', cmd: 'r', using_expr: 'true' })]), 'OPEN_NO_RLS'],
    ['one broad policy defeats a scoped one',
      v('SELECT', [P({ name: 'ok', cmd: 'r', using_expr: scoped }),
                   P({ name: 'wide', cmd: 'r', using_expr: `(current_setting('app.tenant_id'::text, true) = '*'::text)` })]), 'BROAD_POLICY'],

    // ── Coverage and precedence
    ['no applicable policy is MISSING_COMMAND_COVERAGE',
      v('DELETE', [P({ name: 'p', cmd: 'r', using_expr: scoped })]), 'MISSING_COMMAND_COVERAGE'],
    ['restrictive policy does not provide coverage',
      v('SELECT', [{ name: 'r', cmd: 'r', permissive: false, using_expr: scoped, check_expr: null }]), 'MISSING_COMMAND_COVERAGE'],
    ['UNKNOWN outranks BROAD',
      v('SELECT', [P({ name: 'u', cmd: 'r', using_expr: `(x = f())` }),
                   P({ name: 'b', cmd: 'r', using_expr: `(current_setting('app.tenant_id'::text, true) = '*'::text)` })]), 'UNKNOWN_EXPRESSION'],
    ['scoped SELECT is SCOPED',
      v('SELECT', [P({ name: 'p', cmd: 'r', using_expr: scoped })]), 'SCOPED'],
    ['audit_logs shape: append-only and tenant scoped',
      v('INSERT', [P({ name: 'audit_insert_only', cmd: 'a', check_expr: canon })]), 'SCOPED'],
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

  // Scan EVERY schema on search_path, not just public.
  //
  // This checker previously hardcoded 'public' and would have reported
  // OPEN_NO_RLS = 0 while four tenant-owned tables in the `finance` schema had
  // RLS switched off entirely. An unqualified table name resolves against the
  // whole search_path, so a checker that inspects one schema is not inspecting
  // what the application actually reaches.
  const spRaw = (await prisma.$queryRawUnsafe(`SHOW search_path`))[0].search_path;
  const me = (await prisma.$queryRawUnsafe(`SELECT current_user AS u`))[0].u;
  const wanted = spRaw.split(',')
    .map(x => x.trim().replace(/^"|"$/g, ''))
    .map(x => (x === '$user' ? me : x));
  const existing = await prisma.$queryRawUnsafe(
    `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])`, wanted);
  const SCHEMAS = wanted.filter(x => existing.some(e => e.nspname === x));
  console.log(`
search_path: ${spRaw}`);
  console.log(`scanning schemas: ${SCHEMAS.join(', ')}`);

  // Tenant-owned tables: public, ordinary tables carrying a tenant_id column.
  const tables = await prisma.$queryRawUnsafe(`
    SELECT c.oid::int AS oid, n.nspname AS schema, c.relname AS name,
           c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
           (SELECT col.is_nullable FROM information_schema.columns col
             WHERE col.table_schema = n.nspname AND col.table_name = c.relname
               AND col.column_name = 'tenant_id') AS tenant_nullable
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1::text[]) AND c.relkind = 'r'
       AND EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = n.nspname AND col.table_name = c.relname
                      AND col.column_name = 'tenant_id')
     ORDER BY n.nspname, c.relname`, SCHEMAS);

  const policies = await prisma.$queryRawUnsafe(`
    SELECT pol.polrelid::int AS oid, pol.polname AS name, pol.polcmd AS cmd,
           pol.polpermissive AS permissive,
           pg_get_expr(pol.polqual, pol.polrelid)      AS using_expr,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expr,
           (pol.polroles = '{0}')                       AS applies_to_public,
           ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(pol.polroles)) AS roles
      FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = ANY($1::text[])`, SCHEMAS);

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
      report.push({ table: t.schema === 'public' ? t.name : `${t.schema}.${t.name}`, forced: t.forced, nullable: t.tenant_nullable === 'YES', worst: 'OPEN_NO_RLS',
        commands: Object.fromEntries(COMMANDS.map(c => [c, { verdict: 'OPEN_NO_RLS', detail: 'RLS not enabled on the table' }])),
        roleScoped: roleScoped.map(p => p.name) });
      continue;
    }

    const commands = {};
    for (const c of COMMANDS) commands[c] = verdictForCommand(c, applicable);

    // Which SIDE carries the NULL escape. USING governs what a session can
    // READ; WITH CHECK governs what it may WRITE. auth_login_attempts
    // deliberately has it on the write side only — unattributable events stay
    // recordable but are not readable by tenants — and reporting that as
    // "visible to every tenant" would be wrong.
    const escUsing = applicable.some(pl => classifyExpr(pl.using_expr) === 'SCOPED_NULLABLE');
    const escCheck = applicable.some(pl => classifyExpr(writeExpr(pl)) === 'SCOPED_NULLABLE');

    const verdicts = COMMANDS.map(c => commands[c].verdict);
    // Severity order. ROLE_RESTRICTED sits above SCOPED because a policy that
    // does not apply to the runtime role is not protection, and below the
    // categories that describe an actual hole.
    const allowlisted = ROLE_RESTRICTED_ALLOWLIST.some(a => a.table === t.name);
    const worst = SEVERITY.find(s => verdicts.includes(s))
      ?? (roleScoped.length > 0 && !allowlisted ? 'ROLE_RESTRICTED' : 'SCOPED');

    report.push({ table: t.schema === 'public' ? t.name : `${t.schema}.${t.name}`, forced: t.forced, nullable: t.tenant_nullable === 'YES', escUsing, escCheck, worst, commands, roleScoped: roleScoped.map(p => p.name) });
  }

  await prisma.$disconnect();

  if (AS_JSON) {
    const failed = report.filter(r => FAILING.has(r.worst));
    console.log(JSON.stringify({ role: ROLE, selfTests: testCount, report, failing: failed.length }, null, 2));
    process.exit(failed.length > 0 ? 1 : 0);
  }

  const byCat = {};
  for (const r of report) (byCat[r.worst] ??= []).push(r);
  const failed = report.filter(r => FAILING.has(r.worst));

  console.log(`
Effective RLS coverage — ${report.length} tenant-owned tables, as role '${ROLE}'`);
  console.log(`${testCount} self-tests passed
`);
  console.log('─'.repeat(72));
  const LEGEND = {
    SCOPED:                   'every command constrained to the tenant',
    DENIED:                   'command deliberately denied (append-only tables)',
    MISSING_COMMAND_COVERAGE: 'default-deny — breaks LOUDLY after the role switch',
    ROLE_RESTRICTED:          `policy does not apply to '${ROLE}' — protects nothing at runtime`,
    BROAD_POLICY:             'a branch of the expression does not constrain the tenant',
    UNKNOWN_EXPRESSION:       'expression not recognised — failing closed',
    OPEN_NO_RLS:              'SILENT LEAK — rows admitted with no tenant predicate',
  };
  for (const cat of [...SEVERITY, 'ROLE_RESTRICTED']) {
    const n = (byCat[cat] ?? []).length;
    if (n === 0 && !FAILING.has(cat)) continue;
    const mark = FAILING.has(cat) ? (n > 0 ? '🔴' : '  ') : '  ';
    console.log(`  ${mark} ${cat.padEnd(26)} ${String(n).padStart(4)}   ${LEGEND[cat]}`);
  }
  console.log('─'.repeat(72));

  for (const cat of SEVERITY.concat('ROLE_RESTRICTED')) {
    if (!FAILING.has(cat) || !(byCat[cat] ?? []).length) continue;
    console.log(`
🔴 ${cat} — must be fixed before switching the runtime role:
`);
    for (const r of byCat[cat]) {
      console.log(`  ${r.table}${r.forced ? '' : '  (not FORCEd)'}`);
      if (cat === 'ROLE_RESTRICTED') {
        console.log(`     policies not applying to '${ROLE}': ${r.roleScoped.join(', ')}`);
        continue;
      }
      for (const c of COMMANDS) {
        const v = r.commands[c];
        if (v.verdict === cat) console.log(`     ${c.padEnd(6)} ${v.detail}`);
      }
    }
  }

  // Distinguish a LIVE escape from a dead one. A `tenant_id IS NULL` branch on
  // a NOT NULL column cannot match anything, so counting both together
  // overstates the exposure — and this output is the pre-activation gate, so
  // overstating it is as unhelpful as understating it.
  const hasEscape = report.filter(r => r.escUsing || r.escCheck);
  const live = hasEscape.filter(r => r.nullable);
  const readable = live.filter(r => r.escUsing);
  const writeOnly = live.filter(r => !r.escUsing && r.escCheck);
  if (hasEscape.length > 0) {
    console.log(`
   tenant_id IS NULL escape present on ${hasEscape.length} table(s):`);
    console.log(`      ${hasEscape.length - live.length} unreachable (tenant_id is NOT NULL) - no exposure`);
    if (readable.length > 0) {
      console.log(`      ⚠️  ${readable.length} READABLE by every tenant (escape is in USING):`);
      console.log(`             ${readable.map(r => r.table).join(', ')}`);
    } else {
      console.log(`      0 readable by every tenant`);
    }
    if (writeOnly.length > 0) {
      console.log(`      ${writeOnly.length} write-side only (USING is scoped; WITH CHECK permits a NULL tenant`);
      console.log(`             so the row can be recorded but only platform context can read it):`);
      console.log(`             ${writeOnly.map(r => r.table).join(', ')}`);
    }
  }

  if (failed.length === 0) {
    console.log('');
    console.log('✅ No silent-leak, broad, unparsed, or role-inapplicable policies.');
    console.log('   Catalog inspection only — this is NOT behavioural proof of isolation.');
    console.log('');
  } else {
    console.log('');
    console.log(`${failed.length} table(s) must be fixed before the role switch.`);
    console.log('');
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(e => { console.error('ERROR:', e.message?.split('\n')[0] ?? e); process.exit(1); });
