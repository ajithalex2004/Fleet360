import * as fs from 'fs';
import * as path from 'path';

// Bypass Next.js server-only guard for standalone CLI verification before dynamic import
(require.cache as Record<string, unknown>)[require.resolve('server-only')] = {
  id: 'server-only',
  filename: 'server-only',
  loaded: true,
  exports: {},
};

async function main() {
  console.log('=== E2E Verification: Option C - Port Community System (PCS) & Gate Token Automation ===\n');

  // 1. Verify UI tokens across containers, assignment, and driver-app
  console.log('1. Verifying UI files & component integrations...');
  const containersPath = path.resolve(__dirname, '../src/app/(app)/logistics/drayage/containers/page.tsx');
  const assignmentPath = path.resolve(__dirname, '../src/app/(app)/logistics/drayage/assignment/page.tsx');
  const driverAppPath = path.resolve(__dirname, '../src/app/(driver)/driver-app/today/page.tsx');

  const containersSource = fs.readFileSync(containersPath, 'utf-8');
  const containersTokens = [
    'clear_port_inspection',
    'book_pcs_token',
    'revalidate_delivery_order',
    'PCS Gate Readiness & eDO',
    'Port Inspection & Customs Clearance',
    'New Customs Seal Number',
    'GATE READY',
    'DO EXPIRED',
    'HOLD PENDING',
  ];
  for (const token of containersTokens) {
    if (!containersSource.includes(token)) {
      throw new Error(`containers/page.tsx missing expected token: ${token}`);
    }
  }
  console.log('   [PASS] containers/page.tsx includes PCS gate readiness badges, eDO renewal, and inspection clearance modals.');

  const assignmentSource = fs.readFileSync(assignmentPath, 'utf-8');
  const assignmentTokens = [
    'Port Gate Token & PCS',
    'Auto-Generate PCS Token',
    'PCS Pre-Dispatch Advisory',
    'Customs Hold Pending',
  ];
  for (const token of assignmentTokens) {
    if (!assignmentSource.includes(token)) {
      throw new Error(`assignment/page.tsx missing expected token: ${token}`);
    }
  }
  console.log('   [PASS] assignment/page.tsx includes PCS gate token generation and pre-dispatch hold advisories.');

  const driverSource = fs.readFileSync(driverAppPath, 'utf-8');
  const driverTokens = [
    'PCS Terminal Gate e-Token',
    'GATE ACCESS CONFIRMED',
    'Appointment Pass',
    'SCAN AT KIOSK',
  ];
  for (const token of driverTokens) {
    if (!driverSource.includes(token)) {
      throw new Error(`driver-app/today/page.tsx missing expected token: ${token}`);
    }
  }
  console.log('   [PASS] driver-app/today/page.tsx includes digital port gate e-Token pass card with barcode.');

  // 2. Test domain functions & database operations
  console.log('\n2. Testing PCS Domain Engines (Database Operations)...');
  const { prisma } = await import('../src/lib/prisma');
  const {
    ensureDrayageSchema,
    getDrayageWorkspaceData,
    bookPcsToken,
    clearPortInspection,
    revalidateDeliveryOrder,
  } = await import('../src/lib/logistics/drayage-domain');

  await ensureDrayageSchema(prisma);

  const tenantRows = await prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>(
    `SELECT tenant_id FROM logistics_drayage_containers GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1`
  );
  const tenantId = tenantRows[0]?.tenant_id || 'tenant-demo-drayage-settlement';
  console.log(`   Using tenantId: ${tenantId}`);

  const before = await getDrayageWorkspaceData(prisma, tenantId);
  if (!before.containers || before.containers.length === 0) {
    throw new Error('No containers found in workspace for testing');
  }

  const targetContainer = before.containers[0];
  console.log(`   Target container: ${targetContainer.containerNumber} (${targetContainer.terminalName})`);

  // 2a. Book PCS Token
  console.log('\n2a. Testing bookPcsToken...');
  const tokenRes = await bookPcsToken(prisma, {
    tenantId,
    containerId: targetContainer.id,
    terminalName: targetContainer.terminalName,
    slotWindowMinutes: 120,
    actor: 'Option C E2E Automated Test',
  });
  if (!tokenRes.ok || !tokenRes.tokenNumber) {
    throw new Error('bookPcsToken returned ok=false or missing tokenNumber');
  }
  console.log(`   [PASS] Booked PCS Token: ${tokenRes.tokenNumber} (Window: ${tokenRes.slotStart} to ${tokenRes.slotEnd})`);

  // 2b. Clear Port Inspection & Record New Customs Seal
  console.log('\n2b. Testing clearPortInspection...');
  const sampleSeal = `CUST-SEAL-${Math.floor(10000 + Math.random() * 90000)}`;
  const sampleOfficer = 'Inspector Hamdan Al-Falasi (Dubai Customs)';
  const clearRes = await clearPortInspection(prisma, {
    tenantId,
    containerId: targetContainer.id,
    agency: 'CUSTOMS',
    newSealNumber: sampleSeal,
    clearedBy: sampleOfficer,
    notes: 'Verified empty/cargo seals match PCS manifest. Green channel cleared.',
  });
  if (!clearRes.ok) {
    throw new Error('clearPortInspection returned ok=false');
  }
  console.log(`   [PASS] Cleared inspection: agency=${clearRes.agencyCleared}, seal=${clearRes.newSealNumber}, officer=${clearRes.clearedBy}`);

  // 2c. Revalidate eDO
  console.log('\n2c. Testing revalidateDeliveryOrder...');
  const redoRes = await revalidateDeliveryOrder(prisma, {
    tenantId,
    containerId: targetContainer.id,
    extendDays: 5,
    actor: 'Option C E2E Automated Test',
  });
  if (!redoRes.ok) {
    throw new Error('revalidateDeliveryOrder returned ok=false');
  }
  console.log(`   [PASS] Revalidated eDO: newExpiry=${redoRes.newDoExpiry} (+${redoRes.daysExtended} days)`);

  // 2d. Verify persisted state in workspace
  console.log('\n2d. Verifying updated workspace data...');
  const after = await getDrayageWorkspaceData(prisma, tenantId);
  const updatedContainer = after.containers.find((c) => c.id === targetContainer.id);
  if (!updatedContainer) {
    throw new Error('Updated container not found in workspace data');
  }

  if (updatedContainer.pcsTokenNumber !== tokenRes.tokenNumber) {
    throw new Error(`Expected pcsTokenNumber="${tokenRes.tokenNumber}", got "${updatedContainer.pcsTokenNumber}"`);
  }
  if (updatedContainer.sealNumber !== sampleSeal) {
    throw new Error(`Expected sealNumber="${sampleSeal}", got "${updatedContainer.sealNumber}"`);
  }
  if (updatedContainer.inspectionStatus !== 'CLEARED') {
    throw new Error(`Expected inspectionStatus="CLEARED", got "${updatedContainer.inspectionStatus}"`);
  }
  if (updatedContainer.doStatus !== 'REVALIDATED') {
    throw new Error(`Expected doStatus="REVALIDATED", got "${updatedContainer.doStatus}"`);
  }

  console.log(`   [PASS] Container ${updatedContainer.containerNumber} persisted attributes:`);
  console.log(`          - pcsTokenNumber:   ${updatedContainer.pcsTokenNumber}`);
  console.log(`          - sealNumber:       ${updatedContainer.sealNumber}`);
  console.log(`          - inspectionStatus: ${updatedContainer.inspectionStatus}`);
  console.log(`          - doStatus:         ${updatedContainer.doStatus}`);

  console.log('\n=== ALL OPTION C VERIFICATION CHECKS PASSED ===');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FAIL]', err);
    process.exit(1);
  });
