const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const fs = require('fs');
require('dotenv').config();

async function setupFleetAppRole() {
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!directUrl) {
    console.error('DIRECT_URL missing');
    process.exit(1);
  }

  // Ensure owner uses direct connection (no -pooler)
  const ownerUrlObj = new URL(directUrl);
  ownerUrlObj.hostname = ownerUrlObj.hostname.replace(/-pooler\./, '.');
  const ownerDirectUrl = ownerUrlObj.toString();

  const prisma = new PrismaClient({ datasources: { db: { url: ownerDirectUrl } } });

  const appPassword = crypto.randomBytes(24).toString('hex');
  console.log('Setting secure password for fleet360_app...');

  // Set password using owner direct connection with retries
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`ALTER ROLE fleet360_app WITH PASSWORD '${appPassword}';`);
      console.log('Password set successfully for fleet360_app.');
      break;
    } catch (err) {
      console.warn(`Owner connection attempt ${attempt} failed: ${err.message}, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  // Construct PHASE0_DATABASE_URL using the DIRECT (non-pooler) endpoint
  const appUrlObj = new URL(ownerDirectUrl);
  appUrlObj.username = 'fleet360_app';
  appUrlObj.password = appPassword;
  const phase0Url = appUrlObj.toString();

  console.log('Testing direct connection as fleet360_app...');
  const appPrisma = new PrismaClient({ datasources: { db: { url: phase0Url } } });
  
  // Retry loop in case endpoint is waking up
  let who;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const rows = await appPrisma.$queryRawUnsafe(
        'SELECT current_user, (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypassrls;'
      );
      who = rows[0];
      break;
    } catch (err) {
      console.warn(`App connection attempt ${attempt} failed: ${err.message}, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  console.log('Connected successfully as:', who);

  // Write PHASE0_DATABASE_URL to .env
  let envContent = fs.readFileSync('.env', 'utf8');
  if (envContent.includes('PHASE0_DATABASE_URL=')) {
    envContent = envContent.replace(/PHASE0_DATABASE_URL=.*/g, `PHASE0_DATABASE_URL="${phase0Url}"`);
  } else {
    envContent += `\nPHASE0_DATABASE_URL="${phase0Url}"\n`;
  }
  fs.writeFileSync('.env', envContent);
  console.log('PHASE0_DATABASE_URL configured in .env.');

  await prisma.$disconnect();
  await appPrisma.$disconnect();
}

setupFleetAppRole().catch(console.error);
