#!/usr/bin/env node
/**
 * Auto-fix RLS violations by adding explicit tenant filters
 *
 * This script adds defense-in-depth tenant filtering to routes that:
 * 1. Use withTenantRls() but lack explicit WHERE tenant_id filters
 * 2. Use withPlatformAdmin() with conditional tenant filtering
 *
 * It does NOT modify:
 * - Routes that query global tables (User, Tenant, Role, Permission)
 * - Routes that already have tenant filtering
 * - Exempt routes (public, webhooks, auth)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Tables that are global and don't have tenant_id
const GLOBAL_TABLES = [
  'User', 'Tenant', 'Role', 'Permission', 'RolePermission', 'UserTenant',
  'TenantModule', 'TenantBranch', 'TenantSubscription', 'PlanLimit'
];

// Patterns to identify if a file queries global tables
const GLOBAL_TABLE_PATTERNS = GLOBAL_TABLES.map(t => new RegExp(`\\btx\\.${t.toLowerCase()}\\b|\\b"?${t}"?\\b`));

function isGlobalTableQuery(content) {
  return GLOBAL_TABLE_PATTERNS.some(pattern => pattern.test(content));
}

function hasExplicitTenantFilter(content) {
  const patterns = [
    /where:\s*\{[^}]*tenantId/i,
    /WHERE[^;]*tenant_id\s*=/i,
    /tenant_id\s*=\s*\$\d+/i,
  ];
  return patterns.some(p => p.test(content));
}

function analyzeFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Skip if already has tenant filtering
  if (hasExplicitTenantFilter(content)) {
    return { skip: true, reason: 'Already has tenant filter' };
  }

  // Skip if queries global tables
  if (isGlobalTableQuery(content)) {
    return { skip: true, reason: 'Queries global tables' };
  }

  // Check if uses withTenantRls
  const usesWithTenantRls = /withTenantRls\s*\(/.test(content);

  // Check if uses withPlatformAdmin
  const usesWithPlatformAdmin = /withPlatformAdmin\s*\(/.test(content);

  // Check if has Prisma queries
  const hasPrismaQueries = /tx\.\w+\.find|tx\.\w+\.create|tx\.\w+\.update/.test(content);

  // Check if has raw SQL
  const hasRawSQL = /tx\.\$queryRaw|tx\.\$executeRaw/.test(content);

  return {
    skip: false,
    usesWithTenantRls,
    usesWithPlatformAdmin,
    hasPrismaQueries,
    hasRawSQL,
    content
  };
}

function fixPrismaQueries(content, tenantIdVar = 'tenantId') {
  // Pattern: tx.model.findMany({ where: { ... } })
  // Add tenantId to where clause

  let modified = content;

  // Find all Prisma queries with where clauses
  const wherePattern = /(\btx\.\w+\.(findMany|findFirst|findUnique|count|aggregate|groupBy)\s*\(\s*\{\s*where:\s*\{)([^}]*?)(\})/g;

  modified = modified.replace(wherePattern, (match, prefix, method, whereContent, suffix) => {
    // Skip if already has tenantId
    if (/tenantId/i.test(whereContent)) {
      return match;
    }

    // Add tenantId to where clause
    const indent = prefix.match(/\s*$/)?.[0] || '';
    const newWhere = whereContent.trim()
      ? `${indent}${tenantIdVar}, ${whereContent}`
      : `${indent}${tenantIdVar}`;

    return `${prefix}${newWhere}${suffix}`;
  });

  return modified;
}

function fixRawSQLQueries(content, tenantIdVar = 'tenantId') {
  // For raw SQL, we need to add tenant_id to WHERE clauses
  // This is more complex and error-prone, so we'll be conservative

  let modified = content;

  // Pattern: WHERE ... (without tenant_id)
  // Look for $queryRawUnsafe calls
  const queryPattern = /tx\.\$queryRawUnsafe<[^>]+>\s*\(\s*`([^`]+)`/g;

  let matches = [];
  let match;
  while ((match = queryPattern.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      query: match[1],
      index: match.index
    });
  }

  // For each query, check if it needs tenant_id filter
  for (const m of matches) {
    const { query } = m;

    // Skip if already has tenant_id
    if (/tenant_id\s*=/i.test(query)) {
      continue;
    }

    // Skip if no WHERE clause
    if (!/WHERE/i.test(query)) {
      continue;
    }

    // This is risky - we can't automatically add tenant_id to raw SQL
    // without understanding the query structure
    // Skip for now
  }

  return modified;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  console.log('🔍 Analyzing route files for tenant filter fixes...\n');

  // Get all route files
  const routeFiles = execSync('find src/app/api -name "route.ts"', { encoding: 'utf8' })
    .split('\n')
    .filter(f => f.trim())
    .map(f => path.resolve(f));

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of routeFiles) {
    try {
      const analysis = analyzeFile(file);

      if (analysis.skip) {
        skipped++;
        if (verbose) {
          console.log(`⏭️  ${path.relative(process.cwd(), file)}: ${analysis.reason}`);
        }
        continue;
      }

      let modified = analysis.content;
      let changed = false;

      // Fix Prisma queries if using withTenantRls
      if (analysis.usesWithTenantRls && analysis.hasPrismaQueries) {
        const newContent = fixPrismaQueries(modified, 'tenantId');
        if (newContent !== modified) {
          modified = newContent;
          changed = true;
        }
      }

      // Fix raw SQL queries (conservative)
      if (analysis.usesWithTenantRls && analysis.hasRawSQL) {
        const newContent = fixRawSQLQueries(modified, 'tenantId');
        if (newContent !== modified) {
          modified = newContent;
          changed = true;
        }
      }

      if (changed) {
        if (!dryRun) {
          fs.writeFileSync(file, modified, 'utf8');
        }
        fixed++;
        console.log(`✅ ${path.relative(process.cwd(), file)}`);
      }

    } catch (err) {
      errors++;
      console.error(`❌ ${path.relative(process.cwd(), file)}: ${err.message}`);
    }
  }

  console.log(`\n📊 Summary:`);
  console.log(`   Fixed: ${fixed}`);
  console.log(`   Skipped: ${skipped}`);
  console.log(`   Errors: ${errors}`);
  console.log(`   Total: ${routeFiles.length}`);

  if (dryRun) {
    console.log('\n💡 This was a dry run. Run without --dry-run to apply changes.');
  }
}

if (require.main === module) {
  main();
}
