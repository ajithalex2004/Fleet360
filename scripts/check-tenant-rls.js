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

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const MUTATION_METHODS = ['POST', 'PUT', 'PATCH'];

// RLS wrapper functions (named exceptions are allowed)
const RLS_WRAPPERS = [
  'withTenantRls',
  'withPlatformAdmin',
  'withSystemJob',
  'withWebhookTenant',
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

  return directPrismaPatterns.some(pattern => pattern.test(handlerBody));
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
  const hasRlsImport = new RegExp(
    `import\\s+\\{[^}]*(${RLS_WRAPPERS.join('|')})[^}]*\\}\\s+from\\s+['"]@/lib/rls['"]`
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

    // Violation 1: Missing requireAuthorizedTenant
    if (!hasAuthImport) {
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
        message: `${method} handler uses ${rlsWrapper} but missing import from @/lib/rls`,
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

  return {
    exempt: false,
    handlers: exportedHandlers,
    violations,
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
  let compliantCount = 0;
  let exemptCount = 0;

  for (const result of results) {
    if (result.exempt) {
      exemptCount++;
    } else if (result.violations.length === 0 && result.warnings.length === 0) {
      compliantCount++;
    } else {
      if (result.violations.length > 0) {
        allViolations.push({ filePath: result.filePath, ...result });
      }
      if (result.warnings.length > 0) {
        allWarnings.push({ filePath: result.filePath, ...result });
      }
    }
  }

  // Print summary
  console.log('━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total routes:     ${results.length}`);
  console.log(`Exempt:           ${exemptCount} (public/webhooks/auth/health)`);
  console.log(`✅ Compliant:      ${compliantCount}`);
  console.log(`❌ Violations:     ${allViolations.length}`);
  console.log(`⚠️  Warnings:       ${allWarnings.length}`);
  console.log('━'.repeat(60));

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

  const success = printResults(results, opts);

  process.exit(success ? 0 : 1);
}

main();
