#!/usr/bin/env node
/**
 * Tenant Authorization Checker
 *
 * Scans API route files to ensure they use requireAuthorizedTenant()
 * for proper tenant isolation enforcement.
 *
 * Usage:
 *   node scripts/check-tenant-auth.js [--staged]
 *
 * Flags:
 *   --staged: Only check staged files (for pre-commit hook)
 *   --fix: Show fix suggestions for violations
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Routes that are exempt from tenant auth requirements
const EXEMPT_PATTERNS = [
  /^src\/app\/api\/public\//,
  /^src\/app\/api\/webhooks\//,
  /^src\/app\/api\/auth\//,
  /^src\/app\/api\/health/,
  /^src\/app\/api\/cron\//,

  // ── Individually exempt: these CANNOT use requireAuthorizedTenant ──────────
  // Both are authenticated, just not by a per-request tenant context. Do not
  // "fix" them by adding requireAuthorizedTenant() — doing so has already
  // broken production once each.

  // Session bootstrap. This is the endpoint the client calls to *establish* a
  // tenant session, so requiring an already-authorized tenant is a deadlock:
  // it returned 401 to every session-restore attempt, which made ModuleGuard
  // render its "Session required" wall across the whole app (fixed in
  // ca8a8523). It authenticates itself — a signed `xl-session` cookie via
  // verifySession(), cross-checked against any userId/tenantId supplied, then
  // an active UserTenant row lookup before anything is returned.
  /^src\/app\/api\/admin\/session\/route\.ts$/,

  // Cron-triggered scheduler that lives outside api/cron/. Gated by the
  // PUSH_CRON_SECRET shared secret, and deliberately accepts a null tenantId
  // so runTripReminders() can iterate every active tenant via withSystemJob.
  // requireAuthorizedTenant() would force a single-tenant context and silently
  // break the all-tenant sweep (reverted in 54ef02b8).
  /^src\/app\/api\/push\/run-scheduler\/route\.ts$/,
];

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

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

function analyzeRouteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

  if (isExempt(relativePath)) {
    return { exempt: true, violations: [] };
  }

  // Check for requireAuthorizedTenant import
  const hasImport = /import\s+\{[^}]*requireAuthorizedTenant[^}]*\}\s+from\s+['"]@\/lib\/tenant-context['"]/.test(content);

  // Find all exported HTTP method handlers
  const exportedHandlers = [];
  for (const method of HTTP_METHODS) {
    const methodRegex = new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\(`, 'g');
    if (methodRegex.test(content)) {
      exportedHandlers.push(method);
    }
  }

  if (exportedHandlers.length === 0) {
    // No handlers found - might be dynamic route or re-export
    return { exempt: false, violations: [], warnings: ['No HTTP method handlers found'] };
  }

  const violations = [];

  if (!hasImport) {
    violations.push({
      type: 'missing_import',
      message: 'Missing requireAuthorizedTenant import',
      handlers: exportedHandlers,
    });
  }

  // Check each handler for requireAuthorizedTenant call
  for (const method of exportedHandlers) {
    // Extract the handler function body
    const handlerRegex = new RegExp(`export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*\\{([^]*?)\\n\\}(?:\\s*(?:export|$))`, 'm');
    const match = content.match(handlerRegex);

    if (match) {
      const handlerBody = match[1];
      const hasAuthzCall = /requireAuthorizedTenant\s*\(/.test(handlerBody);

      if (!hasAuthzCall) {
        // Check if it manually checks headers (anti-pattern)
        const hasManualCheck = /req\.headers\.get\s*\(\s*['"]x-tenant-id['"]\s*\)/.test(handlerBody);

        violations.push({
          type: 'missing_call',
          method,
          message: `${method} handler missing requireAuthorizedTenant() call`,
          hasManualCheck,
        });
      }
    }
  }

  return { exempt: false, violations };
}

function formatViolations(filePath, analysis) {
  const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  const lines = [];

  if (analysis.violations.length === 0) {
    return null;
  }

  lines.push(`\n❌ ${relativePath}`);

  for (const violation of analysis.violations) {
    if (violation.type === 'missing_import') {
      lines.push(`   - Missing import: requireAuthorizedTenant`);
      lines.push(`     Add: import { requireAuthorizedTenant } from '@/lib/tenant-context';`);
    } else if (violation.type === 'missing_call') {
      lines.push(`   - ${violation.method} handler lacks requireAuthorizedTenant() call`);
      if (violation.hasManualCheck) {
        lines.push(`     Found manual x-tenant-id check (anti-pattern)`);
      }
    }
  }

  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const stagedOnly = args.includes('--staged');
  const showFix = args.includes('--fix');

  console.log('🔍 Scanning API routes for tenant authorization...\n');

  const files = stagedOnly ? getStagedRouteFiles() : getAllRouteFiles();

  if (files.length === 0) {
    console.log('No route files to check.');
    process.exit(0);
  }

  console.log(`Checking ${files.length} route files...\n`);

  const results = {
    total: files.length,
    exempt: 0,
    compliant: 0,
    violations: 0,
    violationDetails: [],
  };

  for (const file of files) {
    const analysis = analyzeRouteFile(file);

    if (analysis.exempt) {
      results.exempt++;
    } else if (analysis.violations.length === 0) {
      results.compliant++;
    } else {
      results.violations++;
      const formatted = formatViolations(file, analysis);
      if (formatted) {
        results.violationDetails.push({ file, analysis, formatted });
      }
    }
  }

  // Print summary
  console.log('━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total routes:     ${results.total}`);
  console.log(`Exempt:           ${results.exempt} (public/webhooks/auth/health)`);
  console.log(`✅ Compliant:      ${results.compliant}`);
  console.log(`❌ Violations:     ${results.violations}`);
  console.log('━'.repeat(60));

  if (results.violations > 0) {
    console.log('\nVIOLATIONS:\n');
    for (const detail of results.violationDetails) {
      console.log(detail.formatted);
    }

    if (showFix) {
      console.log('\n━'.repeat(60));
      console.log('FIX PATTERN');
      console.log('━'.repeat(60));
      console.log(`
Replace manual header checks:
  ❌ const tenantId = req.headers.get('x-tenant-id');
  ❌ if (!tenantId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

With requireAuthorizedTenant():
  ✅ const authz = requireAuthorizedTenant({headers: req.headers, nextUrl: req.nextUrl});
  ✅ if (!authz.ok) {
  ✅   return NextResponse.json({ error: authz.error }, { status: authz.status });
  ✅ }
  ✅ const { tenantId } = authz;
`);
    }

    console.log(`\n${results.violations} route${results.violations > 1 ? 's' : ''} must be fixed before commit.\n`);
    console.log('Run with --fix to see the fix pattern.\n');

    process.exit(1);
  } else {
    console.log('\n✅ All API routes properly enforce tenant authorization!\n');
    process.exit(0);
  }
}

main();
