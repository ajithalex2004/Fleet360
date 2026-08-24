#!/usr/bin/env node
/**
 * Advanced Batch Fix for Tenant Authorization
 *
 * This script handles more complex patterns that the basic batch-fix missed:
 * - Routes with no auth at all
 * - Routes using withPlatformAdmin() that should use requireAuthorizedTenant()
 * - Routes with complex handler structures
 *
 * Usage:
 *   node scripts/batch-fix-tenant-auth-v2.js [--dry-run] [--file=path]
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXEMPT_PATTERNS = [
  /^src\/app\/api\/public\//,
  /^src\/app\/api\/webhooks\//,
  /^src\/app\/api\/auth\//,
  /^src\/app\/api\/health/,
  /^src\/app\/api\/cron\//,
];

function isExempt(filePath) {
  return EXEMPT_PATTERNS.some(pattern => pattern.test(filePath.replace(/\\/g, '/')));
}

function analyzeRoute(content) {
  // Check if route has requireAuthorizedTenant
  const hasImport = /import\s+\{[^}]*requireAuthorizedTenant[^}]*\}\s+from/.test(content);
  const hasCalls = /requireAuthorizedTenant\s*\(/.test(content);

  // Check for platform admin usage
  const usesPlatformAdmin = /withPlatformAdmin\s*\(/.test(content);

  // Check for manual header checks
  const hasManualCheck = /req\.headers\.get\s*\(\s*['"]x-tenant-id['"]\s*\)/.test(content);

  // Find exported handlers
  const handlers = [];
  const handlerRegex = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  let match;
  while ((match = handlerRegex.exec(content)) !== null) {
    handlers.push(match[1]);
  }

  return {
    hasImport,
    hasCalls,
    usesPlatformAdmin,
    hasManualCheck,
    handlers,
    needsFix: handlers.length > 0 && !hasCalls,
  };
}

function addImportIfMissing(content) {
  const hasImport = /import\s+\{[^}]*requireAuthorizedTenant[^}]*\}\s+from\s+['"]@\/lib\/tenant-context['"]/.test(content);

  if (hasImport) return content;

  // Find last import
  const importMatches = [...content.matchAll(/^import\s+.*from\s+['"][^'"]+['"];?\s*$/gm)];
  if (importMatches.length === 0) {
    // No imports, add after initial comments
    const lines = content.split('\n');
    let insertIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('/*') || lines[i].trim().startsWith('//') || lines[i].trim().startsWith('*')) {
        insertIndex = i + 1;
      } else if (lines[i].trim() === '') {
        continue;
      } else {
        break;
      }
    }
    lines.splice(insertIndex, 0, "import { requireAuthorizedTenant } from '@/lib/tenant-context';");
    return lines.join('\n');
  }

  const lastImport = importMatches[importMatches.length - 1];
  const insertPos = lastImport.index + lastImport[0].length;

  return content.slice(0, insertPos) +
         "\nimport { requireAuthorizedTenant } from '@/lib/tenant-context';" +
         content.slice(insertPos);
}

function addAuthToHandler(handlerCode, handlerName, indent = '  ') {
  // Check if handler already has requireAuthorizedTenant
  if (/requireAuthorizedTenant\s*\(/.test(handlerCode)) {
    return handlerCode;
  }

  // Find the opening brace and add auth check right after
  const braceMatch = handlerCode.match(/^(export\s+async\s+function\s+\w+\s*\([^)]*\)\s*\{)(.*)$/s);
  if (!braceMatch) return handlerCode;

  const [, signature, body] = braceMatch;

  const authCode = `
${indent}const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
${indent}if (!authz.ok) {
${indent}  return NextResponse.json({ error: authz.error }, { status: authz.status });
${indent}}
${indent}const { tenantId } = authz;
`;

  return signature + authCode + body;
}

function fixHandlers(content) {
  let modified = content;
  const handlers = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

  for (const method of handlers) {
    // Match handler with its full body
    const handlerRegex = new RegExp(
      `(export\\s+async\\s+function\\s+${method}\\s*\\([^)]*\\)\\s*\\{)([\\s\\S]*?)\\n\\}(?=\\s*(?:export|$|\\n\\n))`,
      'gm'
    );

    modified = modified.replace(handlerRegex, (match, signature, body) => {
      // Skip if already has auth
      if (/requireAuthorizedTenant\s*\(/.test(body)) {
        return match;
      }

      // Detect indent from first line of body
      const firstLineMatch = body.match(/\n(\s+)/);
      const indent = firstLineMatch ? firstLineMatch[1] : '  ';

      const authCode = `
${indent}const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
${indent}if (!authz.ok) {
${indent}  return NextResponse.json({ error: authz.error }, { status: authz.status });
${indent}}
${indent}const { tenantId } = authz;
`;

      return signature + authCode + body + '\n}';
    });
  }

  return modified;
}

function fixRouteFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(process.cwd(), filePath).replace(/\\/g, '/');

  if (isExempt(relativePath)) {
    return { changed: false, reason: 'exempt' };
  }

  const analysis = analyzeRoute(content);

  if (!analysis.needsFix) {
    return { changed: false, reason: 'already-compliant' };
  }

  let modified = content;
  const changes = [];

  // Step 1: Add import
  if (!analysis.hasImport) {
    modified = addImportIfMissing(modified);
    changes.push('Added requireAuthorizedTenant import');
  }

  // Step 2: Add auth checks to handlers
  modified = fixHandlers(modified);
  if (modified !== content) {
    changes.push(`Added auth checks to ${analysis.handlers.join(', ')} handlers`);
  }

  return {
    changed: modified !== content,
    modified,
    changes,
    reason: changes.length > 0 ? 'fixed' : 'no-changes',
  };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const fileArg = args.find(a => a.startsWith('--file='));
  const singleFile = fileArg ? fileArg.split('=')[1] : null;

  console.log('🔧 Advanced batch fix for tenant authorization...\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'WRITE'}\n`);

  let files;
  if (singleFile) {
    files = [path.resolve(singleFile)];
  } else {
    files = execSync(`find src/app/api -name "route.ts" -type f`, { encoding: 'utf8' })
      .split('\n')
      .filter(f => f.trim())
      .map(f => path.resolve(f));
  }

  let fixedCount = 0;
  let exemptCount = 0;
  let compliantCount = 0;
  const fixedFiles = [];

  for (const file of files) {
    const result = fixRouteFile(file);

    if (result.reason === 'exempt') {
      exemptCount++;
      continue;
    }

    if (result.reason === 'already-compliant') {
      compliantCount++;
      continue;
    }

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
    }
  }

  console.log('\n' + '━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total files:      ${files.length}`);
  console.log(`Fixed:            ${fixedCount}`);
  console.log(`Already compliant:${compliantCount}`);
  console.log(`Exempt:           ${exemptCount}`);
  console.log('━'.repeat(60));

  if (dryRun && fixedCount > 0) {
    console.log('\n⚠️  DRY RUN MODE - No files were modified');
    console.log('Remove --dry-run flag to apply changes\n');
  } else if (fixedCount > 0) {
    console.log('\n✅ Files have been updated!');
    console.log('\nRun: npm run tenant:check-auth\n');
  } else {
    console.log('\n✅ No changes needed!\n');
  }
}

main();
