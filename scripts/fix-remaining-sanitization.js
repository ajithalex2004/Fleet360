#!/usr/bin/env node
/**
 * Manual Body Sanitization Fixer - Phase 2
 * Handles edge cases that the automated script couldn't fix
 */

const fs = require('fs');
const path = require('path');

// Routes with body sanitization violations
const violations = [
  { file: 'src/app/api/admin/customers/[id]/portal-invitations/route.ts', handler: 'POST' },
  { file: 'src/app/api/admin/events/outbox/replay/route.ts', handler: 'POST' },
  { file: 'src/app/api/admin/impersonate/route.ts', handler: 'POST' },
  { file: 'src/app/api/admin/nav-permissions/route.ts', handler: 'PUT' },
  { file: 'src/app/api/admin/notification-rules/route.ts', handler: 'POST' },
  { file: 'src/app/api/admin/notification-rules/route.ts', handler: 'PUT' },
  { file: 'src/app/api/admin/notification-templates/route.ts', handler: 'POST' },
  { file: 'src/app/api/admin/notification-templates/route.ts', handler: 'PUT' },
];

function fixBodySanitization(filePath, handler) {
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⏭️  Skip: ${filePath} (not found)`);
    return false;
  }

  let content = fs.readFileSync(fullPath, 'utf8');
  let modified = false;

  // Pattern 1: const body = await req.json().catch(() => ({}));
  const pattern1 = /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\([^)]+\);?/g;
  if (pattern1.test(content)) {
    content = content.replace(
      /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\(([^)]+)\);?/g,
      'const bodyRaw = await req.json().catch($1);\n  const body = stripTenantOwnershipFields(bodyRaw);'
    );
    modified = true;
  }

  // Pattern 2: const body = await req.json().catch(() => ({})) as Type;
  const pattern2 = /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\([^)]+\)\s*as\s+[^;]+;/g;
  if (!modified && pattern2.test(content)) {
    content = content.replace(
      /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\(([^)]+)\)\s*as\s+([^;]+);/g,
      'const bodyRaw = await req.json().catch($1) as $2;\n  const body = stripTenantOwnershipFields(bodyRaw);'
    );
    modified = true;
  }

  // Pattern 3: const { field1, field2 } = await req.json();
  const pattern3 = /const\s*{[^}]+}\s*=\s*await\s+req\.json\(\);?/g;
  if (!modified && pattern3.test(content)) {
    // For destructured patterns, we need to keep the original variable name
    content = content.replace(
      /const\s*({[^}]+})\s*=\s*await\s+req\.json\(\);?/g,
      'const bodyRaw = await req.json();\n  const body = stripTenantOwnershipFields(bodyRaw);\n  const $1 = body;'
    );
    modified = true;
  }

  if (modified) {
    // Ensure stripTenantOwnershipFields is imported
    if (!content.includes('stripTenantOwnershipFields')) {
      // Find tenant-context import and add it
      const importMatch = content.match(/import\s+{([^}]+)}\s+from\s+['"]@\/lib\/tenant-context['"]/);
      if (importMatch) {
        const imports = importMatch[1].trim();
        const newImports = imports + ', stripTenantOwnershipFields';
        content = content.replace(
          /import\s+{[^}]+}\s+from\s+['"]@\/lib\/tenant-context['"]/,
          `import { ${newImports} } from '@/lib/tenant-context'`
        );
      }
    }

    // Create backup
    const backupPath = fullPath + '.bak-manual';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, fs.readFileSync(fullPath));
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    console.log(`✅ Fixed: ${filePath}`);
    return true;
  }

  console.log(`⚠️  Skip: ${filePath} (no matching pattern)`);
  return false;
}

async function main() {
  console.log('🔧 Fixing remaining body sanitization violations...\n');

  let fixed = 0;
  const uniqueFiles = [...new Set(violations.map(v => v.file))];

  for (const file of uniqueFiles) {
    const handlers = violations.filter(v => v.file === file).map(v => v.handler);
    if (fixBodySanitization(file, handlers[0])) {
      fixed++;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✅ Fixed: ${fixed} files`);
  console.log(`⏭️  Skipped: ${uniqueFiles.length - fixed} files`);
  console.log('='.repeat(60));

  if (fixed > 0) {
    console.log('\n💾 Backups created with .bak-manual extension');
    console.log('🔍 Run: node scripts/check-tenant-rls.js');
  }
}

main().catch(console.error);
