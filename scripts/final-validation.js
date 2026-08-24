#!/usr/bin/env node
/**
 * Final Validation Test Suite
 * Runs comprehensive checks before production deployment
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

function runTest(name, command, options = {}) {
  console.log(`\n${BLUE}▶${RESET} Running: ${name}`);

  try {
    const output = execSync(command, {
      encoding: 'utf8',
      cwd: options.cwd || process.cwd(),
      maxBuffer: 10 * 1024 * 1024,
    });

    if (options.checkOutput) {
      return options.checkOutput(output);
    }

    console.log(`${GREEN}✓${RESET} ${name} - PASSED`);
    return { passed: true, output };
  } catch (error) {
    console.log(`${RED}✗${RESET} ${name} - FAILED`);

    if (options.allowFailure) {
      console.log(`${YELLOW}  (Non-critical failure)${RESET}`);
      return { passed: false, output: error.stdout || error.message, critical: false };
    }

    return { passed: false, output: error.stdout || error.message, critical: true };
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log(`${BLUE}TENANT RLS MIGRATION - FINAL VALIDATION TEST SUITE${RESET}`);
  console.log('═'.repeat(70));

  const results = [];

  // Test 1: RLS Compliance Check
  const rlsTest = runTest(
    'RLS Compliance Check',
    'node scripts/check-tenant-rls.js',
    {
      checkOutput: (output) => {
        const violationsMatch = output.match(/❌ Violations:\s+(\d+)/);
        const violations = violationsMatch ? parseInt(violationsMatch[1]) : 1;

        if (violations === 0) {
          console.log(`${GREEN}✓${RESET} RLS Compliance Check - PASSED (0 violations)`);
          return { passed: true, output, violations: 0 };
        } else {
          console.log(`${RED}✗${RESET} RLS Compliance Check - FAILED (${violations} violations)`);
          return { passed: false, output, violations, critical: true };
        }
      }
    }
  );
  results.push({ name: 'RLS Compliance', ...rlsTest });

  // Test 2: TypeScript Compilation
  const tsTest = runTest(
    'TypeScript Compilation',
    'npx tsc --noEmit',
    { allowFailure: true }
  );
  results.push({ name: 'TypeScript', ...tsTest });

  // Test 3: File Structure Validation
  const fileTest = runTest(
    'File Structure Validation',
    'node -e "console.log(\'Files validated\')"',
    {
      checkOutput: () => {
        const requiredFiles = [
          'scripts/check-tenant-rls.js',
          'src/lib/tenant-context.ts',
          'src/lib/rls.ts',
          '.github/workflows/tenant-rls-check.yml',
          'scripts/githooks/pre-commit',
        ];

        const missing = requiredFiles.filter(f => !fs.existsSync(path.join(process.cwd(), f)));

        if (missing.length === 0) {
          console.log(`${GREEN}✓${RESET} File Structure Validation - PASSED`);
          return { passed: true };
        } else {
          console.log(`${RED}✗${RESET} File Structure Validation - FAILED`);
          console.log(`${RED}  Missing files: ${missing.join(', ')}${RESET}`);
          return { passed: false, critical: true };
        }
      }
    }
  );
  results.push({ name: 'File Structure', ...fileTest });

  // Test 4: Check for backup files
  const backupTest = runTest(
    'Backup Files Check',
    'node -e "console.log(\'Checking backups\')"',
    {
      checkOutput: () => {
        const backupPatterns = ['.bak', '.bak-sanitize', '.bak-comprehensive', '.bak-final-fix'];
        let foundBackups = 0;

        function countBackups(dir) {
          if (!fs.existsSync(dir)) return;

          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory()) {
              countBackups(path.join(dir, entry.name));
            } else {
              if (backupPatterns.some(pattern => entry.name.endsWith(pattern))) {
                foundBackups++;
              }
            }
          }
        }

        countBackups(path.join(process.cwd(), 'src/app/api'));

        console.log(`${GREEN}✓${RESET} Backup Files Check - PASSED (${foundBackups} backups found)`);
        return { passed: true, backupCount: foundBackups };
      }
    }
  );
  results.push({ name: 'Backups', ...backupTest });

  // Test 5: Documentation Check
  const docsTest = runTest(
    'Documentation Check',
    'node -e "console.log(\'Checking docs\')"',
    {
      checkOutput: () => {
        const requiredDocs = [
          'MIGRATION_PROGRESS.md',
          'BODY_SANITIZATION_COMPLETE.md',
          'CI_INTEGRATION_GUIDE.md',
          'PROJECT_SUMMARY.md',
        ];

        const missing = requiredDocs.filter(f => !fs.existsSync(path.join(process.cwd(), f)));

        if (missing.length === 0) {
          console.log(`${GREEN}✓${RESET} Documentation Check - PASSED`);
          return { passed: true };
        } else {
          console.log(`${YELLOW}⚠${RESET} Documentation Check - WARNING`);
          console.log(`${YELLOW}  Missing docs: ${missing.join(', ')}${RESET}`);
          return { passed: true, warning: true };
        }
      }
    }
  );
  results.push({ name: 'Documentation', ...docsTest });

  // Test 6: Git Hooks Installation
  const hooksTest = runTest(
    'Git Hooks Check',
    'git config core.hooksPath',
    {
      checkOutput: (output) => {
        const hooksPath = output.trim();

        if (hooksPath === 'scripts/githooks') {
          console.log(`${GREEN}✓${RESET} Git Hooks Check - PASSED`);
          return { passed: true };
        } else {
          console.log(`${YELLOW}⚠${RESET} Git Hooks Check - WARNING`);
          console.log(`${YELLOW}  Run: npm run setup-hooks${RESET}`);
          return { passed: true, warning: true };
        }
      },
      allowFailure: true
    }
  );
  results.push({ name: 'Git Hooks', ...hooksTest });

  // Test 7: Route Count Verification
  const routeCountTest = runTest(
    'Route Count Verification',
    'node -e "console.log(\'Counting routes\')"',
    {
      checkOutput: () => {
        function countRoutes(dir) {
          if (!fs.existsSync(dir)) return 0;

          let count = 0;
          const entries = fs.readdirSync(dir, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.isDirectory()) {
              count += countRoutes(path.join(dir, entry.name));
            } else if (entry.name === 'route.ts') {
              count++;
            }
          }

          return count;
        }

        const routeCount = countRoutes(path.join(process.cwd(), 'src/app/api'));

        if (routeCount >= 680 && routeCount <= 690) {
          console.log(`${GREEN}✓${RESET} Route Count Verification - PASSED (${routeCount} routes)`);
          return { passed: true, routeCount };
        } else {
          console.log(`${YELLOW}⚠${RESET} Route Count Verification - WARNING (${routeCount} routes)`);
          console.log(`${YELLOW}  Expected: ~684 routes${RESET}`);
          return { passed: true, warning: true, routeCount };
        }
      }
    }
  );
  results.push({ name: 'Route Count', ...routeCountTest });

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log(`${BLUE}TEST RESULTS SUMMARY${RESET}`);
  console.log('═'.repeat(70));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const critical = results.filter(r => !r.passed && r.critical).length;
  const warnings = results.filter(r => r.warning).length;

  console.log(`\nTotal Tests:     ${results.length}`);
  console.log(`${GREEN}✓ Passed:        ${passed}${RESET}`);

  if (failed > 0) {
    console.log(`${RED}✗ Failed:        ${failed}${RESET}`);
  }

  if (critical > 0) {
    console.log(`${RED}⚠ Critical:      ${critical}${RESET}`);
  }

  if (warnings > 0) {
    console.log(`${YELLOW}⚠ Warnings:      ${warnings}${RESET}`);
  }

  console.log('\n' + '═'.repeat(70));

  // Extract key metrics
  const rlsResult = results.find(r => r.name === 'RLS Compliance');
  if (rlsResult && rlsResult.violations !== undefined) {
    console.log(`${BLUE}KEY METRICS${RESET}`);
    console.log('═'.repeat(70));
    console.log(`RLS Violations:       ${rlsResult.violations === 0 ? GREEN + '0' + RESET : RED + rlsResult.violations + RESET}`);

    const backupResult = results.find(r => r.name === 'Backups');
    if (backupResult && backupResult.backupCount !== undefined) {
      console.log(`Backup Files:         ${backupResult.backupCount}`);
    }

    const routeResult = results.find(r => r.name === 'Route Count');
    if (routeResult && routeResult.routeCount !== undefined) {
      console.log(`Total Routes:         ${routeResult.routeCount}`);
    }

    console.log('═'.repeat(70));
  }

  // Final verdict
  console.log(`\n${BLUE}FINAL VERDICT${RESET}`);
  console.log('═'.repeat(70));

  if (critical > 0) {
    console.log(`${RED}✗ VALIDATION FAILED - ${critical} critical issue(s)${RESET}`);
    console.log(`${RED}⚠ NOT READY FOR PRODUCTION DEPLOYMENT${RESET}`);
    process.exit(1);
  } else if (failed > 0) {
    console.log(`${YELLOW}⚠ VALIDATION PASSED WITH WARNINGS${RESET}`);
    console.log(`${YELLOW}⚠ Review non-critical failures before deployment${RESET}`);
  } else if (warnings > 0) {
    console.log(`${GREEN}✓ VALIDATION PASSED${RESET}`);
    console.log(`${YELLOW}⚠ ${warnings} warning(s) - address before deployment${RESET}`);
  } else {
    console.log(`${GREEN}✓ ALL TESTS PASSED${RESET}`);
    console.log(`${GREEN}✓ READY FOR PRODUCTION DEPLOYMENT${RESET}`);
  }

  console.log('═'.repeat(70));
  console.log(`\n${BLUE}Next Steps:${RESET}`);
  console.log('1. Review test results above');
  console.log('2. Address any warnings or failures');
  console.log('3. Run integration tests: npm run test:integration');
  console.log('4. Deploy to staging environment');
  console.log('5. Run smoke tests on staging');
  console.log('6. Deploy to production');
  console.log('\n');
}

main().catch(console.error);
