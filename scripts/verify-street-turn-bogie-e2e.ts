// Bypass server-only guard for standalone testing
try {
  const resolved = require.resolve('server-only');
  (require.cache as Record<string, unknown>)[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    exports: {},
  };
} catch {}

import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let val = match[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}
loadDotEnv();

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function runVerification() {
  // Dynamically import domain module after server-only bypass is installed
  const domain = await import('../src/lib/logistics/drayage-domain');
  const {
    findStreetTurnCandidates,
    executeStreetTurnTriangulation,
    findBogiePairCandidates,
    executeBogiePairDispatch,
    getDrayageWorkspaceData,
    detectShippingLine,
    getWarehouseZoneName,
  } = domain;

  console.log('=== STARTING OPTION 4: STREET-TURN & BOGIE PAIRING E2E VERIFICATION ===\n');
  const testTenantId = 'tenant-drayage-opt4-test';

  try {
    // 1. Initialize Workspace & Seed Defaults
    console.log('1. Initializing drayage workspace & seed data...');
    const initialWorkspace = await getDrayageWorkspaceData(prisma, testTenantId);
    console.log(`   Initial jobs count: ${initialWorkspace.jobs.length}`);

    // Verify helper detections
    const mscLine = detectShippingLine('MSCU8492014');
    const maerskLine = detectShippingLine('MAEU5910283');
    console.log(`   Carrier Line detection: MSCU8492014 -> ${mscLine}, MAEU5910283 -> ${maerskLine}`);
    if (mscLine !== 'MSC' || maerskLine !== 'MAERSK') {
      throw new Error(`Carrier detection failed: ${mscLine}, ${maerskLine}`);
    }

    const jafzaZone = getWarehouseZoneName('JAFZA South Bonded Fulfillment Hub (Gate 5)');
    const nipZone = getWarehouseZoneName('National Industries Park (NIP) Mega Automated DC');
    console.log(`   Zone resolution: JAFZA South -> ${jafzaZone}, NIP -> ${nipZone}`);
    if (jafzaZone !== 'JAFZA South' || nipZone !== 'National Industries Park (NIP)') {
      throw new Error(`Zone resolution failed: ${jafzaZone}, ${nipZone}`);
    }

    // 2. Test Street-Turn Triangulation Candidate Detection
    console.log('\n2. Testing Street-Turn Candidate Matching Engine...');
    const streetTurnCandidates = await findStreetTurnCandidates(prisma, testTenantId);
    console.log(`   Found ${streetTurnCandidates.length} Street-Turn Triangulation Candidate(s)`);

    if (streetTurnCandidates.length === 0) {
      throw new Error('Expected at least 1 Street-Turn candidate for tenant');
    }

    const topCandidate = streetTurnCandidates[0];
    console.log(`   Top Candidate ID: ${topCandidate.id}`);
    console.log(`   L2 Inbound Job: ${topCandidate.l2Job.jobCode} (Container ${topCandidate.containerNumber} - ${topCandidate.containerSize})`);
    console.log(`   Export Job: ${topCandidate.exportJob.jobCode} (Customer: ${topCandidate.exportJob.customerName})`);
    console.log(`   Origin Warehouse: ${topCandidate.originWarehouse}`);
    console.log(`   Destination Warehouse: ${topCandidate.destWarehouse} (${topCandidate.zone})`);
    console.log(`   Inland Repositioning Distance: ${topCandidate.interWarehouseDistanceKm} km`);
    console.log(`   Deadhead Saved: ${topCandidate.deadheadKmSaved} km`);
    console.log(`   Carbon Avoided: ${topCandidate.co2SavedKg} kg CO₂`);
    console.log(`   Cost Saved: AED ${topCandidate.fuelSavingsAed}`);
    console.log(`   Match Score: ${topCandidate.score}/100`);

    // 3. Test Street-Turn Execution
    console.log('\n3. Testing Street-Turn Triangulation Execution...');
    const stExecution = await executeStreetTurnTriangulation(prisma, {
      tenantId: testTenantId,
      l2JobId: topCandidate.l2Job.id,
      exportJobId: topCandidate.exportJob.id,
      vehicleId: 'veh-test-tractor-1',
      vehiclePlate: 'DXB-TRAC-889',
      driverId: 'drv-test-driver-1',
      driverName: 'Rashid Al-Marri',
      trailerId: 'tr-test-trailer-1',
      trailerPlate: 'DXB-TR-40FT',
      tokenNumber: 'DPW-ST-TEST-01',
      actor: 'Automated E2E Test Suite',
    });

    console.log(`   Execution Result:`, stExecution);
    if (!stExecution.ok) throw new Error('Street-Turn execution failed');

    // Verify Database State for Street Turn
    const updatedL2 = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, job_code, status, street_turn_job_id, notes FROM logistics_drayage_jobs WHERE id = $1`,
      topCandidate.l2Job.id,
    ))[0];
    console.log(`   Updated L2 Status: ${updatedL2.status}, Linked Export Job: ${updatedL2.street_turn_job_id}`);
    if (updatedL2.status !== 'STREET_TURNED') {
      throw new Error(`Expected L2 job status STREET_TURNED, got ${updatedL2.status}`);
    }

    const updatedExp = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, job_code, status, container_number, street_turn_job_id, assigned_driver_name FROM logistics_drayage_jobs WHERE id = $1`,
      topCandidate.exportJob.id,
    ))[0];
    console.log(`   Updated Export Job Container: ${updatedExp.container_number}, Driver: ${updatedExp.assigned_driver_name}`);
    if (updatedExp.container_number !== topCandidate.containerNumber) {
      throw new Error(`Export job container not updated to ${topCandidate.containerNumber}`);
    }

    // 4. Test Dual-20FT Bogie Candidate Detection
    console.log('\n4. Testing Dual-20FT Bogie Candidate Matching Engine...');
    const bogieCandidates = await findBogiePairCandidates(prisma, testTenantId);
    console.log(`   Found ${bogieCandidates.length} Bogie Combo Candidate(s)`);

    if (bogieCandidates.length === 0) {
      throw new Error('Expected at least 1 Bogie combo candidate for tenant');
    }

    const topBogie = bogieCandidates[0];
    console.log(`   Bogie ID: ${topBogie.id}`);
    console.log(`   Box #1: ${topBogie.job1.jobCode} (${topBogie.job1.containerNumber} - ${(topBogie.box1WeightKg / 1000).toFixed(1)}T)`);
    console.log(`   Box #2: ${topBogie.job2.jobCode} (${topBogie.job2.containerNumber} - ${(topBogie.box2WeightKg / 1000).toFixed(1)}T)`);
    console.log(`   Total Combined Payload: ${(topBogie.totalPayloadKg / 1000).toFixed(1)}T / ${(topBogie.weightLimitKg / 1000).toFixed(1)}T`);
    console.log(`   Road Weight Compliant: ${topBogie.isWeightCompliant ? 'YES (<= 36T)' : 'NO (OVERWEIGHT)'}`);
    console.log(`   Weight Utilization: ${topBogie.weightUtilizationPct}%`);
    console.log(`   Common Terminal: ${topBogie.commonTerminal}`);
    console.log(`   TAS Slot Match: ${topBogie.tasSlot}`);
    console.log(`   Bogie Score: ${topBogie.score}/100`);

    if (!topBogie.isWeightCompliant) {
      throw new Error('Expected Bogie pair to be weight compliant');
    }

    // 5. Test Trailer Compatibility Safety Check
    console.log('\n5. Testing Bogie Trailer Compatibility Safety Check...');
    const tr20Id = `tr-test-20ft-${testTenantId.slice(0, 8)}`;
    const tr40Id = `tr-test-40ft-${testTenantId.slice(0, 8)}`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO logistics_drayage_trailers (id, tenant_id, plate_number, trailer_type, capacity_tons, master_status)
       VALUES ($1, $2, 'DXB-TR-20FT', '20FT_SKELETAL', 25, 'AVAILABLE'),
              ($3, $2, 'DXB-TR-40FT-BOGIE', '40FT_SKELETAL', 45, 'AVAILABLE')
       ON CONFLICT (id) DO UPDATE SET trailer_type = EXCLUDED.trailer_type`,
      tr20Id, testTenantId, tr40Id
    );

    // Attempt dispatch with 20FT trailer - MUST FAIL!
    let rejected20Ft = false;
    try {
      await executeBogiePairDispatch(prisma, {
        tenantId: testTenantId,
        job1Id: topBogie.job1.id,
        job2Id: topBogie.job2.id,
        vehicleId: 'veh-test-tractor-1',
        vehiclePlate: 'DXB-TRAC-889',
        driverId: 'drv-test-driver-1',
        driverName: 'Rashid Al-Marri',
        trailerId: tr20Id,
        trailerPlate: 'DXB-TR-20FT',
        tokenNumber: 'DPW-BG-FAIL-01',
      });
    } catch (err: unknown) {
      rejected20Ft = true;
      console.log(`   ✓ Correctly rejected 20FT trailer for Bogie: "${err instanceof Error ? err.message : String(err)}"`);
    }

    if (!rejected20Ft) {
      throw new Error('Safety Check Failed: 20FT trailer was not rejected for Bogie dispatch!');
    }

    // Now dispatch with 40FT trailer - MUST SUCCEED!
    console.log('\n6. Testing Valid Dual-20FT Bogie Dispatch with 40FT/Bogie Chassis...');
    const bogieDispatch = await executeBogiePairDispatch(prisma, {
      tenantId: testTenantId,
      job1Id: topBogie.job1.id,
      job2Id: topBogie.job2.id,
      vehicleId: 'veh-test-tractor-1',
      vehiclePlate: 'DXB-TRAC-889',
      driverId: 'drv-test-driver-1',
      driverName: 'Rashid Al-Marri',
      trailerId: tr40Id,
      trailerPlate: 'DXB-TR-40FT-BOGIE',
      tokenNumber: 'DPW-BG-TEST-01',
      actor: 'Automated E2E Test Suite',
    });

    console.log('   Bogie Dispatch Result:', bogieDispatch);
    if (!bogieDispatch.ok) throw new Error('Bogie dispatch failed');

    // Verify both jobs updated in database
    const verifyJobs = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT id, job_code, status, bogie_job_id, assigned_trailer_plate, token_number FROM logistics_drayage_jobs WHERE id IN ($1, $2)`,
      topBogie.job1.id,
      topBogie.job2.id,
    );
    console.log(`   Verified ${verifyJobs.length} jobs assigned with Bogie trailer DXB-TR-40FT-BOGIE and token ${verifyJobs[0].token_number}`);
    for (const j of verifyJobs) {
      if (j.assigned_trailer_plate !== 'DXB-TR-40FT-BOGIE') {
        throw new Error(`Job ${j.job_code} trailer not set to DXB-TR-40FT-BOGIE`);
      }
      if (j.token_number !== 'DPW-BG-TEST-01') {
        throw new Error(`Job ${j.job_code} token not set to DPW-BG-TEST-01`);
      }
    }

    console.log('\n=== ALL OPTION 4 E2E VERIFICATIONS PASSED SUCCESSFULLY! ===');
  } finally {
    // Clean up test tenant data
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_drayage_status_logs WHERE tenant_id = $1`, testTenantId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_drayage_allowances WHERE tenant_id = $1`, testTenantId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_drayage_jobs WHERE tenant_id = $1`, testTenantId).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM logistics_drayage_trailers WHERE tenant_id = $1`, testTenantId).catch(() => {});
    await prisma.$disconnect();
  }
}

runVerification().catch((err) => {
  console.error('\n❌ E2E VERIFICATION FAILED:', err);
  process.exit(1);
});
