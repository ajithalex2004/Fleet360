#!/usr/bin/env node
/**
 * Final fix for remaining 14 body sanitization violations
 */

const fs = require('fs');
const path = require('path');

const FILES_TO_FIX = [
  'src/app/api/agents/thresholds/route.ts',
  'src/app/api/carrier-portal/app/loads/[id]/documents/route.ts',
  'src/app/api/driver-app/behavior-events/route.ts',
  'src/app/api/driver-app/dvir/route.ts',
  'src/app/api/driver-app/expenses/route.ts',
  'src/app/api/driver-app/fuel-entries/route.ts',
  'src/app/api/driver-app/shift/current/route.ts',
  'src/app/api/driver-app/shift/[id]/checklist/route.ts',
  'src/app/api/driver-app/trips/[id]/end/route.ts',
  'src/app/api/driver-app/trips/[id]/start/route.ts',
  'src/app/api/shipper-portal/me/route.ts',
  'src/app/api/shipper-portal/shipments/route.ts',
  'src/app/api/shipper-portal/shipments/[id]/route.ts',
  'src/app/api/whatsapp/send/route.ts',
];

function ensureImport(content) {
  if (!content.includes('stripTenantOwnershipFields')) {
    const importMatch = content.match(/import\s+{([^}]+)}\s+from\s+['"]@\/lib\/tenant-context['"]/);
    if (importMatch) {
      const imports = importMatch[1].trim();
      if (!imports.includes('stripTenantOwnershipFields')) {
        const newImports = imports + ', stripTenantOwnershipFields';
        content = content.replace(
          /import\s+{[^}]+}\s+from\s+['"]@\/lib\/tenant-context['"]/,
          `import { ${newImports} } from '@/lib/tenant-context'`
        );
      }
    }
  }
  return content;
}

function fixFile(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fs.existsSync(fullPath)) {
    return { status: 'not_found' };
  }

  let content = fs.readFileSync(fullPath, 'utf8');

  if (/stripTenantOwnershipFields\s*\(/.test(content)) {
    return { status: 'already_fixed' };
  }

  if (!/await\s+req\.json\(\)/.test(content)) {
    return { status: 'no_body_parsing' };
  }

  const originalContent = content;
  content = ensureImport(content);

  let modified = false;

  // Pattern: const { field1, field2 } = await req.json() as Type;
  if (/const\s+\{[^}]+\}\s*=\s*await\s+req\.json\(\)\s*as\s+\{/.test(content)) {
    content = content.replace(
      /const\s+(\{[^}]+\})\s*=\s*await\s+req\.json\(\)\s*as\s+(\{[^}]+\})\s*;/gs,
      (match, destructure, typeAnnotation) => {
        return `const bodyRaw = await req.json() as ${typeAnnotation};\n    const body = stripTenantOwnershipFields(bodyRaw);\n    const ${destructure} = body;`;
      }
    );
    modified = true;
  }

  // Pattern: const json = await req.json().catch(() => null);
  if (!modified && /const\s+(\w+)\s*=\s*await\s+req\.json\(\)\.catch\(.+?\)\s*;/.test(content)) {
    content = content.replace(
      /const\s+(\w+)\s*=\s*await\s+req\.json\(\)\.catch\((.+?)\)\s*;/g,
      (match, varName, catchHandler) => {
        return `const ${varName}Raw = await req.json().catch(${catchHandler});\n    const ${varName} = ${varName}Raw ? stripTenantOwnershipFields(${varName}Raw) : null;`;
      }
    );
    modified = true;
  }

  // Pattern: const data = await req.json();
  if (!modified && /const\s+(\w+)\s*=\s*await\s+req\.json\(\)\s*;/.test(content)) {
    content = content.replace(
      /const\s+(\w+)\s*=\s*await\s+req\.json\(\)\s*;/g,
      (match, varName) => {
        return `const ${varName}Raw = await req.json();\n    const ${varName} = stripTenantOwnershipFields(${varName}Raw);`;
      }
    );
    modified = true;
  }

  if (modified && content !== originalContent) {
    const backupPath = fullPath + '.bak-final-fix';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, originalContent);
    }

    fs.writeFileSync(fullPath, content, 'utf8');
    return { status: 'fixed' };
  }

  return { status: 'no_match' };
}

async function main() {
  console.log('🔧 Fixing final 14 body sanitization violations...\n');

  const results = {
    fixed: [],
    already_fixed: [],
    no_body_parsing: [],
    no_match: [],
    not_found: [],
  };

  for (const file of FILES_TO_FIX) {
    const result = fixFile(file);
    results[result.status].push(file);

    const icon = {
      fixed: '✅',
      already_fixed: '✓',
      no_body_parsing: '⊘',
      no_match: '⚠️',
      not_found: '⏭️',
    }[result.status];

    console.log(`${icon} ${result.status.padEnd(20)} ${file}`);
  }

  console.log('\n' + '='.repeat(70));
  console.log('FINAL RESULTS');
  console.log('='.repeat(70));
  console.log(`✅ Fixed:           ${results.fixed.length}`);
  console.log(`✓  Already fixed:   ${results.already_fixed.length}`);
  console.log(`⊘  No body parsing: ${results.no_body_parsing.length}`);
  console.log(`⚠️  No match:        ${results.no_match.length}`);
  console.log(`⏭️  Not found:       ${results.not_found.length}`);
  console.log(`📊 Total:           ${FILES_TO_FIX.length}`);
  console.log('='.repeat(70));

  if (results.fixed.length > 0) {
    console.log('\n💾 Backups created with .bak-final-fix extension');
    console.log('\n🔍 Run validation: node scripts/check-tenant-rls.js');
  }

  if (results.no_match.length > 0) {
    console.log('\n⚠️  Files needing manual review:');
    results.no_match.forEach(f => console.log(`   ${f}`));
  }
}

main().catch(console.error);
