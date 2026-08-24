#!/usr/bin/env node
/**
 * Add missing tenantId indexes to Prisma schema
 *
 * This script adds @@index([tenantId]) to models that are missing it.
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(process.cwd(), 'prisma', 'schema.prisma');

const MODELS_NEEDING_INDEX = [
  'RentalCustomer',
  'RentalBooking',
  'RentalAgreement',
  'RentalInvoice',
  'RentalPayment',
  'RentalAncillary',
  'Customer',
  'Driver',
  'Vehicle',
  'TripPassenger',
  'MaintenanceRequest',
];

function addIndexToModel(content, modelName) {
  // Find the model block
  const modelRegex = new RegExp(
    `(model\\s+${modelName}\\s*\\{[\\s\\S]*?)(\\n\\s*@@\\w+.*)*\\n(\\})`,
    'g'
  );

  return content.replace(modelRegex, (match, modelStart, existingIndexes, closingBrace) => {
    // Check if tenantId index already exists
    if (match.includes('@@index([tenantId])')) {
      console.log(`  ℹ️  ${modelName} already has @@index([tenantId])`);
      return match;
    }

    console.log(`  ✅ Adding @@index([tenantId]) to ${modelName}`);

    // Add the index before the closing brace
    const indexes = existingIndexes || '';
    return modelStart + indexes + '\n  @@index([tenantId])' + '\n' + closingBrace;
  });
}

function main() {
  console.log('🔧 Adding missing tenantId indexes to Prisma schema...\n');

  if (!fs.existsSync(SCHEMA_PATH)) {
    console.error('❌ Prisma schema not found at:', SCHEMA_PATH);
    process.exit(1);
  }

  let content = fs.readFileSync(SCHEMA_PATH, 'utf8');
  let modified = false;

  for (const modelName of MODELS_NEEDING_INDEX) {
    const beforeLength = content.length;
    content = addIndexToModel(content, modelName);
    if (content.length !== beforeLength) {
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(SCHEMA_PATH, content, 'utf8');
    console.log('\n✅ Schema updated successfully!');
    console.log('\nNext steps:');
    console.log('1. Run: npx prisma format');
    console.log('2. Run: npx prisma migrate dev --name add_tenant_indexes');
    console.log('3. Run: npm run tenant:check-schema\n');
  } else {
    console.log('\n✅ All models already have tenantId indexes!\n');
  }
}

main();
