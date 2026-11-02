/**
 * scripts/verify-driver-allowance-settlement.ts
 *
 * End-to-End Verification for Option A:
 * Driver Allowance & Finance Settlement Console
 * (Approval workflow, Port Gate Fee & Bogie/Triangulation bonus calculations, Driver Payout ledger).
 */

import * as fs from 'fs';
import * as path from 'path';

// Bypass Next.js server-only guard for standalone CLI verification
(require.cache as Record<string, unknown>)[require.resolve('server-only')] = {
  id: 'server-only',
  filename: 'server-only',
  loaded: true,
  exports: {},
};

async function main() {
  console.log('=== STARTING OPTION A: DRIVER ALLOWANCE & FINANCE SETTLEMENT E2E VERIFICATION ===\n');

  const { prisma } = await import('../src/lib/prisma');
  const {
    computeDriverAllowanceComponents,
    calculateMissingAllowances,
    adjustDriverAllowance,
    settleDriverAllowancesPayout,
    getDrayageWorkspaceData,
    ensureDrayageSchema,
  } = await import('../src/lib/logistics/drayage-domain');

  const tenantId = 'tenant-demo-drayage-settlement';

  // 1. Unit Test Bonus & Gate Fee Engine
  console.log('1. Testing computeDriverAllowanceComponents Engine...');

  const standardCalc = computeDriverAllowanceComponents({
    driver_allowance_aed: 150,
    terminal_name: 'Jebel Ali Port - Terminal 1 (DP World)',
    warehouse_name: 'JAFZA South Fulfillment Hub',
    job_phase: 'L1',
  });
  console.log('   Standard DPW L1 Trip:', standardCalc);
  if (standardCalc.totalAmountAed !== 185 || standardCalc.portGateFeeAed !== 35) {
    throw new Error(`Expected 185 AED for standard DPW trip, got ${standardCalc.totalAmountAed}`);
  }

  const khalifaBogieCalc = computeDriverAllowanceComponents({
    driver_allowance_aed: 180,
    terminal_name: 'Khalifa Port Container Terminal (AD Ports)',
    warehouse_name: 'KEZAD Polymer Logistics Hub',
    job_phase: 'L1',
    bogie_job_id: 'job-paired-20ft',
    customs_inspection: true,
  });
  console.log('   Khalifa Port + 2x20FT Bogie + Customs Inspection:', khalifaBogieCalc);
  // 180 Base + 40 AD Ports Gate + 75 Bogie + 40 Customs = 335 AED
  if (
    khalifaBogieCalc.portGateFeeAed !== 40 ||
    khalifaBogieCalc.bogieBonusAed !== 75 ||
    khalifaBogieCalc.inspectionBonusAed !== 40 ||
    khalifaBogieCalc.totalAmountAed !== 335
  ) {
    throw new Error(`Unexpected Khalifa Bogie calculation: ${JSON.stringify(khalifaBogieCalc)}`);
  }

  const streetTurnCalc = computeDriverAllowanceComponents({
    driver_allowance_aed: 160,
    terminal_name: 'Jebel Ali Port - Terminal 2 (DP World)',
    warehouse_name: 'JAFZA South Industrial Sector 4',
    job_phase: 'L1',
    street_turn_job_id: 'job-l2-empty-source',
  });
  console.log('   Inland Street-Turn Triangulated Trip:', streetTurnCalc);
  // 160 Base + 35 Gate + 65 Street-Turn = 260 AED
  if (streetTurnCalc.streetTurnBonusAed !== 65 || streetTurnCalc.totalAmountAed !== 260) {
    throw new Error(`Unexpected Street-Turn calculation: ${JSON.stringify(streetTurnCalc)}`);
  }

  // 2. Database E2E Test: Schema, Calculate & Sync, Adjust, and Settle
  console.log('\n2. Bootstrapping Drayage Workspace & Syncing Allowances...');
  await ensureDrayageSchema(prisma);
  await getDrayageWorkspaceData(prisma, tenantId);

  const calcResult = await calculateMissingAllowances(prisma, tenantId);
  console.log('   calculateMissingAllowances Result:', calcResult);

  const workspaceBefore = await getDrayageWorkspaceData(prisma, tenantId);
  console.log(`   Total Allowances in Ledger: ${workspaceBefore.allowances.length}`);
  if (workspaceBefore.allowances.length === 0) {
    throw new Error('Expected at least 1 driver allowance record in workspace');
  }

  const targetAllowance = workspaceBefore.allowances[0];
  console.log(
    `   Target Allowance: ${targetAllowance.id} (${targetAllowance.jobCode} - ${targetAllowance.driverName}) | Initial Total: AED ${targetAllowance.totalAmountAed}`,
  );

  // 3. Test Line-Item Allowance Adjustment (Adding Bogie + Street-Turn + Overnight Halt)
  console.log('\n3. Testing Line-Item Allowance Adjustment (adjustDriverAllowance)...');
  const adjustRes = await adjustDriverAllowance(prisma, {
    tenantId,
    allowanceId: targetAllowance.id,
    allowanceAmountAed: 160,
    portGateFeeAed: 35,
    overnightHaltAed: 50,
    bogieBonusAed: 75,
    streetTurnBonusAed: 65,
    inspectionBonusAed: 40,
    adjustmentNotes: 'Verified 2x20FT Bogie + Street-Turn + Overnight Ramp Halt',
    actor: 'Finance Audit Test',
  });
  console.log('   Adjustment Result:', adjustRes);
  // 160 + 35 + 50 + 75 + 65 + 40 = 425 AED
  if (adjustRes.totalAmountAed !== 425) {
    throw new Error(`Expected adjusted total 425 AED, got ${adjustRes.totalAmountAed}`);
  }

  // 4. Test Finance Settlement & WPS Batch Voucher Disbursement
  console.log('\n4. Testing Finance Settlement & WPS Batch Voucher (settleDriverAllowancesPayout)...');
  const settleRes = await settleDriverAllowancesPayout(prisma, {
    tenantId,
    allowanceIds: [targetAllowance.id],
    paymentMethod: 'WPS_PAYROLL',
    paymentRef: 'WPS-20261029-9001',
    notes: 'Settled via UAE WPS Corporate Payroll Batch',
    actor: 'Chief Financial Officer',
  });
  console.log('   Settlement Disbursement Result:', settleRes);

  if (!settleRes.ok || settleRes.settledCount !== 1 || settleRes.totalSettledAed !== 425) {
    throw new Error(`Settlement result mismatch: ${JSON.stringify(settleRes)}`);
  }

  const workspaceAfter = await getDrayageWorkspaceData(prisma, tenantId);
  const settledRecord = workspaceAfter.allowances.find((a) => a.id === targetAllowance.id);
  if (!settledRecord || settledRecord.status !== 'PAID' || settledRecord.paymentRef !== 'WPS-20261029-9001') {
    throw new Error(`Settled record verification failed: ${JSON.stringify(settledRecord)}`);
  }
  console.log(
    `   ✓ Verified DB Record Status: ${settledRecord.status}, Ref: ${settledRecord.paymentRef}, Method: ${settledRecord.paymentMethod}, PaidBy: ${settledRecord.paidBy}`,
  );

  // 5. Verify UI Page Implementation Tokens
  console.log('\n5. Verifying payments/page.tsx Finance Settlement Console UI...');
  const uiPath = path.join(__dirname, '../src/app/(app)/logistics/drayage/payments/page.tsx');
  const uiContent = fs.readFileSync(uiPath, 'utf-8');

  const requiredUiTokens = [
    'Driver Allowance & Finance Settlement Console',
    'DRIVER_PAYOUTS',
    'Bogie & Street-Turn Bonuses',
    'Port Gate Reimbursements',
    'adjust_allowance',
    'settle_allowances',
    'WPS_PAYROLL',
    'handleExportCsv',
    'Driver Drayage Payout Statement',
  ];

  for (const token of requiredUiTokens) {
    if (!uiContent.includes(token)) {
      throw new Error(`payments/page.tsx missing required token: "${token}"`);
    }
    console.log(`   ✓ Verified UI token: "${token}"`);
  }

  console.log('\n=== ALL OPTION A DRIVER ALLOWANCE & FINANCE SETTLEMENT VERIFICATIONS PASSED! ===');
  process.exit(0);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
