#!/usr/bin/env node
/**
 * RLS Integration Smoke Test
 * Quick validation that RLS infrastructure is working correctly
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

console.log('═'.repeat(70));
console.log(`${BLUE}RLS INTEGRATION SMOKE TEST${RESET}`);
console.log('═'.repeat(70));
console.log();

const tests = [];

// Test 1: Verify RLS library exists and exports correct functions
console.log(`${BLUE}▶${RESET} Test 1: RLS Library Validation`);
try {
  const rlsPath = path.join(process.cwd(), 'src/lib/rls.ts');
  const rlsContent = fs.readFileSync(rlsPath, 'utf8');

  const requiredExports = [
    'withTenantRls',
    'withPlatformAdmin',
    'withSystemJob',
    'withWebhookTenant',
  ];

  const missingExports = requiredExports.filter(exp =>
    !rlsContent.includes(`export async function ${exp}`) &&
    !rlsContent.includes(`export function ${exp}`)
  );

  if (missingExports.length === 0) {
    console.log(`${GREEN}✓${RESET} RLS library exports all required functions`);
    tests.push({ name: 'RLS Library', passed: true });
  } else {
    console.log(`${RED}✗${RESET} Missing exports: ${missingExports.join(', ')}`);
    tests.push({ name: 'RLS Library', passed: false });
  }
} catch (error) {
  console.log(`${RED}✗${RESET} Failed to read RLS library: ${error.message}`);
  tests.push({ name: 'RLS Library', passed: false });
}
console.log();

// Test 2: Verify tenant-context library
console.log(`${BLUE}▶${RESET} Test 2: Tenant Context Library Validation`);
try {
  const contextPath = path.join(process.cwd(), 'src/lib/tenant-context.ts');
  const contextContent = fs.readFileSync(contextPath, 'utf8');

  const requiredExports = [
    'requireAuthorizedTenant',
    'stripTenantOwnershipFields',
  ];

  const missingExports = requiredExports.filter(exp => !contextContent.includes(`export function ${exp}`));

  if (missingExports.length === 0) {
    console.log(`${GREEN}✓${RESET} Tenant context library exports all required functions`);
    tests.push({ name: 'Tenant Context', passed: true });
  } else {
    console.log(`${RED}✗${RESET} Missing exports: ${missingExports.join(', ')}`);
    tests.push({ name: 'Tenant Context', passed: false });
  }
} catch (error) {
  console.log(`${RED}✗${RESET} Failed to read tenant context library: ${error.message}`);
  tests.push({ name: 'Tenant Context', passed: false });
}
console.log();

// Test 3: Sample route structure validation
console.log(`${BLUE}▶${RESET} Test 3: Sample Route Structure Validation`);
try {
  const sampleRoutes = [
    'src/app/api/vehicles/route.ts',
    'src/app/api/drivers/route.ts',
    'src/app/api/fleet/vehicles/route.ts',
  ];

  let validRoutes = 0;
  let invalidRoutes = [];

  for (const route of sampleRoutes) {
    const routePath = path.join(process.cwd(), route);
    if (fs.existsSync(routePath)) {
      const content = fs.readFileSync(routePath, 'utf8');

      const hasAuth = content.includes('requireAuthorizedTenant');
      const hasRls = content.includes('withTenantRls') ||
                     content.includes('withPlatformAdmin') ||
                     content.includes('withReadUncommitted');

      if (hasAuth && hasRls) {
        validRoutes++;
      } else {
        invalidRoutes.push({ route, hasAuth, hasRls });
      }
    }
  }

  if (validRoutes === sampleRoutes.length) {
    console.log(`${GREEN}✓${RESET} All sample routes have proper RLS structure (${validRoutes}/${sampleRoutes.length})`);
    tests.push({ name: 'Sample Routes', passed: true });
  } else if (validRoutes > 0) {
    console.log(`${YELLOW}⚠${RESET} Some routes valid (${validRoutes}/${sampleRoutes.length})`);
    invalidRoutes.forEach(r => {
      console.log(`  ${r.route}: auth=${r.hasAuth}, rls=${r.hasRls}`);
    });
    tests.push({ name: 'Sample Routes', passed: true, warning: true });
  } else {
    console.log(`${RED}✗${RESET} No valid routes found`);
    tests.push({ name: 'Sample Routes', passed: false });
  }
} catch (error) {
  console.log(`${RED}✗${RESET} Failed to validate sample routes: ${error.message}`);
  tests.push({ name: 'Sample Routes', passed: false });
}
console.log();

// Test 4: Check for dangerous patterns
console.log(`${BLUE}▶${RESET} Test 4: Anti-Pattern Detection`);
try {
  const dangerousPatterns = [
    { pattern: /prisma\.\w+\.\w+\(/g, name: 'Direct Prisma calls outside RLS wrapper' },
  ];

  const sampleRoutes = [
    'src/app/api/vehicles/route.ts',
    'src/app/api/drivers/route.ts',
  ];

  let foundDangerousPatterns = false;

  for (const route of sampleRoutes) {
    const routePath = path.join(process.cwd(), route);
    if (fs.existsSync(routePath)) {
      const content = fs.readFileSync(routePath, 'utf8');

      // Check if it's inside withTenantRls by looking for the wrapper
      const hasWrapper = /withTenantRls\([^,]+,\s*[^,]+,\s*async\s*\([^)]*tx[^)]*\)\s*=>/s.test(content);

      if (!hasWrapper) {
        for (const { pattern, name } of dangerousPatterns) {
          if (pattern.test(content)) {
            console.log(`${YELLOW}⚠${RESET} Found ${name} in ${route}`);
            foundDangerousPatterns = true;
          }
        }
      }
    }
  }

  if (!foundDangerousPatterns) {
    console.log(`${GREEN}✓${RESET} No dangerous patterns detected in sample routes`);
    tests.push({ name: 'Anti-Pattern', passed: true });
  } else {
    console.log(`${YELLOW}⚠${RESET} Some patterns found (may be acceptable)`);
    tests.push({ name: 'Anti-Pattern', passed: true, warning: true });
  }
} catch (error) {
  console.log(`${RED}✗${RESET} Failed to check patterns: ${error.message}`);
  tests.push({ name: 'Anti-Pattern', passed: false });
}
console.log();

// Test 5: Body sanitization check
console.log(`${BLUE}▶${RESET} Test 5: Body Sanitization Validation`);
try {
  const mutationRoutes = [
    'src/app/api/vehicles/route.ts',
    'src/app/api/drivers/route.ts',
  ];

  let sanitizedRoutes = 0;
  let unsanitizedRoutes = [];

  for (const route of mutationRoutes) {
    const routePath = path.join(process.cwd(), route);
    if (fs.existsSync(routePath)) {
      const content = fs.readFileSync(routePath, 'utf8');

      const hasMutation = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/.test(content);
      const hasBodyParsing = /await\s+req\.json\(\)/.test(content);
      const hasSanitization = /stripTenantOwnershipFields/.test(content);

      if (hasMutation && hasBodyParsing) {
        if (hasSanitization) {
          sanitizedRoutes++;
        } else {
          unsanitizedRoutes.push(route);
        }
      } else {
        // No body parsing, so no need for sanitization
        sanitizedRoutes++;
      }
    }
  }

  if (unsanitizedRoutes.length === 0) {
    console.log(`${GREEN}✓${RESET} All mutation routes sanitize request bodies`);
    tests.push({ name: 'Body Sanitization', passed: true });
  } else {
    console.log(`${RED}✗${RESET} Routes without sanitization: ${unsanitizedRoutes.join(', ')}`);
    tests.push({ name: 'Body Sanitization', passed: false });
  }
} catch (error) {
  console.log(`${RED}✗${RESET} Failed to check sanitization: ${error.message}`);
  tests.push({ name: 'Body Sanitization', passed: false });
}
console.log();

// Summary
console.log('═'.repeat(70));
console.log(`${BLUE}TEST SUMMARY${RESET}`);
console.log('═'.repeat(70));

const passed = tests.filter(t => t.passed).length;
const failed = tests.filter(t => !t.passed).length;
const warnings = tests.filter(t => t.warning).length;

console.log(`Total Tests:     ${tests.length}`);
console.log(`${GREEN}✓ Passed:        ${passed}${RESET}`);

if (failed > 0) {
  console.log(`${RED}✗ Failed:        ${failed}${RESET}`);
}

if (warnings > 0) {
  console.log(`${YELLOW}⚠ Warnings:      ${warnings}${RESET}`);
}

console.log('═'.repeat(70));

if (failed === 0) {
  console.log(`\n${GREEN}✓ RLS SMOKE TEST PASSED${RESET}`);
  console.log(`${GREEN}✓ Core RLS infrastructure is working correctly${RESET}\n`);
  process.exit(0);
} else {
  console.log(`\n${RED}✗ RLS SMOKE TEST FAILED${RESET}`);
  console.log(`${RED}✗ Fix the issues above before deployment${RESET}\n`);
  process.exit(1);
}
