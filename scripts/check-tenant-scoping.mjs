/**
 * Detects Prisma queries that carry no explicit tenant predicate.
 *
 * WHY THIS EXISTS
 *
 * Handlers wrap their work in withTenantRls, which sets app.tenant_id, and the
 * RLS policies on tenant tables are correct. None of that filters anything:
 * the database role holds BYPASSRLS, so policies are evaluated against a role
 * that is exempt from them. Until the app connects as a NOBYPASSRLS role (see
 * docs/RLS_ENFORCEMENT_ROLE_PLAN.md), a query's own WHERE clause is the only
 * boundary between tenants.
 *
 * This is not hypothetical. GET /api/bus-ops/routes/optimisation-preview
 * scanned bus_routes with no tenantId and returned 45 routes across 32 tenants
 * to a tenant that owns 14 — another organisation's route names and codes were
 * rendered on screen. It was found by a user noticing a route that wasn't
 * theirs, not by any check.
 *
 * AST, NOT GREP
 *
 * Uses the TypeScript compiler's parser. A regex cannot tell `where: { id }`
 * from `where: { id, tenantId }` across line breaks, nested AND/OR, or spreads,
 * and false confidence from a scanner is worse than no scanner.
 *
 * SELF-TEST
 *
 * Runs fixtures through the same analyser before scanning anything real and
 * exits 2 if it misclassifies them. A detector that has quietly stopped
 * matching reports a clean codebase, which is indistinguishable from success.
 */

import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** Reads that return rows, and writes that can hit rows across tenants. */
const SCOPED_METHODS = new Set([
  'findMany', 'findFirst', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy',
  'updateMany', 'deleteMany',
]);

/**
 * findUnique/delete/update take a unique selector. They cannot return the
 * wrong tenant's row *set*, but they will happily return or mutate a single
 * row belonging to another tenant if the id is known. Reported separately —
 * lower severity, still worth a filter.
 */
const BY_ID_METHODS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);

/** Models with no tenant column — a missing tenantId on these is correct. */
const GLOBAL_MODELS = new Set([
  'tenant', 'role', 'permission', 'user', 'systemSetting', 'auditLog',
  'country', 'currency', 'timezone',
]);

function textOf(node, src) {
  return src.text.slice(node.getStart(src), node.getEnd());
}

/** Does this node mention tenantId anywhere inside it? */
function mentionsTenantId(node, src) {
  return /\btenantId\b/.test(textOf(node, src));
}

/**
 * Collects every `const x = {...}` / `let x = {...}` in the file whose
 * initialiser or later mutations mention tenantId.
 *
 * Handlers commonly build a filter incrementally:
 *
 *     const where: any = { deletedAt: null, tenantId };
 *     if (status) where.status = status;
 *     return prisma.tripSchedule.findMany({ where, ... });
 *
 * The call site then passes `where` by reference. Judging that call on the
 * literal alone reports a properly-scoped query as a leak — which is how the
 * first run of this script produced a false positive on
 * bus-ops/schedules/route.ts. Resolving the identifier removes the whole
 * class.
 *
 * Deliberately file-scoped rather than block-scoped: shadowed names are rare
 * here, and the failure mode of over-resolving is a missed finding rather than
 * a false alarm — the wrong way round for a security scanner, but preferable
 * to a report nobody trusts. Shadowing would need real scope analysis.
 */
function tenantScopedIdentifiers(src) {
  const names = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (mentionsTenantId(node.initializer, src)) names.add(node.name.text);
    }
    // `where.tenantId = tenantId` / `where['tenantId'] = ...`
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === 'tenantId' &&
      ts.isIdentifier(node.left.expression)
    ) {
      names.add(node.left.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return names;
}

/**
 * True when the query argument is tenant-scoped, either inline or via an
 * identifier that was built with tenantId.
 */
function argIsScoped(arg, src, scopedNames) {
  if (!arg) return false;
  if (mentionsTenantId(arg, src)) return true;
  if (!ts.isObjectLiteralExpression(arg)) return false;
  for (const prop of arg.properties) {
    // `{ where }` shorthand
    if (ts.isShorthandPropertyAssignment(prop) && scopedNames.has(prop.name.text)) return true;
    // `{ where: someVar }`
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.initializer)
        && scopedNames.has(prop.initializer.text)) return true;
    // `{ where: { ...someVar } }`
    if (ts.isPropertyAssignment(prop) && ts.isObjectLiteralExpression(prop.initializer)) {
      for (const inner of prop.initializer.properties) {
        if (ts.isSpreadAssignment(inner) && ts.isIdentifier(inner.expression)
            && scopedNames.has(inner.expression.text)) return true;
      }
    }
  }
  return false;
}

/**
 * Analyse one source file. Returns findings; does not read the filesystem so
 * the self-test can drive it with a string.
 */
function analyse(fileName, code) {
  const src = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const findings = [];
  const scopedNames = tenantScopedIdentifiers(src);

  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const target = node.expression.expression; // e.g. tx.busRoute
      const isScoped = SCOPED_METHODS.has(method);
      const isById = BY_ID_METHODS.has(method);

      if ((isScoped || isById) && ts.isPropertyAccessExpression(target)) {
        const model = target.name.text;
        const client = ts.isIdentifier(target.expression) ? target.expression.text : '';
        // Only Prisma-shaped calls: <client>.<model>.<method>(...)
        if (/^(tx|prisma|db|client)$/.test(client) && !GLOBAL_MODELS.has(model)) {
          const arg = node.arguments[0];
          if (!argIsScoped(arg, src, scopedNames)) {
            const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
            findings.push({
              file: fileName, line: line + 1,
              call: `${client}.${model}.${method}`,
              severity: isScoped ? 'HIGH' : 'LOW',
            });
          }
        }
      }
    }

    // Raw SQL against a tenant table with no tenant_id predicate.
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression.name.text;
      if (m === '$queryRawUnsafe' || m === '$executeRawUnsafe' || m === '$queryRaw' || m === '$executeRaw') {
        const arg = node.arguments[0];
        if (arg) {
          const sql = textOf(arg, src);
          const touchesTable = /\b(FROM|JOIN|INTO|UPDATE)\s+[a-z_]+/i.test(sql);
          if (touchesTable && !/tenant_id/i.test(sql)) {
            const { line } = src.getLineAndCharacterOfPosition(node.getStart(src));
            findings.push({ file: fileName, line: line + 1, call: m, severity: 'RAW' });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return findings;
}

// ── Self-test ───────────────────────────────────────────────────────────────

const FIXTURE_BAD = `
  const a = await tx.busRoute.findMany({ where: { deletedAt: null, isActive: true } });
`;
const FIXTURE_GOOD = `
  const b = await tx.busRoute.findMany({ where: { tenantId, deletedAt: null } });
`;
const FIXTURE_GOOD_NESTED = `
  const c = await tx.busRoute.findMany({
    where: { AND: [{ tenantId }, { deletedAt: null }] },
  });
`;
const FIXTURE_RAW_BAD = `
  await tx.$queryRawUnsafe(\`SELECT id FROM bus_routes WHERE is_active = true\`);
`;
const FIXTURE_RAW_GOOD = `
  await tx.$queryRawUnsafe(\`SELECT id FROM bus_routes WHERE tenant_id = $1\`, tenantId);
`;
/**
 * The false-positive class the first run of this script produced on
 * bus-ops/schedules/route.ts: a filter built as a variable and passed by
 * reference. Scoped, and must not be reported.
 */
const FIXTURE_VAR_WHERE_GOOD = `
  const where: any = { deletedAt: null, tenantId };
  if (status) where.status = status;
  const d = await prisma.tripSchedule.findMany({ where, orderBy: { id: 'asc' } });
`;
/** Same shape, genuinely unscoped — must still be reported. */
const FIXTURE_VAR_WHERE_BAD = `
  const where: any = { deletedAt: null };
  if (status) where.status = status;
  const e = await prisma.tripSchedule.findMany({ where, orderBy: { id: 'asc' } });
`;
/** Scoped by later assignment rather than in the initialiser. */
const FIXTURE_VAR_ASSIGNED_GOOD = `
  const where: any = { deletedAt: null };
  where.tenantId = tenantId;
  const f = await prisma.tripSchedule.findMany({ where });
`;

function selfTest() {
  const cases = [
    ['BAD flagged',        FIXTURE_BAD,        1],
    ['GOOD clean',         FIXTURE_GOOD,       0],
    ['GOOD nested clean',  FIXTURE_GOOD_NESTED, 0],
    ['RAW bad flagged',    FIXTURE_RAW_BAD,    1],
    ['RAW good clean',     FIXTURE_RAW_GOOD,   0],
    ['var where scoped',   FIXTURE_VAR_WHERE_GOOD,    0],
    ['var where unscoped', FIXTURE_VAR_WHERE_BAD,     1],
    ['var assigned scoped',FIXTURE_VAR_ASSIGNED_GOOD, 0],
  ];
  let ok = true;
  for (const [name, code, expected] of cases) {
    const got = analyse('fixture.ts', code).length;
    if (got !== expected) {
      console.error(`  SELF-TEST FAIL: ${name} — expected ${expected} finding(s), got ${got}`);
      ok = false;
    }
  }
  return ok;
}

// ── Scan ────────────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name === 'route.ts') out.push(p);
  }
  return out;
}

const ROOT = process.argv[2] ?? 'src/app/api/bus-ops';

if (!selfTest()) {
  console.error('\nSelf-test failed — the analyser is not classifying known cases correctly.');
  console.error('Refusing to report on real files, since a broken detector reports a clean codebase.');
  process.exit(2);
}
console.log('self-test: all fixtures classified correctly\n');

const files = walk(ROOT);
const all = [];
for (const f of files) {
  all.push(...analyse(f.replace(/\\/g, '/'), fs.readFileSync(f, 'utf8')));
}

const bySeverity = { HIGH: [], LOW: [], RAW: [] };
for (const f of all) bySeverity[f.severity].push(f);

const label = {
  HIGH: 'Multi-row queries with no tenantId — these return or mutate across tenants',
  LOW:  'By-id queries with no tenantId — wrong tenant reachable if an id is known',
  RAW:  'Raw SQL touching a table with no tenant_id predicate',
};

console.log(`Scanned ${files.length} route files under ${ROOT}\n`);
for (const sev of ['HIGH', 'RAW', 'LOW']) {
  const rows = bySeverity[sev];
  console.log(`${sev} — ${label[sev]}: ${rows.length}`);
  for (const r of rows.slice(0, 40)) console.log(`   ${r.file}:${r.line}  ${r.call}`);
  if (rows.length > 40) console.log(`   …and ${rows.length - 40} more`);
  console.log('');
}

process.exit(bySeverity.HIGH.length > 0 ? 1 : 0);
