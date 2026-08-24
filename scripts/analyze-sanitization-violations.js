#!/usr/bin/env node
/**
 * Analyze remaining body sanitization violations
 * Categorize them as: fixable, false positive, or needs manual review
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getViolations() {
  try {
    const output = execSync('node scripts/check-tenant-rls.js 2>&1', {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = output.split('\n');
    const violations = [];
    let currentFile = null;

    for (const line of lines) {
      if (line.startsWith('❌ src/app/api/')) {
        currentFile = line.replace('❌ ', '').trim();
      } else if (line.includes('stripTenantOwnershipFields') && currentFile) {
        const match = line.match(/(POST|PATCH|PUT|DELETE) handler should use stripTenantOwnershipFields/);
        if (match) {
          violations.push({ file: currentFile, handler: match[1] });
        }
      }
    }

    return violations;
  } catch (e) {
    if (e.stdout) {
      const lines = e.stdout.toString().split('\n');
      const violations = [];
      let currentFile = null;

      for (const line of lines) {
        if (line.startsWith('❌ src/app/api/')) {
          currentFile = line.replace('❌ ', '').trim();
        } else if (line.includes('stripTenantOwnershipFields') && currentFile) {
          const match = line.match(/(POST|PATCH|PUT|DELETE) handler should use stripTenantOwnershipFields/);
          if (match) {
            violations.push({ file: currentFile, handler: match[1] });
          }
        }
      }
      return violations;
    }
    return [];
  }
}

function analyzeViolation(filePath, handler) {
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fs.existsSync(fullPath)) {
    return { category: 'not_found', reason: 'File not found' };
  }

  const content = fs.readFileSync(fullPath, 'utf8');

  // Check if handler exists
  const handlerRegex = new RegExp(`export\\s+async\\s+function\\s+${handler}\\s*\\([^)]+\\)`, 'g');
  if (!handlerRegex.test(content)) {
    return { category: 'no_handler', reason: `No ${handler} handler found` };
  }

  // Check if it parses body
  const hasBodyParsing = /await\s+req\.json\(\)/.test(content);
  if (!hasBodyParsing) {
    return { category: 'no_body_parsing', reason: 'Does not parse request body' };
  }

  // Check if it's admin/platform route
  const isAdmin = filePath.includes('/admin/') || filePath.includes('/platform/');
  const isSuperAdminOnly = /SUPER_ADMIN/.test(content) || /withPlatformAdmin/.test(content);

  if (isAdmin && isSuperAdminOnly) {
    return { category: 'super_admin', reason: 'Super admin route - may need tenant_id in body' };
  }

  // Check if body variable is used with tenant fields
  const usesTenantFromBody = /body\?\.tenantId|body\.tenant_id/.test(content);
  if (usesTenantFromBody && !isAdmin) {
    return { category: 'needs_fix', reason: 'Uses tenantId from body - must sanitize' };
  }

  // Check for alternative parsing patterns
  const hasComplexParsing = /req\.json\(\)\.catch|try\s*{[^}]*req\.json/.test(content);
  if (hasComplexParsing) {
    return { category: 'complex_parsing', reason: 'Complex body parsing pattern' };
  }

  return { category: 'needs_review', reason: 'Requires manual review' };
}

async function main() {
  console.log('📊 Analyzing remaining body sanitization violations...\n');

  const violations = getViolations();
  console.log(`Found ${violations.length} violations\n`);

  const categories = {
    needs_fix: [],
    super_admin: [],
    no_body_parsing: [],
    complex_parsing: [],
    needs_review: [],
    no_handler: [],
    not_found: [],
  };

  for (const { file, handler } of violations) {
    const analysis = analyzeViolation(file, handler);
    categories[analysis.category].push({ file, handler, reason: analysis.reason });
  }

  console.log('═'.repeat(70));
  console.log('ANALYSIS RESULTS');
  console.log('═'.repeat(70));

  console.log(`\n🔴 NEEDS FIX (${categories.needs_fix.length})`);
  console.log('Routes that use tenantId from body and must be sanitized:');
  categories.needs_fix.forEach(v => console.log(`  - ${v.file} (${v.handler})`));

  console.log(`\n🟡 COMPLEX PARSING (${categories.complex_parsing.length})`);
  console.log('Routes with complex body parsing that need manual fixing:');
  categories.complex_parsing.forEach(v => console.log(`  - ${v.file} (${v.handler})`));

  console.log(`\n🟢 FALSE POSITIVES (${categories.no_body_parsing.length + categories.super_admin.length})`);
  console.log(`   No body parsing: ${categories.no_body_parsing.length}`);
  console.log(`   Super admin routes: ${categories.super_admin.length}`);

  console.log(`\n🔵 NEEDS MANUAL REVIEW (${categories.needs_review.length})`);
  categories.needs_review.slice(0, 10).forEach(v => console.log(`  - ${v.file} (${v.handler})`));
  if (categories.needs_review.length > 10) {
    console.log(`  ... and ${categories.needs_review.length - 10} more`);
  }

  console.log('\n' + '═'.repeat(70));
  console.log('SUMMARY');
  console.log('═'.repeat(70));
  console.log(`Total violations: ${violations.length}`);
  console.log(`  🔴 Must fix: ${categories.needs_fix.length}`);
  console.log(`  🟡 Complex (manual): ${categories.complex_parsing.length}`);
  console.log(`  🟢 False positives: ${categories.no_body_parsing.length + categories.super_admin.length}`);
  console.log(`  🔵 Review needed: ${categories.needs_review.length}`);
  console.log('═'.repeat(70));

  // Export detailed report
  const report = {
    timestamp: new Date().toISOString(),
    total: violations.length,
    categories,
  };

  fs.writeFileSync(
    path.join(__dirname, '..', 'body-sanitization-analysis.json'),
    JSON.stringify(report, null, 2)
  );

  console.log('\n💾 Detailed report saved to: body-sanitization-analysis.json');
}

main().catch(console.error);
