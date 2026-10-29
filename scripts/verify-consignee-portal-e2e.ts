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
    console.log('=== E2E Verification: Consignee & Shipper Self-Service Tracking Portal (Option D) ===');

    const { prisma } = await import('../src/lib/prisma');
    const {
        ensureDrayageSchema,
        getDrayageWorkspaceData,
        consigneeConfirmEmptyReady,
        submitJobPodEvidence,
    } = await import('../src/lib/logistics/drayage-domain');

    // 1. Verify UI files & navigation integration
    const portalPath = path.resolve(__dirname, '../src/app/(app)/logistics/drayage/portal/page.tsx');
    const layoutPath = path.resolve(__dirname, '../src/app/(app)/logistics/drayage/layout.tsx');

    if (!fs.existsSync(portalPath)) {
        throw new Error(`Missing Consignee Portal page at ${portalPath}`);
    }
    const portalSource = fs.readFileSync(portalPath, 'utf-8');
    const requiredTokens = [
        'PORT_DISCHARGED',
        'GATE_IN_LOADING',
        'CORRIDOR_TRANSIT',
        'PLACED_AT_RAMP',
        'OFFLOAD_COMPLETE',
        'EMPTY_RETURNED',
        'consignee_confirm_empty_ready',
        'submit_pod_evidence',
        'extend_etc',
        'extend_do',
        'Confirm Empty & Trigger L2',
        'Proof-of-Delivery (ePOD) & Container Photo Evidence',
    ];
    for (const token of requiredTokens) {
        if (!portalSource.includes(token)) {
            throw new Error(`Consignee Portal page missing expected token: ${token}`);
        }
    }
    console.log('[PASS] Consignee Portal page contains all 6 milestone stages, DO/Demurrage clocks, ePOD gallery, and L2 empty release workflow.');

    const layoutSource = fs.readFileSync(layoutPath, 'utf-8');
    if (!layoutSource.includes('/logistics/drayage/portal') || !layoutSource.includes('Consignee Portal')) {
        throw new Error('Drayage layout missing Consignee Portal tab');
    }
    console.log('[PASS] Drayage layout navigation includes Consignee Portal tab.');

    // 2. Verify domain operations (submitJobPodEvidence & consigneeConfirmEmptyReady)
    await ensureDrayageSchema(prisma);
    const tenantRows = await prisma.$queryRawUnsafe<Array<{ tenant_id: string }>>(
        `SELECT tenant_id FROM logistics_drayage_jobs GROUP BY tenant_id ORDER BY COUNT(*) DESC LIMIT 1`
    );
    const tenantId = tenantRows[0]?.tenant_id || 'tenant-demo-drayage-settlement';
    console.log(`[INFO] Using tenantId: ${tenantId}`);

    const before = await getDrayageWorkspaceData(prisma, tenantId);
    const targetJob =
        before.jobs.find((j) => j.jobPhase === 'L1' && !j.l2Activated) ||
        before.jobs.find((j) => j.jobPhase === 'L1') ||
        before.jobs[0];

    if (!targetJob) {
        throw new Error('No drayage jobs found in workspace data');
    }

    console.log(`[INFO] Testing against Job ${targetJob.jobCode} (${targetJob.containerNumber})`);

    const samplePhotoUrl = 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=900&q=80';
    const sampleSigner = 'Tariq Al-Mansoori (JAFZA Dock Supervisor)';

    const podRes = await submitJobPodEvidence(prisma, {
        tenantId,
        jobId: targetJob.id,
        receiverName: sampleSigner,
        photoUrl: samplePhotoUrl,
        notes: 'Seal intact, ramp bay 04 verified',
    });
    if (!podRes.ok) {
        throw new Error('submitJobPodEvidence returned ok=false');
    }
    console.log(`[PASS] submitJobPodEvidence recorded ePOD photo & signature for ${targetJob.jobCode} at ${podRes.signedAt}`);

    const emptyRes = await consigneeConfirmEmptyReady(prisma, {
        tenantId,
        jobId: targetJob.id,
        receiverName: sampleSigner,
        photoUrl: samplePhotoUrl,
        bayNotes: 'Verified via automated Option D E2E script',
    });

    if (!emptyRes.ok) {
        throw new Error('consigneeConfirmEmptyReady returned ok=false');
    }
    console.log(
        `[PASS] consigneeConfirmEmptyReady succeeded (ok=${emptyRes.ok}, l2Activated=${emptyRes.l2Activated}, l2JobCode=${emptyRes.l2JobCode ?? 'already-active'})`
    );

    const after = await getDrayageWorkspaceData(prisma, tenantId);
    const updatedJob = after.jobs.find((j) => j.id === targetJob.id);
    if (!updatedJob) {
        throw new Error('Target job missing after update');
    }
    if (!updatedJob.l2Activated) {
        throw new Error(`Expected l2Activated=true on ${updatedJob.jobCode}, got ${updatedJob.l2Activated}`);
    }
    if (updatedJob.podSignatureName !== sampleSigner) {
        throw new Error(`Expected podSignatureName="${sampleSigner}", got "${updatedJob.podSignatureName}"`);
    }

    console.log(`[PASS] Verified persisted job state: status=${updatedJob.status}, l2Activated=${updatedJob.l2Activated}, podSignatureName=${updatedJob.podSignatureName}`);
    console.log('=== ALL OPTION D VERIFICATION CHECKS PASSED ===');
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('[FAIL]', err);
        process.exit(1);
    });
