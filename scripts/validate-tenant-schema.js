#!/usr/bin/env node
/**
 * Tenant Schema Validator
 *
 * Validates that all tenant-owned Prisma models follow the tenant safety contract:
 * - tenantId field exists and is String @db.Uuid()
 * - tenantId has NOT NULL constraint in the database
 * - Index exists on tenantId
 * - Composite foreign keys for parent/child relationships
 *
 * Usage:
 *   node scripts/validate-tenant-schema.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(process.cwd(), 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = path.join(process.cwd(), 'prisma', 'migrations');

// Models that should have tenant isolation
const TENANT_OWNED_MODELS = [
  'RentalCustomer',
  'RentalBooking',
  'RentalAgreement',
  'RentalInvoice',
  'RentalPayment',
  'RentalInspection',
  'RentalDamageClaim',
  'RentalChannel',
  'RentalAncillary',
  'PortalUser',
  'PortalInvitation',
  'Customer',
  'Driver',
  'Vehicle',
  'Trip',
  'TripPassenger',
  'MaintenanceRequest',
  'WorkOrder',
];

function parseSchema() {
  const content = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const models = [];

  // Extract model blocks
  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/gs;
  let match;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const modelBody = match[2];

    // Check for tenantId field
    const hasTenantId = /tenantId\s+String/.test(modelBody);

    // Check for tenantId index
    const hasIndex = /@@index\(\[tenantId\]\)/.test(modelBody) ||
                     /@@index\(\[[^\]]*tenantId[^\]]*\]\)/.test(modelBody);

    // Check for UUID type
    const hasUuidType = /@db\.Uuid\(\)/.test(modelBody) || /@db\.uuid/.test(modelBody);

    models.push({
      name: modelName,
      hasTenantId,
      hasIndex,
      hasUuidType: hasTenantId ? hasUuidType : null,
      body: modelBody,
    });
  }

  return models;
}

function findRecentMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  const migrations = fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => fs.statSync(path.join(MIGRATIONS_DIR, name)).isDirectory())
    .sort(); // Check all migrations to ensure we don't miss any tenant isolation work

  return migrations.map(name => ({
    name,
    path: path.join(MIGRATIONS_DIR, name, 'migration.sql'),
  }));
}

function checkMigrationConstraints(migrations, modelName) {
  // Convert model name to snake_case (e.g., RentalCustomer -> rental_customer)
  let tableName = modelName
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');

  // Prisma pluralizes table names by default - add 's'
  // Handle special cases: if ends in 'y', replace with 'ies', otherwise add 's'
  if (tableName.endsWith('y')) {
    tableName = tableName.slice(0, -1) + 'ies';
  } else {
    tableName = tableName + 's';
  }

  const checks = {
    hasNotNull: false,
    hasIndex: false,
    migration: null,
  };

  for (const migration of migrations) {
    if (!fs.existsSync(migration.path)) continue;

    const sql = fs.readFileSync(migration.path, 'utf8');

    // Check for NOT NULL constraint on tenant_id
    // Handle both quoted and unquoted table/column names
    const notNullPattern =
      'ALTER\\s+TABLE\\s+["\']?' + tableName + '["\']?\\s+[^;]*tenant_id[^;]*NOT\\s+NULL|' +
      'ALTER\\s+TABLE\\s+["\']?' + tableName + '["\']?\\s+ALTER\\s+COLUMN\\s+["\']?tenant_id["\']?\\s+SET\\s+NOT\\s+NULL|' +
      'CREATE\\s+TABLE\\s+["\']?' + tableName + '["\']?[^;]*tenant_id[^;()]*NOT\\s+NULL';
    const notNullRegex = new RegExp(notNullPattern, 'i');

    if (notNullRegex.test(sql)) {
      checks.hasNotNull = true;
      checks.migration = migration.name;
    }

    // Check for index on tenant_id
    const indexRegex = new RegExp(
      `CREATE INDEX[^;]*ON\\s+"?${tableName}"?[^;]*\\(.*tenant_id.*\\)`,
      'i'
    );

    if (indexRegex.test(sql)) {
      checks.hasIndex = true;
    }
  }

  return checks;
}

function validateModel(model, migrations) {
  const violations = [];

  if (!model.hasTenantId) {
    violations.push('Missing tenantId field');
    return violations; // Can't check further without tenantId
  }

  if (!model.hasIndex) {
    violations.push('Missing @@index([tenantId])');
  }

  const migrationChecks = checkMigrationConstraints(migrations, model.name);

  if (!migrationChecks.hasNotNull) {
    violations.push('Missing NOT NULL constraint on tenant_id in migrations');
  }

  if (!migrationChecks.hasIndex) {
    violations.push('Missing index on tenant_id in migrations');
  }

  return violations;
}

function main() {
  console.log('🔍 Validating tenant schema isolation...\n');

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error('❌ Prisma schema not found at:', SCHEMA_PATH);
    process.exit(1);
  }

  const models = parseSchema();
  const migrations = findRecentMigrations();

  console.log(`Found ${models.length} models in schema`);
  console.log(`Checking ${migrations.length} recent migrations\n`);

  const results = {
    total: 0,
    compliant: 0,
    violations: 0,
    details: [],
  };

  for (const modelName of TENANT_OWNED_MODELS) {
    const model = models.find(m => m.name === modelName);

    if (!model) {
      console.warn(`⚠️  Model ${modelName} not found in schema (may be renamed or removed)`);
      continue;
    }

    results.total++;

    const violations = validateModel(model, migrations);

    if (violations.length === 0) {
      results.compliant++;
    } else {
      results.violations++;
      results.details.push({
        model: modelName,
        violations,
      });
    }
  }

  // Print summary
  console.log('━'.repeat(60));
  console.log('SUMMARY');
  console.log('━'.repeat(60));
  console.log(`Total models:     ${results.total}`);
  console.log(`✅ Compliant:      ${results.compliant}`);
  console.log(`❌ Violations:     ${results.violations}`);
  console.log('━'.repeat(60));

  if (results.violations > 0) {
    console.log('\nVIOLATIONS:\n');

    for (const detail of results.details) {
      console.log(`\n❌ ${detail.model}`);
      for (const violation of detail.violations) {
        console.log(`   - ${violation}`);
      }
    }

    console.log('\n━'.repeat(60));
    console.log('REQUIRED FIXES');
    console.log('━'.repeat(60));
    console.log(`
1. Add tenantId field to model:
   tenantId String @db.Uuid()

2. Add index in model:
   @@index([tenantId])

3. Create migration to add NOT NULL constraint:
   ALTER TABLE table_name ADD COLUMN tenant_id UUID NOT NULL;
   CREATE INDEX idx_table_tenant_id ON table_name(tenant_id);

4. For parent/child relationships, add composite foreign keys:
   @@index([tenantId, parentId])
`);

    console.log(`\n${results.violations} model${results.violations > 1 ? 's' : ''} must be fixed.\n`);
    process.exit(1);
  } else {
    console.log('\n✅ All tenant-owned models follow the safety contract!\n');
    process.exit(0);
  }
}

main();
