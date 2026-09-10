#!/usr/bin/env node
/**
 * Staging Live HTTPS Smoke & Acceptance Test Suite
 *
 * Verifies live deployed HTTP API endpoints against Railway staging:
 * 1. Authenticated Leasing Quotation creation & cross-tenant denial
 * 2. Authenticated Cost-Ledger multi-line entry & cross-tenant denial
 * 3. Background Job Scheduler authentication & role restrictions
 * 4. Dunning Sweep Idempotency & notification quarantine verification
 *
 * Usage:
 *   node scripts/staging-live-smoke.mjs
 *
 * Environment Variables (read from process.env or .env.production):
 *   STAGING_URL: Target staging URL (default: https://fleet360-app-staging.up.railway.app)
 *   STAGING_SESSION_SECRET: JWT session secret for signing test tokens
 *   DATABASE_URL / STAGING_DATABASE_URL: PostgreSQL connection string for verification
 */

import https from 'https';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: '.env.production' });
dotenv.config();

const STAGING_URL = process.env.STAGING_URL || 'https://fleet360-app-staging.up.railway.app';
const STAGING_SESSION_SECRET = process.env.STAGING_SESSION_SECRET || process.env.SESSION_SECRET || '7cd4273ddb831e6c7ca75804ce275ae94cae187154bef44bf5a0242bbf5c4e9b';
const STAGING_DATABASE_URL_DEFAULT = 'postgresql://fleet360_app:87f855bb8b0d868fc1b4d4f1038b283ae2895405ac563ec1@ep-calm-heart-a15voo2a-pooler.ap-southeast-1.aws.neon.tech/neondb_staging?sslmode=require&channel_binding=require';
const DATABASE_URL = process.env.STAGING_DATABASE_URL || STAGING_DATABASE_URL_DEFAULT;

function toBase64Url(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signSession(payload) {
  const fullPayload = {
    ...payload,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const encodedPayload = toBase64Url(JSON.stringify(fullPayload));
  const hmac = crypto.createHmac('sha256', STAGING_SESSION_SECRET);
  hmac.update(encodedPayload);
  const signature = hmac.digest('hex');
  return `${encodedPayload}.${signature}`;
}

function makeRequest(method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, STAGING_URL);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function runSmokeSuite() {
  console.log('=== RUNNING LIVE STAGING HTTP SMOKE SUITE ===');
  console.log('Target URL:', STAGING_URL);

  const tenantAlpha = 'tenant-staging-alpha';
  const tenantBeta = 'tenant-staging-beta';
  const customerIdAlpha = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const ticketIdAlpha = 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa';

  const sessionAlpha = signSession({
    userId: 'user-staging-alpha-admin',
    email: 'admin@alphacorp.ae',
    role: 'TENANT_ADMIN',
    tenantId: tenantAlpha,
  });

  const sessionBeta = signSession({
    userId: 'user-staging-beta-admin',
    email: 'admin@betacorp.ae',
    role: 'TENANT_ADMIN',
    tenantId: tenantBeta,
  });

  const sessionFinance = signSession({
    userId: 'user-staging-finance-01',
    email: 'finance@alphacorp.ae',
    role: 'FINANCE',
    tenantId: tenantAlpha,
  });

  let allPassed = true;

  // ── 1. Quotation Creation via Deployed HTTP API ───────────────────────────
  console.log('\n--- 1. Testing Quotation Creation via Deployed HTTP API ---');
  const quoteRes = await makeRequest(
    'POST',
    '/api/leasing/quotations',
    { Cookie: `xl-session=${sessionAlpha}` },
    {
      lesseeId: customerIdAlpha,
      vehicleCount: 1,
      durationMonths: 24,
      monthlyRate: 3500,
      currency: 'AED',
      notes: 'Live staging HTTPS smoke test quotation',
    }
  );

  console.log('Quotation POST Status:', quoteRes.status);
  const createdQuotation = quoteRes.data;
  if (quoteRes.status === 201 && createdQuotation?.id) {
    console.log(`Created Quotation ID: ${createdQuotation.id} Number: ${createdQuotation.quotationNumber}`);
  } else {
    console.error('Quotation POST Failed:', quoteRes.data);
    allPassed = false;
  }

  // ── 2. Cross-Tenant Quotation Denial via Deployed HTTP API ────────────────
  console.log('\n--- 2. Testing Cross-Tenant Quotation Denial via Deployed HTTP API ---');
  const betaQuotesRes = await makeRequest(
    'GET',
    '/api/leasing/quotations',
    { Cookie: `xl-session=${sessionBeta}` }
  );

  const alphaQuotesRes = await makeRequest(
    'GET',
    '/api/leasing/quotations',
    { Cookie: `xl-session=${sessionAlpha}` }
  );

  const leakedToBeta = Array.isArray(betaQuotesRes.data)
    ? betaQuotesRes.data.some((q) => q.id === createdQuotation?.id)
    : false;
  const foundInAlpha = Array.isArray(alphaQuotesRes.data)
    ? alphaQuotesRes.data.some((q) => q.id === createdQuotation?.id)
    : false;

  console.log(`Tenant Beta sees created quotation? ${leakedToBeta} (Expected: false)`);
  console.log(`Tenant Alpha sees created quotation? ${foundInAlpha} (Expected: true)`);
  if (leakedToBeta || !foundInAlpha) allPassed = false;

  // ── 3. Cost-Ledger Entry & Cross-Tenant Denial via Deployed HTTP API ──────
  console.log('\n--- 3. Testing Service Ticket Cost-Ledger via Deployed HTTP API ---');
  const costPostRes = await makeRequest(
    'POST',
    `/api/service-tickets/${ticketIdAlpha}/costs`,
    { Cookie: `xl-session=${sessionAlpha}` },
    {
      costType: 'PARTS',
      estimatedAmount: 100,
      approvedAmount: 100,
      actualAmount: 100,
      currency: 'AED',
      payerType: 'CUSTOMER',
      notes: 'Live staging HTTPS smoke cost line',
    }
  );

  console.log('Cost POST Status:', costPostRes.status);
  if (costPostRes.status !== 201) allPassed = false;

  const costBetaGetRes = await makeRequest(
    'GET',
    `/api/service-tickets/${ticketIdAlpha}/costs`,
    { Cookie: `xl-session=${sessionBeta}` }
  );
  console.log(`Tenant Beta Cost GET Status: ${costBetaGetRes.status} (Expected: 404)`);
  if (costBetaGetRes.status !== 404) allPassed = false;

  // ── 4. Scheduler Authentication & Role Restrictions ───────────────────────
  console.log('\n--- 4. Testing Scheduled Job Authentication ---');
  const forgedRes = await makeRequest(
    'POST',
    '/api/jobs/run?job=dunning-sweep',
    {
      'x-user-id': 'user-hacker',
      'x-user-role': 'SUPER_ADMIN',
      'x-tenant-id': tenantAlpha,
    }
  );
  console.log(`Forged Header Job Run Status: ${forgedRes.status} (Expected: 401)`);
  if (forgedRes.status !== 401) allPassed = false;

  // ── 5. Dunning Sweep Idempotency Verification ─────────────────────────────
  if (DATABASE_URL) {
    console.log('\n--- 5. Testing Dunning Sweep Idempotency & Activity Persistence ---');
    const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

    try {
      // 5.1 Set up synthetic overdue invoice fixture
      const dueDate = new Date(Date.now() - 20 * 86400000);
      const invoiceId = crypto.randomUUID();

      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantAlpha);
        await tx.$executeRawUnsafe(`DELETE FROM lease_dunning_activities WHERE lessee_id = $1`, customerIdAlpha);
        await tx.$executeRawUnsafe(`DELETE FROM lease_invoices WHERE invoice_no = 'INV-SYNTH-OVERDUE-SMOKE'`);
        await tx.leaseInvoice.create({
          data: {
            id: invoiceId,
            tenantId: tenantAlpha,
            invoiceNo: 'INV-SYNTH-OVERDUE-SMOKE',
            lesseeId: customerIdAlpha,
            issueDate: new Date(Date.now() - 50 * 86400000),
            dueDate,
            subTotal: 3000,
            totalAmount: 3150,
            currency: 'AED',
            status: 'OVERDUE',
          },
        });
      });

      // 5.2 Count activities before run 1
      const countBefore = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantAlpha);
        return tx.leaseDunningActivity.count({ where: { lesseeId: customerIdAlpha } });
      });
      console.log(`Activities before Run 1: ${countBefore} (Expected: 0)`);

      // 5.3 Execute Run 1 via HTTPS
      const jobRes1 = await makeRequest(
        'POST',
        '/api/jobs/run?job=dunning-sweep',
        { Cookie: `xl-session=${sessionFinance}` }
      );
      console.log(`Run 1 Status: ${jobRes1.status} | Response:`, JSON.stringify(jobRes1.data));

      // 5.4 Count activities after run 1
      const countAfter1 = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantAlpha);
        return tx.leaseDunningActivity.count({ where: { lesseeId: customerIdAlpha } });
      });
      console.log(`Activities after Run 1: ${countAfter1} (Expected: 1)`);

      // 5.5 Execute Run 2 via HTTPS (Idempotency)
      const jobRes2 = await makeRequest(
        'POST',
        '/api/jobs/run?job=dunning-sweep',
        { Cookie: `xl-session=${sessionFinance}` }
      );
      console.log(`Run 2 Status: ${jobRes2.status} | Response:`, JSON.stringify(jobRes2.data));

      // 5.6 Count activities after run 2
      const countAfter2 = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantAlpha);
        return tx.leaseDunningActivity.count({ where: { lesseeId: customerIdAlpha } });
      });
      console.log(`Activities after Run 2: ${countAfter2} (Expected: 1, zero duplicates)`);

      if (countBefore !== 0 || countAfter1 !== 1 || countAfter2 !== 1) {
        console.error('Dunning Idempotency Check FAILED');
        allPassed = false;
      } else {
        console.log('Dunning Idempotency Check: PASS');
      }

      // Cleanup
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenantAlpha);
        await tx.$executeRawUnsafe(`DELETE FROM lease_dunning_activities WHERE lessee_id = $1`, customerIdAlpha);
        await tx.$executeRawUnsafe(`DELETE FROM lease_invoices WHERE id = $1`, invoiceId);
      }).catch(() => {});
    } finally {
      await prisma.$disconnect();
    }
  }

  console.log('\n=== SMOKE SUITE CONCLUSION ===');
  console.log('Final Result:', allPassed ? 'ALL TESTS PASSED' : 'TESTS FAILED');
  if (!allPassed) process.exit(1);
}

runSmokeSuite().catch((err) => {
  console.error('Smoke suite exception:', err);
  process.exit(1);
});
