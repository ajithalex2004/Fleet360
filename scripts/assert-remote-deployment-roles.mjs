/**
 * scripts/assert-remote-deployment-roles.mjs
 *
 * Post-Deployment Verification Tool
 *
 * Calls the running deployment's `/api/health/db-role` endpoint to verify
 * that the live server runtime is actively executing under `fleet360_app`.
 *
 * Usage:
 *   node scripts/assert-remote-deployment-roles.mjs https://staging.fleet360.example.com
 */

import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env' });

const targetUrl = process.argv[2] || process.env.STAGING_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const secret = process.env.DEPLOYMENT_HEALTH_SECRET || process.env.INTERNAL_SERVICE_KEY || process.env.SESSION_SECRET || '';

async function verifyRemoteDeployment() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FLEET360 REMOTE POST-DEPLOYMENT RUNTIME ROLE ASSERTION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Target Deployment: ${targetUrl}/api/health/db-role\n`);

  try {
    const res = await fetch(`${targetUrl}/api/health/db-role`, {
      headers: secret ? { 'x-deployment-health-secret': secret } : {},
    });

    const body = await res.json();

    if (!res.ok || body.status !== 'pass' || !body.runtimeRoleValid || !body.directRoleValid) {
      console.error('❌ REMOTE DEPLOYMENT ROLE ASSERTION FAILED:');
      console.error(JSON.stringify(body, null, 2));
      process.exit(1);
    }

    console.log('✅ Remote Deployment Confirmed Enforcing fleet360_app:');
    console.log(`   Runtime Application Role Valid: ${body.runtimeRoleValid}`);
    console.log(`   Direct Sweep Role Valid:        ${body.directRoleValid}`);
    console.log(`   Server Timestamp:               ${body.timestamp}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ POST-DEPLOYMENT RUNTIME ROLE VERIFICATION SUCCESSFUL');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to reach deployment healthcheck endpoint:', err.message);
    process.exit(1);
  }
}

verifyRemoteDeployment();
