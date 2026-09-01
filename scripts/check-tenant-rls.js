#!/usr/bin/env node
/**
 * Tenant RLS Pipeline Checker
 *
 * Validates that API routes follow the mandatory tenant access pipeline:
 *   Request → requireAuthorizedTenant() → withTenantRls() → tenant-scoped query
 *
 * Checks:
 *   1. Request authorization with requireAuthorizedTenant()
 *   2. Database operations wrapped in RLS helpers (withTenantRls, withPlatformAdmin, etc.)
 *   3. Defense-in-depth tenant filters in queries
 *   4. Body sanitization in POST/PUT/PATCH handlers
 *
 * Usage:
 *   node scripts/check-tenant-rls.js [--staged] [--fix] [--strict]
 *
 * Flags:
 *   --staged: Only check staged files (for pre-commit hook)
 *   --fix: Show fix suggestions for violations
 *   --strict: Enforce defense-in-depth filters (fail if missing)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Routes that are exempt from tenant pipeline requirements
const EXEMPT_PATTERNS = [
  /^src\/app\/api\/public\//,
  /^src\/app\/api\/webhooks\//,
  /^src\/app\/api\/auth\//,
  /^src\/app\/api\/health/,
  /^src\/app\/api\/cron\//,
  /^src\/app\/api\/setup\//,  // Platform setup routes (cross-tenant)
  /^src\/app\/api\/track\//,  // Public tracking (no auth required)
];

// Narrow, per-rule exemptions.
//
// EXEMPT_PATTERNS above turns off EVERY rule for a whole directory, which is
// far too blunt when one specific rule is inapplicable to one specific
// handler. These entries switch off exactly one rule for exactly one file and
// method, so the remaining rules keep protecting the route.
//
// Deliberately kept here rather than as an in-file comment marker: adding an
// exemption should be a visible edit to the security tooling that gets
// reviewed on its own, not a line someone can drop into a route while fixing
// something else.
//
// `reason` is mandatory and printed in the summary. If an entry stops matching
// a real violation it is reported as stale and fails the run — an exemption
// that has quietly stopped applying is an exemption nobody is reviewing.
const RULE_EXEMPTIONS = [
  {
    file: 'src/app/api/admin/session/route.ts',
    method: 'GET',
    type: 'missing_auth',
    reason:
      'Session bootstrap. It cannot call requireAuthorizedTenant() for the tenant ' +
      'context it is in the middle of establishing. It verifies the xl-session cookie ' +
      'itself, requires a userId and tenantId, and returns 403 when the requested ids ' +
      'do not match the cookie; the UserTenant lookup then uses withPlatformAdmin ' +
      'because that read legitimately crosses the tenant boundary.',
  },
  {
    file: 'src/app/api/push/run-scheduler/route.ts',
    method: 'POST',
    type: 'missing_auth',
    reason:
      'Cron endpoint. Callers authenticate with PUSH_CRON_SECRET and have no session, ' +
      'so requireAuthorizedTenant() has nothing to read; it fails closed with 503 in ' +
      'production when the secret is unset. The handler performs no database access of ' +
      'its own — runTripReminders() does all of it under withSystemJob + withTenantRls.',
  },
  {
    file: 'src/app/api/telematics/webhook/route.ts',
    method: 'POST',
    type: 'missing_auth',
    reason:
      'Telematics IoT gateway webhook endpoint. External telematics gateways authenticate via ' +
      'x-webhook-secret / x-telematics-secret and specify tenantId via headers or query parameters, ' +
      'with all database writes strictly executed under withTenantRls.',
  },
];

function ruleExemptionFor(relativePath, violation) {
  return RULE_EXEMPTIONS.find(
    e => e.file === relativePath && e.method === violation.method && e.type === violation.type,
  );
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MUTATION_METHODS = ['POST', 'PUT', 'PATCH'];

// RLS wrapper functions (named exceptions are allowed)
const RLS_WRAPPERS = [
  'withTenantRls',
  'withPlatformAdmin',
  'withSystemJob',
  'withWebhookTenant',
  'runSweep',
  'tenantBootstrapHandler',
];

// Database operation patterns
const DB_OPERATIONS = [
  /prisma\.\$queryRaw/,
  /prisma\.\$executeRaw/,
  /prisma\.\w+\.find/,
  /prisma\.\w+\.create/,
  /prisma\.\w+\.update/,
  /prisma\.\w+\.upsert/,
  /prisma\.\w+\.delete/,
  /prisma\.\w+\.count/,
  /prisma\.\w+\.aggregate/,
  /prisma\.\w+\.groupBy/,
  /tx\.\$queryRaw/,
  /tx\.\$executeRaw/,
  /tx\.\w+\.find/,
  /tx\.\w+\.create/,
  /tx\.\w+\.update/,
  /tx\.\w+\.upsert/,
  /tx\.\w+\.delete/,
  /tx\.\w+\.count/,
  /tx\.\w+\.aggregate/,
  /tx\.\w+\.groupBy/,
];

function isExempt(filePath) {
  return EXEMPT_PATTERNS.some(pattern => pattern.test(filePath.replace(/\\/g, '/')));
}

function getStagedRouteFiles() {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    return output
      .split('\n')
      .filter(f => f.trim())
      .filter(f => f.endsWith('route.ts') && f.includes('src/app/api/'))
      .map(f => path.resolve(f));
  } catch (e) {
    return [];
  }
}

function getAllRouteFiles() {
  const apiDir = path.join(process.cwd(), 'src', 'app', 'api');
  const routes = [];

  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name === 'route.ts') {
        routes.push(fullPath);
      }
    }
  }

  walk(apiDir);
  return routes;
}

function extractHandlerBody(content, method) {
  // Match: export async function METHOD(req: NextRequest, ...) { ... }
  const handlerRegex = new RegExp(
    `export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*\\{`,
    'g'
  );

  const match = handlerRegex.exec(content);
  if (!match) return null;

  // Extract handler body by counting braces
  let depth = 1;
  let start = match.index + match[0].length;
  let i = start;

  while (i < content.length && depth > 0) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    i++;
  }

  return content.substring(start, i - 1);
}

function hasRlsWrapper(handlerBody) {
  // Check if handler uses any RLS wrapper.
  //
  // The optional `<...>` allows an explicit generic type argument between the
  // name and the call parens. Without it `withSystemJob<PerTenantResult>(` did
  // not match, and three correctly-wrapped sweep endpoints were reported as
  // having no RLS wrapper at all. Reporting correct code as a violation is how
  // a checker gets ignored.
  for (const wrapper of RLS_WRAPPERS) {
    if (new RegExp(`\\b${wrapper}\\s*(<[^>()]*>)?\\s*\\(`).test(handlerBody)) {
      return wrapper;
    }
  }
  return null;
}

function hasDatabaseOperations(handlerBody) {
  // Check if handler contains database operations
  return DB_OPERATIONS.some(pattern => pattern.test(handlerBody));
}

function hasDirectPrismaCall(handlerBody) {
  // Ignore TypeScript type-level annotations (typeof prisma...)
  const runtimeBody = handlerBody.replace(/\btypeof\s+prisma\.\w+(\.\w+)?/g, '');

  // Check if handler uses 'prisma' directly (not 'tx') for database operations
  // This indicates missing RLS wrapper
  const directPrismaPatterns = [
    /\bprisma\.\$queryRaw/,
    /\bprisma\.\$executeRaw/,
    /\bprisma\.\w+\.find/,
    /\bprisma\.\w+\.create/,
    /\bprisma\.\w+\.update/,
    /\bprisma\.\w+\.upsert/,
    /\bprisma\.\w+\.delete/,
    /\bprisma\.\w+\.count/,
    /\bprisma\.\w+\.aggregate/,
    /\bprisma\.\w+\.groupBy/,
  ];

  return directPrismaPatterns.some(pattern => pattern.test(runtimeBody));
}

function hasTenantFilter(handlerBody) {
  // Check for explicit tenant filtering in queries
  const filterPatterns = [
    // Direct inline: where: { tenantId, ... }
    /where:\s*\{[^}]*tenantId/,
    // Multi-line where object: const where = { tenantId, ... }
    /const\s+where\s*=\s*\{[^}]*tenantId/,
    // Spread in where: ...{ tenantId }
    /where:\s*\{[^}]*\.\.\..*tenantId/,
    // Raw SQL: WHERE ... tenant_id =
    /WHERE[^;]*tenant_id\s*=/,
    // Parameterized: tenant_id = $N
    /tenant_id\s*=\s*\$\d+/,
    // AND tenant_id = (for conditional filters)
    /AND\s+\w+\.tenant_id\s*=/,
  ];

  return filterPatterns.some(pattern => pattern.test(handlerBody));
}

function hasBodySanitization(handlerBody) {
  // Check for stripTenantOwnershipFields usage
  return /stripTenantOwnershipFields\s*\(/.test(handlerBody);
}

function analyzeRouteFile(filePath, opts = {}) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

  if (isExempt(relativePath)) {
    return { exempt: true, violations: [] };
  }

  // Check for imports
  const hasAuthImport = /import\s+\{[^}]*requireAuthorizedTenant[^}]*\}\s+from\s+['"]@\/lib\/tenant-context['"]/.test(content);
  const hasBootstrapImport = /import\s+\{[^}]*tenantBootstrapHandler[^}]*\}\s+from\s+['"]@\/lib\/handlers\/tenant-bootstrap-handler['"]/.test(content);
  const hasRlsImport = new RegExp(
    `import\\s+\\{[^}]*(${RLS_WRAPPERS.join('|')})[^}]*\\}\\s+from\\s+['"]@/(lib/rls|lib/prisma-sweep|lib/handlers/tenant-bootstrap-handler)['"]`
  ).test(content);
  const hasSanitizeImport = /import\s+\{[^}]*stripTenantOwnershipFields[^}]*\}\s+from\s+['"]@\/lib\/tenant-context['"]/.test(content);

  // Find all exported HTTP method handlers
  const exportedHandlers = [];
  for (const method of HTTP_METHODS) {
    const methodRegex = new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`, 'g');
    if (methodRegex.test(content)) {
      exportedHandlers.push(method);
    }
  }

  if (exportedHandlers.length === 0) {
    return { exempt: false, violations: [], warnings: ['No HTTP method handlers found'] };
  }

  const violations = [];
  const warnings = [];

  // Check each handler
  for (const method of exportedHandlers) {
    const handlerBody = extractHandlerBody(content, method);
    if (!handlerBody) continue;

    const hasDbOps = hasDatabaseOperations(handlerBody);
    const hasDirectPrisma = hasDirectPrismaCall(handlerBody);
    const rlsWrapper = hasRlsWrapper(handlerBody);
    const hasTenantFiltering = hasTenantFilter(handlerBody);
    const isMutation = MUTATION_METHODS.includes(method);
    const hasSanitization = hasBodySanitization(handlerBody);

    // Violation 1: Missing requireAuthorizedTenant (unless explicit tenantBootstrapHandler boundary)
    if (!hasAuthImport && !(hasBootstrapImport && rlsWrapper === 'tenantBootstrapHandler')) {
      violations.push({
        method,
        type: 'missing_auth',
        severity: 'critical',
        message: `${method} handler missing requireAuthorizedTenant() call`,
      });
    }

    // Violation 2: Database operations without RLS wrapper
    if (hasDbOps && hasDirectPrisma && !rlsWrapper) {
      violations.push({
        method,
        type: 'missing_rls_wrapper',
        severity: 'critical',
        message: `${method} handler has database operations without RLS wrapper (use withTenantRls, withPlatformAdmin, etc.)`,
      });
    }

    // Violation 3: RLS wrapper used but not imported
    if (rlsWrapper && !hasRlsImport) {
      violations.push({
        method,
        type: 'missing_rls_import',
        severity: 'error',
        message: `${method} handler uses ${rlsWrapper} but missing import from @/lib/rls, @/lib/prisma-sweep, or @/lib/handlers/tenant-bootstrap-handler`,
      });
    }

    // Warning 1: Missing defense-in-depth tenant filter
    if (hasDbOps && rlsWrapper && !hasTenantFiltering && opts.strict) {
      violations.push({
        method,
        type: 'missing_tenant_filter',
        severity: 'warning',
        message: `${method} handler missing explicit tenant filter (defense-in-depth)`,
      });
    } else if (hasDbOps && rlsWrapper && !hasTenantFiltering) {
      warnings.push({
        method,
        type: 'missing_tenant_filter',
        message: `${method} handler missing explicit tenant filter (recommended for defense-in-depth)`,
      });
    }

    // Violation 4: Mutation without body sanitization (only if actually parsing body)
    const parsesBody = /await\s+req\.json\(\)/.test(handlerBody);
    if (isMutation && hasDbOps && !hasSanitization && parsesBody) {
      violations.push({
        method,
        type: 'missing_sanitization',
        severity: 'error',
        message: `${method} handler should use stripTenantOwnershipFields() to sanitize request body`,
      });
    }

    // Violation 5: Body sanitization used but not imported
    if (hasSanitization && !hasSanitizeImport) {
      violations.push({
        method,
        type: 'missing_sanitize_import',
        severity: 'error',
        message: `${method} handler uses stripTenantOwnershipFields but missing import from @/lib/tenant-context`,
      });
    }
  }

  // Peel off the per-rule exemptions, recording which ones actually fired so
  // main() can flag any that have gone stale.
  const exemptedViolations = [];
  const liveViolations = [];
  for (const v of violations) {
    const ex = ruleExemptionFor(relativePath, v);
    if (ex) {
      ex._matched = true;
      exemptedViolations.push({ ...v, reason: ex.reason });
    } else {
      liveViolations.push(v);
    }
  }

  return {
    exempt: false,
    handlers: exportedHandlers,
    violations: liveViolations,
    exemptedViolations,
    warnings,
  };
}

function generateFixSuggestion(violation, filePath) {
  const suggestions = {
    missing_auth: `
Add to imports:
  import { requireAuthorizedTenant } from '@/lib/tenant-context';

Add at start of ${violation.method} handler:
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
`,
    missing_rls_wrapper: `
Add to imports:
  import { withTenantRls } from '@/lib/rls';

Wrap database operations:
  return withTenantRls(prisma, tenantId, async (tx) => {
    // Replace 'prisma' with 'tx' in all queries
    const data = await tx.model.findMany({ where: { tenantId } });
    return NextResponse.json(data);
  });

For admin routes that need cross-tenant access, use:
  import { withPlatformAdmin } from '@/lib/rls';
  return withPlatformAdmin(prisma, async (tx) => { ... });
`,
    missing_tenant_filter: `
Add explicit tenant filter to queries:

For Prisma:
  where: { tenantId, ... }

For raw SQL:
  WHERE tenant_id = $1 AND ...
`,
    missing_sanitization: `
Add to imports:
  import { stripTenantOwnershipFields } from '@/lib/tenant-context';

Sanitize request body:
  const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);

  // Then use sanitized body
  data: { ...body, tenantId }  // tenantId from auth context, not client
`,
    missing_rls_import: `
Add to imports:
  import { withTenantRls, withPlatformAdmin } from '@/lib/rls';
`,
    missing_sanitize_import: `
Add to imports:
  import { stripTenantOwnershipFields } from '@/lib/tenant-context';
`,
  };

  return suggestions[violation.type] || 'No fix suggestion available';
}

function printResults(results, opts = {}) {
  console.log('🔍 Validating tenant access pipeline...\n');

  const allViolations = [];
  const allWarnings = [];
  let fullyCompliantCount = 0;
  let compliantWithWarningsCount = 0;
  let exemptCount = 0;

  for (const result of results) {
    if (result.exempt) {
      exemptCount++;
    } else if (result.violations.length > 0) {
      allViolations.push({ filePath: result.filePath, ...result });
      if (result.warnings.length > 0) {
        allWarnings.push({ filePath: result.filePath, ...result });
      }
    } else if (result.warnings.length > 0) {
      compliantWithWarningsCount++;
      allWarnings.push({ filePath: result.filePath, ...result });
    } else {
      fullyCompliantCount++;
    }
  }

  const accountedTotal = exemptCount + fullyCompliantCount + compliantWithWarningsCount + allViolations.length;

  // Print summary
  console.log('━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total routes:                 ${results.length}`);
  console.log(`Exempt:                       ${exemptCount} (public/webhooks/auth/health)`);
  console.log(`✅ Fully Compliant:            ${fullyCompliantCount} (0 violations, 0 warnings)`);
  console.log(`⚠️  Compliant with Warnings:    ${compliantWithWarningsCount} (RLS enforced, defense-in-depth suggestions)`);
  console.log(`❌ Violations:                 ${allViolations.length}`);
  console.log(`Accounting Invariant:         ${accountedTotal} / ${results.length} accounted for (${accountedTotal === results.length ? 'VERIFIED 100%' : 'INVARIANT FAILURE'})`);
  console.log('━'.repeat(60));

  if (accountedTotal !== results.length) {
    console.error(`❌ INVARIANT ERROR: Accounted routes (${accountedTotal}) !== total route files (${results.length})`);
    return false;
  }

  // Print violations
  if (allViolations.length > 0) {
    console.log('\nVIOLATIONS:\n');

    for (const result of allViolations) {
      const relativePath = path.relative(process.cwd(), result.filePath).replace(/\\/g, '/');
      console.log(`\n❌ ${relativePath}`);

      for (const violation of result.violations) {
        const severityIcon = {
          critical: '🔴',
          error: '🟠',
          warning: '🟡',
        }[violation.severity] || '⚠️';

        console.log(`   ${severityIcon} ${violation.message}`);

        if (opts.fix) {
          console.log(generateFixSuggestion(violation, result.filePath));
        }
      }
    }
  }

  // Print warnings
  if (allWarnings.length > 0 && !opts.strict) {
    console.log('\n⚠️  WARNINGS (not blocking):\n');

    for (const result of allWarnings) {
      const relativePath = path.relative(process.cwd(), result.filePath).replace(/\\/g, '/');
      console.log(`\n⚠️  ${relativePath}`);

      for (const warning of result.warnings) {
        console.log(`   - ${warning.message}`);
      }
    }
  }

  // Print the per-rule exemptions that fired. These are not failures, but they
  // are the checks deliberately switched off, so they get printed every run
  // rather than quietly disappearing.
  const exempted = results.filter(r => r.exemptedViolations && r.exemptedViolations.length > 0);
  if (exempted.length > 0) {
    console.log('\n🔕 RULE EXEMPTIONS APPLIED:\n');
    for (const result of exempted) {
      const relativePath = path.relative(process.cwd(), result.filePath).replace(/\\/g, '/');
      console.log(`\n🔕 ${relativePath}`);
      for (const v of result.exemptedViolations) {
        console.log(`   ${v.message}`);
        console.log(`   └─ ${v.reason}`);
      }
    }
    console.log('');
  }

  // Success message
  if (allViolations.length === 0) {
    console.log('\n✅ All API routes follow the tenant access pipeline!\n');
  } else {
    console.log(`\n${allViolations.length} route(s) must be fixed.\n`);
    console.log('Run with --fix flag to see detailed fix suggestions:');
    console.log('  npm run tenant:check-rls -- --fix\n');
  }

  return allViolations.length === 0;
}

function main() {
  const args = process.argv.slice(2);
  const opts = {
    staged: args.includes('--staged'),
    fix: args.includes('--fix'),
    strict: args.includes('--strict'),
  };

  const routeFiles = opts.staged ? getStagedRouteFiles() : getAllRouteFiles();

  console.log(`Checking ${routeFiles.length} route files...\n`);

  const results = routeFiles.map(filePath => {
    const result = analyzeRouteFile(filePath, opts);
    return { filePath, ...result };
  });

  let success = printResults(results, opts);

  // A stale exemption is one that no longer suppresses anything: either the
  // route was fixed, renamed or deleted. Leaving it in place means the next
  // person to reintroduce the problem gets a silent pass, so treat it as a
  // failure of the check rather than housekeeping. Only meaningful on a full
  // run — under --staged most routes are not examined at all.
  if (!opts.staged) {
    const stale = RULE_EXEMPTIONS.filter(e => !e._matched);
    if (stale.length > 0) {
      console.log('❌ STALE RULE EXEMPTIONS — these no longer match any violation:\n');
      for (const e of stale) {
        console.log(`   ${e.file} [${e.method} / ${e.type}]`);
      }
      console.log('\nRemove them from RULE_EXEMPTIONS in scripts/check-tenant-rls.js.\n');
      success = false;
    }
  }

  process.exit(success ? 0 : 1);
}

main();
