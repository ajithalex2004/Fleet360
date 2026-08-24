#!/usr/bin/env node
/**
 * Batch Fix Tenant Authorization
 *
 * Automatically fixes API routes to use requireAuthorizedTenant()
 * instead of manual header checks.
 *
 * Usage:
 *   node scripts/batch-fix-tenant-auth.js [--dry-run] [--pattern=glob]
 *
 * Flags:
 *   --dry-run: Show what would be changed without modifying files
 *   --pattern: Glob pattern to filter files (e.g., "src/app/api/admin/**")
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function fixRouteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  let modified = content;
  let changes = [];

  // Pattern 1: Add import if missing
  const hasImport = /import\s+\{[^}]*requireAuthorizedTenant[^}]*\}\s+from\s+['"]@\/lib\/tenant-context['"]/.test(content);

  if (!hasImport) {
    // Find the last import statement
    const importMatches = [...content.matchAll(/^import\s+.*from\s+['"][^'"]+['"];?\s*$/gm)];
    if (importMatches.length > 0) {
      const lastImport = importMatches[importMatches.length - 1];
      const insertPos = lastImport.index + lastImport[0].length;

      // Check if tenant-context import might exist but incomplete
      const hasTenantContextImport = /import\s+\{[^}]*\}\s+from\s+['"]@\/lib\/tenant-context['"]/.test(content);

      if (hasTenantContextImport) {
        // Update existing import to include requireAuthorizedTenant
        modified = modified.replace(
          /(import\s+\{)([^}]*)(}\s+from\s+['"]@\/lib\/tenant-context['"])/,
          (match, start, imports, end) => {
            if (imports.includes('requireAuthorizedTenant')) return match;
            const items = imports.split(',').map(s => s.trim()).filter(Boolean);
            items.unshift('requireAuthorizedTenant');
            return `${start} ${items.join(', ')} ${end}`;
          }
        );
        changes.push('Updated tenant-context import to include requireAuthorizedTenant');
      } else {
        // Add new import
        modified = modified.slice(0, insertPos) +
                   "\nimport { requireAuthorizedTenant } from '@/lib/tenant-context';" +
                   modified.slice(insertPos);
        changes.push('Added requireAuthorizedTenant import');
      }
    }
  }

  // Pattern 2: Replace manual header checks with requireAuthorizedTenant
  // Match: const tenantId = req.headers.get('x-tenant-id');
  //        if (!tenantId) return ...
  const manualCheckPattern = /(\s+)const\s+tenantId\s*=\s*req\.headers\.get\(['"]x-tenant-id['"]\);?\s*\n\s+if\s*\(\s*!tenantId\s*\)[^{]*\{[^}]*\}/g;

  if (manualCheckPattern.test(content)) {
    modified = modified.replace(
      manualCheckPattern,
      (match, indent) => {
        changes.push('Replaced manual tenantId check with requireAuthorizedTenant');
        return `${indent}const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
${indent}if (!authz.ok) {
${indent}  return NextResponse.json({ error: authz.error }, { status: authz.status });
${indent}}
${indent}const { tenantId } = authz;`;
      }
    );
  }

  // Pattern 3: Handle cases with userId and/or role extraction
  const manualCheckWithUserPattern = /(\s+)const\s+tenantId\s*=\s*req\.headers\.get\(['"]x-tenant-id['"]\);?\s*\n\s+const\s+userId\s*=\s*req\.headers\.get\(['"]x-user-id['"]\);?\s*\n\s+if\s*\(\s*!tenantId\s*\|\|\s*!userId\s*\)[^{]*\{[^}]*\}/g;

  if (manualCheckWithUserPattern.test(modified)) {
    modified = modified.replace(
      manualCheckWithUserPattern,
      (match, indent) => {
        changes.push('Replaced manual tenantId+userId check with requireAuthorizedTenant');
        return `${indent}const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
${indent}if (!authz.ok) {
${indent}  return NextResponse.json({ error: authz.error }, { status: authz.status });
${indent}}
${indent}const { tenantId, userId } = authz;`;
      }
    );
  }

  // Pattern 4: Handle cases with role as well
  const manualCheckWithRolePattern = /(\s+)const\s+tenantId\s*=\s*req\.headers\.get\(['"]x-tenant-id['"]\);?\s*\n\s+const\s+userId\s*=\s*req\.headers\.get\(['"]x-user-id['"]\);?\s*\n\s+const\s+role\s*=\s*req\.headers\.get\(['"]x-user-role['"]\)[^;]*;?\s*\n\s+if\s*\(\s*!tenantId\s*\|\|\s*!userId\s*\)[^{]*\{[^}]*\}/g;

  if (manualCheckWithRolePattern.test(modified)) {
    modified = modified.replace(
      manualCheckWithRolePattern,
      (match, indent) => {
        changes.push('Replaced manual tenantId+userId+role check with requireAuthorizedTenant');
        return `${indent}const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
${indent}if (!authz.ok) {
${indent}  return NextResponse.json({ error: authz.error }, { status: authz.status });
${indent}}
${indent}const { tenantId, userId, role } = authz;`;
      }
    );
  }

  // Pattern 5: Just tenantId without userId
  const justTenantPattern = /(\s+)const\s+tenantId\s*=\s*req\.headers\.get\(['"]x-tenant-id['"]\);?\s*\n\s+if\s*\(\s*!tenantId\s*\)\s+return\s+NextResponse\.json\([^)]*\),?\s*\{[^}]*\}\s*\);?/g;

  if (justTenantPattern.test(modified)) {
    modified = modified.replace(
      justTenantPattern,
      (match, indent) => {
        changes.push('Replaced manual tenantId check with requireAuthorizedTenant');
        return `${indent}const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
${indent}if (!authz.ok) {
${indent}  return NextResponse.json({ error: authz.error }, { status: authz.status });
${indent}}
${indent}const { tenantId } = authz;`;
      }
    );
  }

  return {
    modified,
    changed: content !== modified,
    changes,
  };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const patternArg = args.find(a => a.startsWith('--pattern='));
  const pattern = patternArg ? patternArg.split('=')[1] : 'src/app/api/**/*.ts';

  console.log(`🔧 Batch fixing tenant authorization in API routes...\n`);
  console.log(`Pattern: ${pattern}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no files modified)' : 'WRITE'}\n`);

  // Get list of route files
  const files = execSync(`find src/app/api -name "route.ts" -type f`, { encoding: 'utf8' })
    .split('\n')
    .filter(f => f.trim())
    .map(f => path.resolve(f));

  let fixedCount = 0;
  let unchangedCount = 0;
  const fixedFiles = [];

  for (const file of files) {
    const result = fixRouteFile(file);

    if (result.changed) {
      fixedCount++;
      const relativePath = path.relative(process.cwd(), file).replace(/\\/g, '/');
      fixedFiles.push({ path: relativePath, changes: result.changes });

      if (!dryRun) {
        fs.writeFileSync(file, result.modified, 'utf8');
      }

      console.log(`✅ ${relativePath}`);
      for (const change of result.changes) {
        console.log(`   - ${change}`);
      }
    } else {
      unchangedCount++;
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total files:      ${files.length}`);
  console.log(`Fixed:            ${fixedCount}`);
  console.log(`Unchanged:        ${unchangedCount}`);
  console.log('━'.repeat(60));

  if (dryRun && fixedCount > 0) {
    console.log('\n⚠️  DRY RUN MODE - No files were modified');
    console.log('Remove --dry-run flag to apply changes\n');
  } else if (fixedCount > 0) {
    console.log('\n✅ Files have been updated!');
    console.log('\nNext steps:');
    console.log('1. Review the changes: git diff');
    console.log('2. Run tests: npm test');
    console.log('3. Verify compliance: npm run tenant:check-auth\n');
  } else {
    console.log('\n✅ No changes needed - all files already compliant!\n');
  }
}

main();
