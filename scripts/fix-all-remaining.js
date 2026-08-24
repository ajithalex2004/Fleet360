#!/usr/bin/env node
/**
 * Fix all remaining body sanitization violations
 * Handles complex parsing patterns including .catch(), try/catch, etc.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_TO_FIX = [
  // Complex parsing (30 routes)
  'src/app/api/admin/customers/[id]/portal-invitations/route.ts',
  'src/app/api/admin/service-config/categories/route.ts',
  'src/app/api/admin/service-config/categories/[id]/route.ts',
  'src/app/api/admin/service-config/types/route.ts',
  'src/app/api/admin/service-config/types/[id]/module-mapping/route.ts',
  'src/app/api/admin/service-config/types/[id]/route.ts',
  'src/app/api/agents/route-results/[id]/apply/route.ts',
  'src/app/api/bus-ops/planning/optimize/route.ts',
  'src/app/api/bus-ops/planning-constraints/route.ts',
  'src/app/api/bus-ops/planning-constraints/[id]/route.ts',
  'src/app/api/bus-ops/route-passengers/bulk-import/route.ts',
  'src/app/api/bus-ops/routes/bulk-import/route.ts',
  'src/app/api/dispatch/jobs/[id]/reassign/route.ts',
  'src/app/api/driver-app/behavior-events/route.ts',
  'src/app/api/driver-app/dvir/route.ts',
  'src/app/api/driver-app/expenses/route.ts',
  'src/app/api/driver-app/fuel-entries/route.ts',
  'src/app/api/driver-app/reports/route.ts',
  'src/app/api/driver-app/shift/current/route.ts',
  'src/app/api/driver-app/shift/[id]/checklist/route.ts',
  'src/app/api/driver-app/trips/[id]/end/route.ts',
  'src/app/api/driver-app/trips/[id]/start/route.ts',
  'src/app/api/leasing/drivers/allocations/[allocationId]/release/route.ts',
  'src/app/api/leasing/quotations/[id]/submit/route.ts',
  'src/app/api/push/test/route.ts',
  'src/app/api/rental/agreements/[id]/generate-invoice/route.ts',
  'src/app/api/rental/invoices/[id]/send/route.ts',
  'src/app/api/service-tickets/route.ts',
  'src/app/api/service-tickets/[id]/route.ts',
  'src/app/api/whatsapp/send/route.ts',
  // Manual review (13 routes)
  'src/app/api/admin/tenants/[id]/modules/route.ts',
  'src/app/api/admin/tenants/[id]/route.ts',
  'src/app/api/agents/thresholds/route.ts',
  'src/app/api/dispatch/location/route.ts',
  'src/app/api/dispatch/merge-candidates/route.ts',
  'src/app/api/dispatch/merge-suggestions/route.ts',
  'src/app/api/incidents/[id]/notes/route.ts',
  'src/app/api/leasing/credit-assessments/[id]/route.ts',
  'src/app/api/leasing/direct-debits/[id]/route.ts',
  'src/app/api/leasing/insurance/[id]/route.ts',
  'src/app/api/logistics/shipping-requests/[id]/accept/route.ts',
  'src/app/api/logistics/shipping-requests/[id]/convert/route.ts',
  'src/app/api/quotations/route.ts',
];

function ensureImport(content) {
  if (!content.includes('stripTenantOwnershipFields')) {
    // Find tenant-context import
    const importMatch = content.match(/import\s+{([^}]+)}\s+from\s+['"]@\/lib\/tenant-context['"]/);
    if (importMatch) {
      const imports = importMatch[1].trim();
      const newImports = imports.includes('stripTenantOwnershipFields')
        ? imports
        : imports + ', stripTenantOwnershipFields';
      content = content.replace(
        /import\s+{[^}]+}\s+from\s+['"]@\/lib\/tenant-context['"]/,
        `import { ${newImports} } from '@/lib/tenant-context'`
      );
    }
  }
  return content;
}

function fixBodyParsing(content) {
  let modified = false;

  // Pattern 1: const body = await req.json().catch(() => ({}));
  if (/const\s+body\s*=\s*await\s+req\.json\(\)\.catch\([^)]+\)\s*;/.test(content)) {
    content = content.replace(
      /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\(([^)]+)\)\s*;/g,
      'const bodyRaw = await req.json().catch($1);\n  const body = stripTenantOwnershipFields(bodyRaw);'
    );
    modified = true;
  }

  // Pattern 2: const body = await req.json().catch(() => ({})) as Type; (multiline)
  if (!modified && /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\([^)]+\)\s*as\s+/.test(content)) {
    content = content.replace(
      /const\s+body\s*=\s*await\s+req\.json\(\)\.catch\(([^)]+)\)\s*as\s+([^;]+);/gs,
      'const bodyRaw = await req.json().catch($1) as $2;\n  const body = stripTenantOwnershipFields(bodyRaw);'
    );
    modified = true;
  }

  // Pattern 3: try { const body = await req.json(); } catch
  if (!modified && /try\s*{\s*const\s+body\s*=\s*await\s+req\.json\(\)/.test(content)) {
    content = content.replace(
      /try\s*{\s*const\s+body\s*=\s*await\s+req\.json\(\)\s*;/g,
      'try { const bodyRaw = await req.json();\n    const body = stripTenantOwnershipFields(bodyRaw);'
    );
    modified = true;
  }

  // Pattern 4: const body = (await req.json()) as Type;
  if (!modified && /const\s+body\s*=\s*\(\s*await\s+req\.json\(\)\s*\)\s*as\s+/.test(content)) {
    content = content.replace(
      /const\s+body\s*=\s*\(\s*await\s+req\.json\(\)\s*\)\s*as\s+([^;]+);/gs,
      'const bodyRaw = (await req.json()) as $1;\n  const body = stripTenantOwnershipFields(bodyRaw);'
    );
    modified = true;
  }

  // Pattern 5: let body; try { body = await req.json(); }
  if (!modified && /let\s+body\s*;\s*try\s*{\s*body\s*=\s*await\s+req\.json/.test(content)) {
    content = content.replace(
      /let\s+body\s*;\s*try\s*{\s*body\s*=\s*await\s+req\.json\(\)/g,
      'let bodyRaw;\n  let body;\n  try { bodyRaw = await req.json(); body = stripTenantOwnershipFields(bodyRaw)'
    );
    modified = true;
  }

  return { content, modified };
}

function fixRoute(filePath) {
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fs.existsSync(fullPath)) {
    console.log(`⏭️  Skip: ${filePath} (not found)`);
    return false;
  }

  let content = fs.readFileSync(fullPath, 'utf8');

  // Skip if already sanitized
  if (/stripTenantOwnershipFields\s*\(/.test(content)) {
    console.log(`✓ Already fixed: ${filePath}`);
    return false;
  }

  // Ensure import
  content = ensureImport(content);

  // Fix body parsing
  const result = fixBodyParsing(content);

  if (result.modified) {
    // Create backup
    const backupPath = fullPath + '.bak-final';
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, fs.readFileSync(fullPath));
    }

    fs.writeFileSync(fullPath, result.content, 'utf8');
    console.log(`✅ Fixed: ${filePath}`);
    return true;
  }

  console.log(`⚠️  Skip: ${filePath} (no matching pattern)`);
  return false;
}

async function main() {
  console.log('🔧 Fixing remaining body sanitization violations...\n');
  console.log(`Total routes to fix: ${ROUTES_TO_FIX.length}\n`);

  let fixed = 0;
  let skipped = 0;
  let alreadyFixed = 0;

  for (const file of ROUTES_TO_FIX) {
    const result = fixRoute(file);
    if (result === true) {
      fixed++;
    } else if (result === false && fs.readFileSync(path.join(__dirname, '..', file), 'utf8').includes('stripTenantOwnershipFields')) {
      alreadyFixed++;
    } else {
      skipped++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('RESULTS');
  console.log('='.repeat(70));
  console.log(`✅ Fixed: ${fixed}`);
  console.log(`✓ Already fixed: ${alreadyFixed}`);
  console.log(`⚠️  Skipped: ${skipped}`);
  console.log(`📊 Total: ${ROUTES_TO_FIX.length}`);
  console.log('='.repeat(70));

  if (fixed > 0) {
    console.log('\n💾 Backups created with .bak-final extension');
    console.log('🔍 Run: node scripts/check-tenant-rls.js');
  }
}

main().catch(console.error);
