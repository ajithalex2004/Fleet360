#!/usr/bin/env node
/**
 * Automated Route Migration Script
 *
 * Migrates API routes to use the tenant access pipeline:
 *   requireAuthorizedTenant() → withTenantRls() → tenant-scoped queries
 *
 * Usage:
 *   node scripts/migrate-route-to-rls.js <route-file-path>
 *   node scripts/migrate-route-to-rls.js src/app/api/fleet/vehicles/route.ts
 *
 * What it does:
 *   1. Adds missing imports (withTenantRls, stripTenantOwnershipFields)
 *   2. Wraps database operations in withTenantRls()
 *   3. Adds body sanitization to POST/PUT/PATCH handlers
 *   4. Replaces 'prisma' with 'tx' inside wrappers
 *
 * Safety:
 *   - Creates backup file (.bak)
 *   - Dry-run mode available with --dry-run
 *   - Manual review required after migration
 */

const fs = require('fs');
const path = require('path');

const MUTATION_METHODS = ['POST', 'PUT', 'PATCH'];

function backup(filePath) {
  const bakPath = filePath + '.bak';
  fs.copyFileSync(filePath, bakPath);
  console.log(`✓ Backup created: ${bakPath}`);
}

function hasImport(content, importName) {
  const pattern = new RegExp(`import\\s+\\{[^}]*${importName}[^}]*\\}\\s+from`);
  return pattern.test(content);
}

function addImportIfMissing(content, importName, importPath) {
  if (hasImport(content, importName)) {
    return content;
  }

  // Find existing imports from the same module
  const modulePattern = new RegExp(
    `(import\\s+\\{)([^}]*)(\\}\\s+from\\s+['"]${importPath.replace(/\//g, '\\/')}['"])`,
    'g'
  );

  const match = modulePattern.exec(content);
  if (match) {
    // Add to existing import
    const existingImports = match[2].trim();
    const newImports = existingImports ? `${existingImports}, ${importName}` : importName;
    return content.replace(
      modulePattern,
      `import { ${newImports} } from '${importPath}'`
    );
  }

  // Add new import after first import statement
  const firstImportIndex = content.indexOf('import ');
  if (firstImportIndex === -1) {
    // No imports yet, add at top
    return `import { ${importName} } from '${importPath}';\n${content}`;
  }

  const firstImportEnd = content.indexOf('\n', firstImportIndex);
  return (
    content.slice(0, firstImportEnd + 1) +
    `import { ${importName} } from '${importPath}';\n` +
    content.slice(firstImportEnd + 1)
  );
}

function extractHandlerBody(content, method) {
  // Match: export async function METHOD(req, ...) {
  const handlerRegex = new RegExp(
    `(export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*\\{)`,
    'g'
  );

  const match = handlerRegex.exec(content);
  if (!match) return null;

  const start = match.index;
  const bodyStart = match.index + match[0].length;

  // Find matching closing brace
  let depth = 1;
  let i = bodyStart;
  while (i < content.length && depth > 0) {
    if (content[i] === '{') depth++;
    if (content[i] === '}') depth--;
    i++;
  }

  return {
    start,
    end: i,
    signature: match[0],
    body: content.substring(bodyStart, i - 1),
  };
}

function hasRlsWrapper(body) {
  return /\b(withTenantRls|withPlatformAdmin|withSystemJob|withWebhookTenant)\s*\(/.test(body);
}

function hasDatabaseOperations(body) {
  const patterns = [
    /\bprisma\.\$queryRaw/,
    /\bprisma\.\$executeRaw/,
    /\bprisma\.\w+\.find/,
    /\bprisma\.\w+\.create/,
    /\bprisma\.\w+\.update/,
    /\bprisma\.\w+\.upsert/,
    /\bprisma\.\w+\.delete/,
    /\bprisma\.\w+\.count/,
  ];
  return patterns.some(p => p.test(body));
}

function migrateHandler(content, method) {
  const handler = extractHandlerBody(content, method);
  if (!handler) return content;

  const { start, end, signature, body } = handler;

  // Skip if already wrapped
  if (hasRlsWrapper(body)) {
    console.log(`  ⊘ ${method} handler already uses RLS wrapper`);
    return content;
  }

  // Skip if no database operations
  if (!hasDatabaseOperations(body)) {
    console.log(`  ⊘ ${method} handler has no database operations`);
    return content;
  }

  console.log(`  ✓ Migrating ${method} handler...`);

  // Extract auth check (should already exist)
  const authCheckMatch = body.match(
    /const\s+(\w+)\s+=\s+requireAuthorizedTenant\([^)]*\);[\s\S]*?const\s+\{\s*tenantId[^}]*\}\s+=\s+\1;/
  );

  if (!authCheckMatch) {
    console.log(`  ⚠ ${method} handler missing requireAuthorizedTenant - manual fix required`);
    return content;
  }

  const authCheckEnd = body.indexOf(authCheckMatch[0]) + authCheckMatch[0].length;
  const beforeAuth = body.substring(0, authCheckEnd);
  let afterAuth = body.substring(authCheckEnd).trim();

  // Add body sanitization for mutations
  if (MUTATION_METHODS.includes(method)) {
    const hasBodyJson = /const\s+body\s+=\s+await\s+req\.json\(\)/.test(afterAuth);
    const hasSanitization = /stripTenantOwnershipFields/.test(afterAuth);

    if (hasBodyJson && !hasSanitization) {
      afterAuth = afterAuth.replace(
        /const\s+body\s+=\s+await\s+req\.json\(\);/,
        `const bodyRaw = await req.json();\n  const body = stripTenantOwnershipFields(bodyRaw);`
      );
      console.log(`    → Added body sanitization`);
    }
  }

  // Wrap remaining code in withTenantRls
  const indentedAfterAuth = afterAuth
    .split('\n')
    .map(line => (line.trim() ? '    ' + line : line))
    .join('\n');

  const wrappedBody = `${beforeAuth}

  return withTenantRls(prisma, tenantId, async (tx) => {
${indentedAfterAuth}
  });`;

  // Replace 'prisma' with 'tx' inside wrapper
  const finalBody = wrappedBody.replace(/\bprisma\./g, 'tx.');

  console.log(`    → Wrapped in withTenantRls()`);
  console.log(`    → Replaced 'prisma' with 'tx'`);

  // Replace handler in content
  return (
    content.substring(0, start) +
    signature +
    '\n' +
    finalBody +
    '\n}\n' +
    content.substring(end)
  );
}

function migrateRoute(filePath, dryRun = false) {
  console.log(`\n📁 Processing: ${filePath}`);

  if (!fs.existsSync(filePath)) {
    console.error(`❌ File not found: ${filePath}`);
    return false;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  const originalContent = content;

  // Add imports
  content = addImportIfMissing(content, 'withTenantRls', '@/lib/rls');
  content = addImportIfMissing(content, 'stripTenantOwnershipFields', '@/lib/tenant-context');

  // Migrate each HTTP method handler
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  for (const method of methods) {
    content = migrateHandler(content, method);
  }

  // Check if any changes were made
  if (content === originalContent) {
    console.log('⊘ No changes needed');
    return false;
  }

  if (dryRun) {
    console.log('\n📄 Dry-run mode - changes not saved');
    console.log('─'.repeat(60));
    console.log(content);
    console.log('─'.repeat(60));
    return true;
  }

  // Create backup
  backup(filePath);

  // Write migrated file
  fs.writeFileSync(filePath, content, 'utf8');
  console.log(`✅ Migration complete: ${filePath}`);
  console.log('⚠️  Manual review required - test the route before committing');

  return true;
}

function migrateBatch(pattern, dryRun = false) {
  const glob = require('glob');
  const files = glob.sync(pattern);

  console.log(`\n🔄 Batch migration: ${files.length} files matching "${pattern}"\n`);

  let successCount = 0;
  for (const file of files) {
    if (migrateRoute(file, dryRun)) {
      successCount++;
    }
  }

  console.log(`\n✅ Migrated ${successCount} of ${files.length} files`);
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const batch = args.includes('--batch');

  const targetArgs = args.filter(a => !a.startsWith('--'));

  if (targetArgs.length === 0) {
    console.log(`
Automated Route Migration Script

Usage:
  Single file:
    node scripts/migrate-route-to-rls.js <route-file> [--dry-run]

  Batch (glob pattern):
    node scripts/migrate-route-to-rls.js --batch "src/app/api/fleet/**/*.ts" [--dry-run]

Examples:
  node scripts/migrate-route-to-rls.js src/app/api/fleet/vehicles/route.ts
  node scripts/migrate-route-to-rls.js --batch "src/app/api/fleet/**/*.ts"
  node scripts/migrate-route-to-rls.js --batch "src/app/api/fleet/**/*.ts" --dry-run

Flags:
  --dry-run    Show changes without saving
  --batch      Process multiple files with glob pattern
`);
    process.exit(0);
  }

  if (batch) {
    migrateBatch(targetArgs[0], dryRun);
  } else {
    migrateRoute(targetArgs[0], dryRun);
  }
}

main();
