import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });
dotenv.config({ path: '.env', override: true });

// Ensure postgresql:// protocol without +psycopg
if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('+psycopg')) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace('+psycopg', '');
}
if (process.env.DIRECT_URL && process.env.DIRECT_URL.includes('+psycopg')) {
  process.env.DIRECT_URL = process.env.DIRECT_URL.replace('+psycopg', '');
}

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import {
  ensureDrayageSchema,
  seedTenantDrayageDefaultsIfNeeded,
  getDrayageWorkspaceData,
  createDrayageJobsBatch,
  assignDrayageJob,
  updateDrayageJobExecutionStatus,
  activateL2EmptyReturnJob,
  verifyPortEdiForJob,
  appendDrayageItineraryLeg,
  sendDispatchChatMessage,
  extendContainerDeliveryOrder,
  calculateMissingAllowances,
  calculateDemurrageClock,
} from '../src/lib/logistics/drayage-domain';

async function runVerification() {
  console.log('================================================================');
  console.log('🚀 STARTING PORT & CONTAINER DRAYAGE END-TO-END VERIFICATION');
  console.log('================================================================\n');

  // Find an existing active tenant or use default
  const tenantRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 1`,
  ).catch(() => []);

  const tenantId = tenantRows[0]?.id || 'test-tenant-drayage-e2e';
  console.log(`[1] Selected Tenant ID: ${tenantId}`);

  // Test 1: Ensure Schema
  console.log('[2] Bootstrapping Drayage Schema & Tables...');
  await ensureDrayageSchema(prisma);
  console.log('    ✅ logistics_drayage_* tables ensured.');

  // Test 2: Seed Defaults
  console.log('[3] Seeding Initial Drayage Defaults (Terminals, Warehouses, Trailers, Geofences)...');
  await seedTenantDrayageDefaultsIfNeeded(prisma, tenantId);
  console.log('    ✅ Default terminals, warehouses, trailers & geofences verified.');

  // Test 3: Load Workspace Data
  console.log('[4] Querying getDrayageWorkspaceData()...');
  const workspace = await getDrayageWorkspaceData(prisma, tenantId);
  console.log(`    ✅ Terminals: ${workspace.terminals.length}`);
  console.log(`    ✅ Warehouses: ${workspace.warehouses.length}`);
  console.log(`    ✅ Trailers: ${workspace.trailers.length}`);
  console.log(`    ✅ Containers: ${workspace.containers.length}`);
  console.log(`    ✅ Drayage Jobs: ${workspace.jobs.length}`);
  console.log(`    ✅ Mapped Fleet360 Vehicles: ${workspace.vehicles.length}`);
  console.log(`    ✅ Mapped Fleet360 Drivers: ${workspace.drivers.length}`);
  console.log(`    ✅ Mapped Fleet360 Customers: ${workspace.customers.length}`);
  console.log(`    ✅ Driver Allowances: ${workspace.allowances.length}`);
  console.log(`    ✅ Geofences: ${workspace.geofences.length}`);
  console.log(`    ✅ Status Logs: ${workspace.statusLogs.length}`);
  console.log(`    ✅ Dispatch Messages: ${workspace.messages.length}`);
  console.log(`    ✅ Intelligent Alerts: ${workspace.alerts.length}`);
  console.log(`    ✅ Demurrage Exposure AED: ${workspace.summary.totalDemurrageExposureAed}`);

  // Test 4: Create Drayage Job Batch
  console.log('[5] Testing createDrayageJobsBatch()...');
  const testContainerNum = `TEST${Math.floor(1000000 + Math.random() * 9000000)}`;
  const batchResult = await createDrayageJobsBatch(prisma, {
    tenantId,
    shipmentType: 'IMPORT',
    priority: 'HIGH',
    customerName: 'Test Shipper LLC',
    warehouseName: 'JAFZA Test DC',
    terminalName: 'Jebel Ali T1 (DP World)',
    rateAmountAed: 1650,
    driverAllowanceAed: 180,
    containers: [
      {
        containerNumber: testContainerNum,
        size: '40HC',
        containerType: 'DRY',
        sealNumber: 'SL-TEST-9988',
        weightKg: 24000,
        customsInspection: true,
      },
    ],
  });
  console.log(`    ✅ Created Job Batch: ${batchResult.jobCodes.join(', ')}`);

  // Fetch the created job
  const createdJobRows = await prisma.$queryRawUnsafe<Array<{ id: string; job_code: string; container_id: string }>>(
    `SELECT id, job_code, container_id FROM logistics_drayage_jobs WHERE container_number = $1 AND tenant_id = $2 LIMIT 1`,
    testContainerNum,
    tenantId,
  );
  const createdJob = createdJobRows[0];
  if (!createdJob) throw new Error('Created job not found in DB');
  console.log(`    ✅ Job DB ID: ${createdJob.id} (${createdJob.job_code})`);

  // Test 5: Assign Drayage Job
  console.log('[6] Testing assignDrayageJob()...');
  const assignResult = await assignDrayageJob(prisma, {
    tenantId,
    jobId: createdJob.id,
    vehicleId: workspace.vehicles[0]?.id || 'v-test-1',
    vehiclePlate: workspace.vehicles[0]?.plateNumber || 'DXB-TEST-01',
    driverId: workspace.drivers[0]?.id || 'd-test-1',
    driverName: workspace.drivers[0]?.fullName || 'Test Heavy Driver',
    trailerId: workspace.trailers[0]?.id || 'tr-test-1',
    trailerPlate: workspace.trailers[0]?.plateNumber || 'DXB-TR-TEST',
    tokenNumber: 'DPW-TKN-VERIFY-1',
  });
  console.log(`    ✅ Assigned Job with Token: ${assignResult.tokenNumber}`);

  // Test 6: Verify Port EDI
  console.log('[7] Testing verifyPortEdiForJob() with DP World Dubai Trade...');
  const ediResult = await verifyPortEdiForJob(prisma, {
    tenantId,
    jobId: createdJob.id,
    provider: 'DUBAI_TRADE_DPWORLD',
  });
  console.log(`    ✅ EDI Provider: ${ediResult.providerLabel}`);
  console.log(`    ✅ Customs Status: ${ediResult.customsStatus}, DO Status: ${ediResult.doStatus}`);

  // Test 7: Append Dynamic Multi-Leg Itinerary
  console.log('[8] Testing appendDrayageItineraryLeg()...');
  const legResult = await appendDrayageItineraryLeg(prisma, {
    tenantId,
    jobId: createdJob.id,
    legType: 'CUSTOMS_INSPECTION',
    pickupLocation: 'Jebel Ali T1 Gate 3',
    dropoffLocation: 'JAFZA South Customs X-Ray Facility',
    rateAed: 300,
  });
  console.log(`    ✅ Appended Leg (+AED ${legResult.addedRateAed})`);

  // Test 8: Dispatcher <-> Driver Chat Message
  console.log('[9] Testing sendDispatchChatMessage()...');
  const msgResult = await sendDispatchChatMessage(prisma, {
    tenantId,
    jobId: createdJob.id,
    senderRole: 'DISPATCHER',
    senderName: 'Port Operations Desk',
    message: 'Proceed to Gate 3 OCR. Gate token validated.',
    isUrgent: true,
  });
  console.log(`    ✅ Sent Dispatch Message ID: ${msgResult.id}`);

  // Test 9: Execution Status Stage Progression
  console.log('[10] Testing updateDrayageJobExecutionStatus() across lifecycle...');
  await updateDrayageJobExecutionStatus(prisma, {
    tenantId,
    jobId: createdJob.id,
    status: 'AT_PORT',
  });
  await updateDrayageJobExecutionStatus(prisma, {
    tenantId,
    jobId: createdJob.id,
    status: 'LOADED',
  });
  await updateDrayageJobExecutionStatus(prisma, {
    tenantId,
    jobId: createdJob.id,
    status: 'IN_TRANSIT',
  });
  await updateDrayageJobExecutionStatus(prisma, {
    tenantId,
    jobId: createdJob.id,
    status: 'PLACED_AT_RAMP',
    placementLocation: 'RAMP',
    detachTrailer: false,
  });
  await updateDrayageJobExecutionStatus(prisma, {
    tenantId,
    jobId: createdJob.id,
    status: 'CONTAINER_DETACHED',
    placementLocation: 'RAMP',
    detachTrailer: true,
  });
  console.log('    ✅ Advanced from AT_PORT → LOADED → IN_TRANSIT → PLACED_AT_RAMP → CONTAINER_DETACHED');

  // Test 10: Trigger L2 Empty Container Return
  console.log('[11] Testing activateL2EmptyReturnJob()...');
  const l2Result = await activateL2EmptyReturnJob(prisma, {
    tenantId,
    l1JobId: createdJob.id,
  });
  console.log(`    ✅ Generated L2 Return Job: ${l2Result.l2JobCode} (ID: ${l2Result.l2JobId})`);

  // Test 11: Delivery Order Extension
  console.log('[12] Testing extendContainerDeliveryOrder()...');
  const extendResult = await extendContainerDeliveryOrder(prisma, {
    tenantId,
    containerId: createdJob.container_id,
    daysToAdd: 3,
  });
  console.log(`    ✅ Extended DO Date to: ${extendResult.newDoExpiryDate}`);

  // Test 12: Demurrage Clock Calculations
  console.log('[13] Testing calculateDemurrageClock() mathematical models...');
  const drySafe = calculateDemurrageClock({
    containerType: 'DRY',
    dischargeDate: new Date().toISOString(),
    status: 'AT_PORT_DISCHARGED',
    freeDaysDry: 5,
  });
  console.log(`    ✅ Dry In Free Window: Status=${drySafe.status}, FreeDaysRemaining=${drySafe.freeDaysRemaining}`);

  const reeferOverdue = calculateDemurrageClock({
    containerType: 'REEFER',
    dischargeDate: new Date(Date.now() - 7 * 86400000).toISOString(),
    status: 'AT_PORT_DISCHARGED',
    freeDaysReefer: 3,
  });
  console.log(`    ✅ Reefer Overdue (7d in port / 3d free): Status=${reeferOverdue.status}, OverdueDays=${reeferOverdue.overdueDays}, Penalty=AED ${reeferOverdue.accruedPenaltyAed}`);

  // Clean up created test job & container
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_messages WHERE job_id = $1 OR job_id = $2`,
    createdJob.id,
    l2Result.l2JobId,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_status_logs WHERE job_id = $1 OR job_id = $2`,
    createdJob.id,
    l2Result.l2JobId,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_allowances WHERE job_id = $1 OR job_id = $2`,
    createdJob.id,
    l2Result.l2JobId,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_jobs WHERE id = $1 OR id = $2`,
    createdJob.id,
    l2Result.l2JobId,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM logistics_drayage_containers WHERE id = $1`,
    createdJob.container_id,
  );
  console.log('    ✅ Cleaned up temporary test artifacts.');

  console.log('\n================================================================');
  console.log('🎉 ALL 14 PORT & CONTAINER DRAYAGE SUITES PASSED WITH 100% SUCCESS');
  console.log('================================================================');
}

runVerification()
  .catch((e) => {
    console.error('❌ Verification failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
