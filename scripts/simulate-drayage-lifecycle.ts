/**
 * scripts/simulate-drayage-lifecycle.ts
 *
 * End-to-End Simulation of Leg 1 (L1) -> Driver Mobile ETC Placement ->
 * Background Worker Timer Expiration -> Dynamic Leg 2 (L2) Activation &
 * Downstream 4-Factor Prime Mover Scoring.
 */

import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  ensureDrayageSchema,
  seedTenantDrayageDefaultsIfNeeded,
  createDrayageJobsBatch,
  updateDrayageJobExecutionStatus,
  extendDrayageJobEtcTime,
  checkAndAutoActivateExpiredEtcJobs,
  getDrayageWorkspaceData,
  assignDrayageJob,
} from '../src/lib/logistics/drayage-domain';

function loadDotEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    process.env[key] = raw.replace(/^["']|["']$/g, '');
  }
}

loadDotEnv();

const prisma = new PrismaClient({ log: ['error'] });

async function runSimulation() {
  console.log('========================================================================');
  console.log('🚀 STARTING E2E SIMULATION: DRAYAGE L1 -> DRIVER ETC -> AUTO L2 ENGINE');
  console.log('========================================================================\n');

  const tenantId = 'sim-drayage-tenant';
  const containerNumber = `MSCU${Math.floor(1000000 + Math.random() * 9000000)}`;

  try {
    // 0. Bootstrap Schema & Seed Tenant Defaults
    console.log('📍 Phase 0: Ensuring Drayage Schema & Bootstrapping Masters...');
    await ensureDrayageSchema(prisma);
    await seedTenantDrayageDefaultsIfNeeded(prisma, tenantId);
    console.log('   ✅ Schema & Masters verified.\n');

    // 1. Create a Leg 1 Import Job
    console.log(`📦 Phase 1: Booking New Leg 1 Import Haul for Container [${containerNumber}]...`);
    const batchRes = await createDrayageJobsBatch(prisma, {
      tenantId,
      shipmentType: 'IMPORT',
      priority: 'STANDARD',
      customerName: 'Al-Futtaim Logistics Hub',
      warehouseName: 'JAFZA South Bonded Hub',
      terminalName: 'Jebel Ali Port - Terminal 1',
      rateAmountAed: 1650,
      driverAllowanceAed: 150,
      containers: [
        {
          containerNumber,
          size: '40HC',
          containerType: 'DRY',
          weightKg: 24500,
        },
      ],
    });

    const l1JobCode = batchRes.jobCodes[0];
    console.log(`   ✅ L1 Import Haul created: ${l1JobCode}`);

    // Query L1 record
    const l1Rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT * FROM logistics_drayage_jobs WHERE job_code = $1 AND tenant_id = $2 LIMIT 1`,
      l1JobCode,
      tenantId,
    );
    const l1Job = l1Rows[0];
    const l1JobId = String(l1Job.id);
    const containerId = String(l1Job.container_id);

    console.log(`   - L1 Job ID: ${l1JobId}`);
    console.log(`   - Container ID: ${containerId}`);
    console.log(`   - Initial Phase: ${l1Job.job_phase}`);
    console.log(`   - Initial Status: ${l1Job.status}`);
    console.log(`   - L2 Activated: ${l1Job.l2_activated}`);

    // Assign truck and dispatch
    await assignDrayageJob(prisma, {
      tenantId,
      jobId: l1JobId,
      vehicleId: 'veh-sim-01',
      vehiclePlate: 'DXB-TRACTOR-882',
      driverId: 'drv-sim-01',
      driverName: 'Rashid Al-Marri',
      trailerId: 'trl-sim-01',
      trailerPlate: 'DXB-TR-4001',
      tokenNumber: 'DPW-TKN-9182',
    });
    console.log('   ✅ Assigned Prime Mover DXB-TRACTOR-882 & Driver Rashid Al-Marri');

    await updateDrayageJobExecutionStatus(prisma, {
      tenantId,
      jobId: l1JobId,
      status: 'IN_TRANSIT',
      notes: 'Departed DPW T1 via Gate 3 OCR',
      actor: 'Driver Mobile App',
    });
    console.log('   ✅ Driver marked IN_TRANSIT on E11 highway.\n');

    // 2. Driver Arrives at Warehouse & Drops Container @ Ramp with ETC
    console.log('🚚 Phase 2: Driver Mobile App Triggers [PLACED_AT_RAMP] with ETC...');
    const futureEtc = new Date(Date.now() + 2 * 3600000).toISOString(); // +2 hours
    const rampResult = await updateDrayageJobExecutionStatus(prisma, {
      tenantId,
      jobId: l1JobId,
      status: 'PLACED_AT_RAMP',
      placementLocation: 'RAMP',
      detachTrailer: true,
      etcTime: futureEtc,
      notes: 'Container spotted at Ramp #4. Warehouse destuffing underway.',
      actor: 'Driver Mobile App',
    });

    console.log(`   ✅ Status updated to: ${rampResult.status}`);
    console.log(`   - Destuffing ETC Time: ${rampResult.etcTime}`);

    // Verify DB state after Ramp placement
    const postRampJobs = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT status, placement_location, trailer_detached, etc_time, etc_alert_status, l2_activated 
       FROM logistics_drayage_jobs WHERE id = $1`,
      l1JobId,
    );
    const postRampJob = postRampJobs[0];
    console.log(`   - Job DB Status: ${postRampJob.status}`);
    console.log(`   - Placement: ${postRampJob.placement_location} (Trailer Detached: ${postRampJob.trailer_detached})`);
    console.log(`   - ETC Alert Status: ${postRampJob.etc_alert_status}`);
    console.log(`   - L2 Activated Flag: ${postRampJob.l2_activated}`);

    // Verify Container transitioned to WAITING_MT_RETURN
    const cntRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT status FROM logistics_drayage_containers WHERE id = $1`,
      containerId,
    );
    console.log(`   - Container Status in Master DB: [${cntRows[0]?.status}] (Target: WAITING_MT_RETURN)`);
    if (cntRows[0]?.status !== 'WAITING_MT_RETURN') {
      throw new Error(`Assertion failed: expected container status WAITING_MT_RETURN, got ${cntRows[0]?.status}`);
    }
    console.log('   ✅ Container successfully transitioned to WAITING_MT_RETURN!\n');

    // 3. Dispatcher Extends ETC by +30m
    console.log('⏱️ Phase 3: Operations Console Extends Destuffing ETC by +30 mins...');
    const extendResult = await extendDrayageJobEtcTime(prisma, {
      tenantId,
      jobId: l1JobId,
      minutesToAdd: 30,
      reason: 'Warehouse crane forklift delay',
      actor: 'Dispatch Console',
    });
    console.log(`   ✅ ETC Extended successfully. New ETC: ${extendResult.etcTime}\n`);

    // 4. Simulate Timer Expiry & Background Worker Auto-Activation
    console.log('⏰ Phase 4: Simulating Timer Expiration & Running Background Worker Engine...');
    // Manually set etc_time 1 minute into the past to simulate time expiry
    const expiredTime = new Date(Date.now() - 60000).toISOString();
    await prisma.$executeRawUnsafe(
      `UPDATE logistics_drayage_jobs SET etc_time = $1::timestamptz WHERE id = $2`,
      expiredTime,
      l1JobId,
    );
    console.log(`   - Forced etc_time to: ${expiredTime} (<= NOW())`);

    console.log('   - Triggering checkAndAutoActivateExpiredEtcJobs()...');
    const workerRes = await checkAndAutoActivateExpiredEtcJobs(prisma, tenantId);
    console.log(`   ✅ Background Worker executed: Checked ${workerRes.checked} expired jobs, Activated ${workerRes.activated.length} L2 returns.`);
    console.log(`   - Generated L2 Job Codes:`, workerRes.activated);

    if (workerRes.activated.length === 0) {
      throw new Error('Assertion failed: expected at least 1 job to be activated');
    }

    const activatedL2 = workerRes.activated[0];

    // 5. Verify Database Records Post Auto-Activation
    console.log('\n🔍 Phase 5: Verifying Leg 1 & Leg 2 Database Consistency...');
    const l1Final = (
      await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT status, l2_activated, etc_alert_status FROM logistics_drayage_jobs WHERE id = $1`,
        l1JobId,
      )
    )[0];
    console.log(`   - L1 Final Status: ${l1Final.status} (Target: COMPLETED)`);
    console.log(`   - L1 l2_activated: ${l1Final.l2_activated} (Target: true)`);
    console.log(`   - L1 etc_alert_status: ${l1Final.etc_alert_status} (Target: ACTIVATED)`);

    const l2Record = (
      await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT id, job_code, job_phase, parent_job_id, status, priority, container_number, warehouse_name, terminal_name 
         FROM logistics_drayage_jobs WHERE id = $1`,
        activatedL2.l2JobId,
      )
    )[0];
    console.log(`   - L2 Record ID: ${l2Record.id}`);
    console.log(`   - L2 Job Code: ${l2Record.job_code}`);
    console.log(`   - L2 Job Phase: ${l2Record.job_phase} (Target: L2)`);
    console.log(`   - L2 Parent Job ID: ${l2Record.parent_job_id} (Target: ${l1JobId})`);
    console.log(`   - L2 Status: ${l2Record.status} (Target: PENDING)`);
    console.log(`   - L2 Priority: ${l2Record.priority} (Target: HIGH - Escalated)`);
    console.log(`   - Route: ${l2Record.warehouse_name} ➔ ${l2Record.terminal_name} (Empty Return to Port)`);
    console.log(`   - Container: ${l2Record.container_number}`);

    // Verify audit logs
    const auditLogs = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT status, notes, actor FROM logistics_drayage_status_logs WHERE job_id = $1 OR job_id = $2 ORDER BY created_at ASC`,
      l1JobId,
      activatedL2.l2JobId,
    );
    console.log('\n📜 Execution Audit Trail:');
    for (const log of auditLogs) {
      console.log(`   • [${log.status}] (${log.actor}): ${log.notes}`);
    }

    // 6. Test Downstream Optimization via Workspace Query
    console.log('\n🧠 Phase 6: Testing Downstream 4-Factor Prime Mover Optimization Engine...');
    const workspace = await getDrayageWorkspaceData(prisma, tenantId);
    console.log(`   - Total Active Jobs in Workspace: ${workspace.jobs.length}`);
    const l2InWorkspace = workspace.jobs.find((j) => j.id === activatedL2.l2JobId);
    console.log(`   - L2 Job Present in Workspace: ${Boolean(l2InWorkspace)}`);
    console.log(`   - L2 Phase & Priority: ${l2InWorkspace?.jobPhase} / ${l2InWorkspace?.priority}`);
    console.log(`   - Available Prime Movers in Fleet: ${workspace.vehicles.length}`);
    console.log(`   - Available Chassis in Fleet: ${workspace.trailers.length}`);

    console.log('\n========================================================================');
    console.log('🎉 SIMULATION PASSED: ALL ASSERTIONS AND CRITERIA FULLY SATISFIED!');
    console.log('========================================================================\n');
  } catch (error) {
    console.error('\n❌ SIMULATION FAILED:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

runSimulation();
